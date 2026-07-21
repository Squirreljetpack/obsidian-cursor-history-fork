import { Plugin, TFile, MarkdownPostProcessorContext } from 'obsidian';

export interface CodeFoldHistoryData {
	fold_all: boolean;
	files: Record<string, string[]>; // filePath -> block signatures
}

const DEFAULT_FOLD_HISTORY: CodeFoldHistoryData = {
	fold_all: false,
	files: {},
};

export class CodeFoldManager {
	private plugin: Plugin;
	private data: CodeFoldHistoryData = { ...DEFAULT_FOLD_HISTORY };

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	private get historyPath(): string {
		return `${this.plugin.app.vault.configDir}/code-fold-history.json`;
	}

	async init(): Promise<void> {
		await this.loadHistory();

		// 1. Register Markdown Post-Processor for Reading mode
		this.plugin.registerMarkdownPostProcessor((element, context) => {
			this.processReadingModeCodeBlocks(element, context);
		});

		// 2. Register file-open listener to validate and prune missing blocks
		this.plugin.registerEvent(
			this.plugin.app.workspace.on('file-open', async (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					await this.validateAndPruneFile(file);
				}
			})
		);
	}

	// --- Persistence ---

	async loadHistory(): Promise<void> {
		try {
			const exists = await this.plugin.app.vault.adapter.exists(this.historyPath);
			if (exists) {
				const content = await this.plugin.app.vault.adapter.read(this.historyPath);
				this.data = { ...DEFAULT_FOLD_HISTORY, ...JSON.parse(content) };
			}
		} catch (e) {
			console.error('CodeFoldManager: Error loading code-fold-history.json:', e);
			this.data = { ...DEFAULT_FOLD_HISTORY };
		}
	}

	async saveHistory(): Promise<void> {
		try {
			await this.plugin.app.vault.adapter.write(
				this.historyPath,
				JSON.stringify(this.data, null, 2)
			);
		} catch (e) {
			console.error('CodeFoldManager: Error saving code-fold-history.json:', e);
		}
	}

	getFoldAll(): boolean {
		return this.data.fold_all;
	}

	async setFoldAll(foldAll: boolean): Promise<void> {
		if (this.data.fold_all === foldAll) return;
		this.data.fold_all = foldAll;
		await this.saveHistory();
		this.plugin.app.workspace.trigger('css-change');
	}

	// --- Identification ---

	private hashText(text: string): string {
		let hash = 0;
		for (let i = 0; i < text.length; i++) {
			hash = (hash << 5) - hash + text.charCodeAt(i);
			hash |= 0;
		}
		return Math.abs(hash).toString(36);
	}

	private getSignaturesFromContents(contents: string[]): string[] {
		const counts: Record<string, number> = {};
		return contents.map((codeText) => {
			const baseHash = this.hashText(codeText.trim());
			const idx = counts[baseHash] || 0;
			counts[baseHash] = idx + 1;
			return `h:${baseHash}-${idx}`;
		});
	}

	// --- Reading Mode Processing ---

	private processReadingModeCodeBlocks(element: HTMLElement, context: MarkdownPostProcessorContext): void {
		const preElements = Array.from(element.querySelectorAll<HTMLPreElement>('pre'));
		if (preElements.length === 0) return;

		const filePath = context.sourcePath;
		const storedBlocks = this.data.files[filePath] || [];
		const counts: Record<string, number> = {};

		preElements.forEach((pre) => {
			const codeEl = pre.querySelector('code');
			const codeText = (codeEl ? codeEl.textContent : pre.textContent) || '';

			const baseHash = this.hashText(codeText.trim());
			const idx = counts[baseHash] || 0;
			counts[baseHash] = idx + 1;
			const blockId = `h:${baseHash}-${idx}`;

			const isInStoredList = storedBlocks.includes(blockId);
			const shouldBeFolded = this.data.fold_all ? !isInStoredList : isInStoredList;

			if (shouldBeFolded) {
				pre.classList.add('is-collapsed');
			} else {
				pre.classList.remove('is-collapsed');
			}

			this.ensureFoldButton(pre, filePath, blockId);
		});
	}

	private ensureFoldButton(pre: HTMLPreElement, filePath: string, blockId: string): void {
		if (pre.querySelector('.code-fold-btn')) return;

		pre.style.position = 'relative';

		const foldBtn = document.createElement('button');
		foldBtn.className = 'code-fold-btn';
		foldBtn.setAttribute('aria-label', 'Toggle code fold');
		foldBtn.innerHTML = pre.classList.contains('is-collapsed') ? '&#9654;' : '&#9660;';

		foldBtn.addEventListener('click', (e) => {
			e.stopPropagation();
			const isNowCollapsed = pre.classList.toggle('is-collapsed');
			foldBtn.innerHTML = isNowCollapsed ? '&#9654;' : '&#9660;';
			this.updateBlockFoldState(filePath, blockId, isNowCollapsed);
		});

		// Place next to existing copy button if present, otherwise append to pre
		const copyBtn = pre.querySelector('.copy-code-button');
		if (copyBtn && copyBtn.parentElement) {
			copyBtn.parentElement.insertBefore(foldBtn, copyBtn);
		} else {
			pre.appendChild(foldBtn);
		}
	}

	private updateBlockFoldState(filePath: string, blockId: string, isFolded: boolean): void {
		if (!this.data.files[filePath]) {
			this.data.files[filePath] = [];
		}

		const list = this.data.files[filePath];
		const shouldStoreInList = this.data.fold_all ? !isFolded : isFolded;

		const index = list.indexOf(blockId);
		if (shouldStoreInList && index === -1) {
			list.push(blockId);
		} else if (!shouldStoreInList && index !== -1) {
			list.splice(index, 1);
		}

		if (list.length === 0) {
			delete this.data.files[filePath];
		}

		void this.saveHistory();
	}

	// --- Validation & Pruning ---

	async validateAndPruneFile(file: TFile): Promise<void> {
		const filePath = file.path;
		const storedBlocks = this.data.files[filePath];
		if (!storedBlocks || storedBlocks.length === 0) return;

		try {
			const content = await this.plugin.app.vault.cachedRead(file);
			const codeBlockRegex = /```[\s\S]*?\n([\s\S]*?)```/g;
			const currentContents: string[] = [];
			let match: RegExpExecArray | null;

			while ((match = codeBlockRegex.exec(content)) !== null) {
				currentContents.push(match[1]);
			}

			const validSignatures = new Set(this.getSignaturesFromContents(currentContents));
			const prunedBlocks = storedBlocks.filter((sig) => validSignatures.has(sig));

			if (prunedBlocks.length !== storedBlocks.length) {
				if (prunedBlocks.length > 0) {
					this.data.files[filePath] = prunedBlocks;
				} else {
					delete this.data.files[filePath];
				}
				await this.saveHistory();
			}
		} catch (e) {
			console.error(`CodeFoldManager: Error validating file ${filePath}:`, e);
		}
	}
}
