import { MarkdownView, Plugin, TFile, WorkspaceLeaf } from 'obsidian';
import { keymap, EditorView, ViewUpdate } from '@codemirror/view';
import { Extension } from '@codemirror/state';
import { NavigationStack, HistoryEntry, EditHistoryEntry, PreviewHistoryEntry } from './navigation-stack';
import { shouldCreateNewEntry } from './selection-state';
import { CursorHistorySettings, DEFAULT_SETTINGS, CursorHistorySettingTab } from './settings';
import { HistoryNavigatorModal } from './history-navigator-modal';
import { CodeFoldManager } from './code-fold-manager';

// --- Obsidian type augmentation for undocumented APIs ---

interface ObsidianHotkey {
	modifiers: string[];
	key: string;
}

declare module 'obsidian' {
	interface App {
		hotkeyManager: {
			getHotkeys(id: string): ObsidianHotkey[] | undefined;
			getDefaultHotkeys(id: string): ObsidianHotkey[];
			load(): Promise<void>;
		};
	}
	interface MarkdownPreviewView {
		getScroll(): number;
		applyScroll(scrollLine: number): void;
		containerEl: HTMLElement;
	}
}

const DESIRED_HOTKEYS: Record<string, ObsidianHotkey> = {
	'cursor-history:go-back': { modifiers: ['Ctrl', 'Mod'], key: 'ArrowLeft' },
	'cursor-history:go-forward': { modifiers: ['Ctrl', 'Mod'], key: 'ArrowRight' },
};

export default class CursorHistoryPlugin extends Plugin {
	settings: CursorHistorySettings = DEFAULT_SETTINGS;
	private navStack = new NavigationStack(50);
	private currentState: HistoryEntry | null = null;
	private isNavigating = false;
	private hotkeyExtension: Extension[] = [];
	private saveTimeoutId: number | null = null;
	private lastActiveLeaf: WorkspaceLeaf | null = null;
	private codeFoldManager = new CodeFoldManager(this);

	async onload() {
		await this.loadSettings();
		await this.codeFoldManager.init();

		this.addSettingTab(new CursorHistorySettingTab(this.app, this));

		// Commands
		this.addCommand({
			id: 'toggle-fold-all-code-blocks',
			name: 'Toggle fold all code blocks',
			callback: () => {
				const current = this.codeFoldManager.getFoldAll();
				void this.codeFoldManager.setFoldAll(!current);
			},
		});
		this.addCommand({
			id: 'go-back',
			name: 'Go back',
			callback: () => void this.goBack(),
		});

		this.addCommand({
			id: 'go-forward',
			name: 'Go forward',
			callback: () => void this.goForward(),
		});

		this.addCommand({
			id: 'open-history-navigator',
			name: 'Open history navigator',
			callback: () => {
				new HistoryNavigatorModal(this.app, this).open();
			},
		});

		// Capturing phase DOM click listener for internal links (Reading View & Edit View)
		this.registerDomEvent(
			document,
			'click',
			(evt: MouseEvent) => {
				const target = evt.target as HTMLElement | null;
				const linkEl = target?.closest('a.internal-link');
				if (linkEl) {
					// Record exact source position immediately before internal link navigation occurs
					this.recordCurrentPosition(true);
				}
			},
			true // useCapture phase
		);

		// Listen for workspace leaf changes (tab switch / note navigation)
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', (leaf) => {
				if (this.isNavigating) return;
				if (this.lastActiveLeaf && this.lastActiveLeaf !== leaf) {
					this.recordPositionForLeaf(this.lastActiveLeaf, true);
				}
				this.lastActiveLeaf = leaf;
				this.recordCurrentPosition();
			})
		);

		// Listen for file opening in normal way to restore scroll position
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				if (!file || this.isNavigating || !this.settings.restoreScrollPosition) return;

				const entry = this.navStack.findLatestForFile(file.path);
				if (entry) {
					setTimeout(() => {
						void this.navigateTo(entry, true);
					}, 50);
				}
			})
		);

		// Listen for cursor changes within CM6 editors (Edit Mode)
		this.registerEditorExtension(
			EditorView.updateListener.of((update: ViewUpdate) => {
				if (this.isNavigating) return;
				if (!update.selectionSet) return;

				const isJump = update.transactions.some(tr => {
					const event = tr.annotation(EditorView.userEvent);
					return event != null && event !== 'input' && event !== 'delete'
						&& event !== 'undo' && event !== 'redo';
				});

				this.recordCurrentPosition(isJump);
			})
		);

		// Keymaps for key-repeat support
		this.registerEditorExtension(this.hotkeyExtension);
		this.app.workspace.onLayoutReady(async () => {
			await this.applyDefaultHotkeys();
			this.buildKeymap();
		});
		this.registerEvent(
			this.app.workspace.on('layout-change', () => this.buildKeymap())
		);
	}

	async onunload() {
		await this.saveHistoryStackImmediate();
	}

	getNavStack(): NavigationStack {
		return this.navStack;
	}

	updateMaxEntries(size: number): void {
		this.navStack.setMaxSize(size);
	}

	async loadSettings(): Promise<void> {
		const rawData = (await this.loadData()) || {};
		this.settings = Object.assign({}, DEFAULT_SETTINGS, rawData);
		this.navStack.setMaxSize(this.settings.maxEntries);
		await this.loadHistoryStack();
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async saveSettingsAndHistory(): Promise<void> {
		await this.saveSettings();
		await this.saveHistoryStackImmediate();
	}

	private getHistoryFilePath(): string {
		return `${this.app.vault.configDir}/cursor-history.json`;
	}

	private isValidFilePath(filePath: string): boolean {
		if (!filePath || typeof filePath !== 'string') return false;
		if (filePath.startsWith('!') || filePath.includes('![[')) return false;
		if (filePath.includes('..') || filePath.includes('\0')) return false;

		const abstractFile = this.app.vault.getAbstractFileByPath(filePath);
		return abstractFile instanceof TFile && abstractFile.extension === 'md';
	}

	private cleanupInvalidDbEntries(): void {
		this.navStack.purgeInvalid(this.isValidFilePath.bind(this));
	}

	private async loadHistoryStack(): Promise<void> {
		let loadedEntries: HistoryEntry[] = [];

		if (this.settings.useFolderLocalHistory) {
			const path = this.getHistoryFilePath();
			try {
				if (await this.app.vault.adapter.exists(path)) {
					const content = await this.app.vault.adapter.read(path);
					loadedEntries = JSON.parse(content);
				}
			} catch (err) {
				console.error('Cursor History: Error reading folder local history file:', err);
			}
		} else {
			const rawData = (await this.loadData()) || {};
			if (Array.isArray(rawData.historyStack)) {
				loadedEntries = rawData.historyStack;
			}
		}

		this.navStack.setStack(loadedEntries);
		this.cleanupInvalidDbEntries();
	}

	private scheduleHistorySave(): void {
		if (this.saveTimeoutId !== null) {
			window.clearTimeout(this.saveTimeoutId);
		}
		this.saveTimeoutId = window.setTimeout(() => {
			this.saveTimeoutId = null;
			void this.saveHistoryStackImmediate();
		}, 2000);
	}

	private async saveHistoryStackImmediate(): Promise<void> {
		if (this.saveTimeoutId !== null) {
			window.clearTimeout(this.saveTimeoutId);
			this.saveTimeoutId = null;
		}

		this.cleanupInvalidDbEntries();
		const entries = this.navStack.getStack();

		if (this.settings.useFolderLocalHistory) {
			const path = this.getHistoryFilePath();
			try {
				await this.app.vault.adapter.write(path, JSON.stringify(entries, null, 2));
			} catch (err) {
				console.error('Cursor History: Error writing folder local history file:', err);
			}
		} else {
			const rawData = (await this.loadData()) || {};
			rawData.historyStack = entries;
			await this.saveData(rawData);
		}
	}

	private recordCurrentPosition(isJump = false): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view?.file) return;
		this.recordPositionForView(view, isJump);
	}

	private recordPositionForLeaf(leaf: WorkspaceLeaf, isJump = false): void {
		if (leaf.view instanceof MarkdownView && leaf.view.file) {
			this.recordPositionForView(leaf.view, isJump);
		}
	}

	private recordPositionForView(view: MarkdownView, isJump = false): void {
		const entry = this.getEntryForView(view);
		if (!entry) return;

		if (!this.isValidFilePath(entry.filePath)) return;

		if (shouldCreateNewEntry(this.currentState, entry, isJump, this.settings.jumpThreshold)) {
			this.navStack.push(entry);
		} else {
			this.navStack.replaceCurrent(entry);
		}

		this.currentState = entry;
		this.scheduleHistorySave();
	}

	private getEntryForView(view: MarkdownView): HistoryEntry | null {
		if (!view?.file) return null;
		const mode = view.getMode();

		if (mode === 'preview') {
			const previewView = view.previewMode;
			const scrollLine = typeof previewView.getScroll === 'function' ? previewView.getScroll() : 0;
			const previewEl = view.contentEl.querySelector('.markdown-preview-view');
			const scrollTop = previewEl ? previewEl.scrollTop : 0;

			const entry: PreviewHistoryEntry = {
				mode: 'preview',
				filePath: view.file.path,
				selection: {
					scrollTop,
					scrollLine,
				},
				timestamp: Date.now(),
			};
			return entry;
		} else {
			const editor = view.editor;
			const from = editor.getCursor('from');
			const to = editor.getCursor('to');

			const entry: EditHistoryEntry = {
				mode: 'edit',
				filePath: view.file.path,
				selection: {
					startLine: from.line,
					startCol: from.ch,
					endLine: to.line,
					endCol: to.ch,
				},
				timestamp: Date.now(),
			};
			return entry;
		}
	}

	private async applyDefaultHotkeys() {
		if (this.settings.hotkeyDefaultsApplied) return;

		const configPath = `${this.app.vault.configDir}/hotkeys.json`;
		let hotkeys: Record<string, ObsidianHotkey[]> = {};

		try {
			hotkeys = JSON.parse(await this.app.vault.adapter.read(configPath));
		} catch {
			// File doesn't exist or is invalid
		}

		let changed = false;
		for (const [cmdId, hk] of Object.entries(DESIRED_HOTKEYS)) {
			if (hotkeys[cmdId]) continue;
			hotkeys[cmdId] = [hk];
			changed = true;
		}

		if (changed) {
			await this.app.vault.adapter.write(configPath, JSON.stringify(hotkeys, null, '  '));
			if (typeof this.app.hotkeyManager?.load === 'function') {
				await this.app.hotkeyManager.load();
			}
		}

		this.settings.hotkeyDefaultsApplied = true;
		await this.saveSettings();
	}

	private buildKeymap(): void {
		const backKeys = this.getCommandHotkeys('cursor-history:go-back');
		const forwardKeys = this.getCommandHotkeys('cursor-history:go-forward');

		const bindings: Array<{ key: string; run: () => boolean }> = [];

		for (const hk of backKeys) {
			bindings.push({
				key: [...hk.modifiers, hk.key].join('-'),
				run: () => { void this.goBack(); return true; },
			});
		}

		for (const hk of forwardKeys) {
			bindings.push({
				key: [...hk.modifiers, hk.key].join('-'),
				run: () => { void this.goForward(); return true; },
			});
		}

		this.hotkeyExtension.length = 0;
		if (bindings.length > 0) {
			this.hotkeyExtension.push(keymap.of(bindings));
		}
		this.app.workspace.updateOptions();
	}

	private getCommandHotkeys(commandId: string): ObsidianHotkey[] {
		const hm = this.app.hotkeyManager;
		if (!hm) return [];

		const custom = hm.getHotkeys(commandId);
		if (custom !== undefined) return custom;
		return hm.getDefaultHotkeys(commandId) || [];
	}

	private async goBack(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const current = this.getEntryForView(view);
			if (current && shouldCreateNewEntry(this.currentState, current, false, this.settings.jumpThreshold)) {
				this.navStack.push(current);
				this.currentState = current;
			}
		}

		const entry = this.navStack.goBack();
		if (entry) await this.navigateTo(entry);
	}

	private async goForward(): Promise<void> {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const current = this.getEntryForView(view);
			if (current && shouldCreateNewEntry(this.currentState, current, false, this.settings.jumpThreshold)) {
				this.navStack.push(current);
				this.currentState = current;
			}
		}

		const entry = this.navStack.goForward();
		if (entry) await this.navigateTo(entry);
	}

	public async navigateTo(entry: HistoryEntry, isAutoRestore = false): Promise<void> {
		this.isNavigating = true;

		try {
			const file = this.app.vault.getAbstractFileByPath(entry.filePath);
			if (!(file instanceof TFile)) return;

			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);

			const view = this.app.workspace.getActiveViewOfType(MarkdownView);
			if (!view) return;

			if (entry.mode === 'edit') {
				const editor = view.editor;
				editor.setSelection(
					{ line: entry.selection.startLine, ch: entry.selection.startCol },
					{ line: entry.selection.endLine, ch: entry.selection.endCol }
				);
				editor.scrollIntoView(
					{
						from: { line: entry.selection.startLine, ch: entry.selection.startCol },
						to: { line: entry.selection.endLine, ch: entry.selection.endCol },
					},
					true
				);
			} else if (entry.mode === 'preview') {
				// Wait for Reading View DOM rendering to complete before applying scroll position
				this.applyPreviewScrollWithRetry(view, entry.selection);
			}

			this.currentState = entry;
		} finally {
			setTimeout(() => {
				this.isNavigating = false;
			}, 150);
		}
	}

	private applyPreviewScrollWithRetry(view: MarkdownView, selection: PreviewSelection, attempts = 0): void {
		const previewEl = view.contentEl.querySelector('.markdown-preview-view') as HTMLElement | null;
		const previewView = view.previewMode;

		if (previewEl && previewEl.scrollHeight > 0) {
			if (typeof previewView.applyScroll === 'function') {
				previewView.applyScroll(selection.scrollLine);
			}
			previewEl.scrollTop = selection.scrollTop;
		} else if (attempts < 10) {
			setTimeout(() => {
				this.applyPreviewScrollWithRetry(view, selection, attempts + 1);
			}, 30);
		}
	}
}
