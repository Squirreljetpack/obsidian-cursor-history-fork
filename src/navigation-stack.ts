export interface EditSelection {
	startLine: number;
	startCol: number;
	endLine: number;
	endCol: number;
}

export interface PreviewSelection {
	scrollTop: number;
	scrollLine: number;
}

export interface EditHistoryEntry {
	mode: 'edit';
	filePath: string;
	selection: EditSelection;
	timestamp?: number;
}

export interface PreviewHistoryEntry {
	mode: 'preview';
	filePath: string;
	selection: PreviewSelection;
	timestamp?: number;
}

export type HistoryEntry = EditHistoryEntry | PreviewHistoryEntry;

export class NavigationStack {
	private stack: HistoryEntry[] = [];
	private index = -1;
	private maxSize: number;

	constructor(maxSize = 50) {
		this.maxSize = maxSize;
	}

	setMaxSize(size: number): void {
		this.maxSize = size;
		this.enforceMaxSize();
	}

	push(entry: HistoryEntry): void {
		// Deduplicate: if current entry is same mode, file, and position, update it instead
		if (this.index >= 0 && this.index < this.stack.length) {
			const current = this.stack[this.index];
			if (current.filePath === entry.filePath && current.mode === entry.mode) {
				if (entry.mode === 'edit' && current.mode === 'edit') {
					if (current.selection.startLine === entry.selection.startLine) {
						this.stack[this.index] = entry;
						return;
					}
				} else if (entry.mode === 'preview' && current.mode === 'preview') {
					if (Math.abs(current.selection.scrollLine - entry.selection.scrollLine) < 3) {
						this.stack[this.index] = entry;
						return;
					}
				}
			}
		}

		// Discard forward history when pushing a new branch point
		if (this.index < this.stack.length - 1) {
			this.stack = this.stack.slice(0, this.index + 1);
		}

		this.stack.push(entry);
		this.index = this.stack.length - 1;

		this.enforceMaxSize();
	}

	replaceCurrent(entry: HistoryEntry): void {
		if (this.index >= 0 && this.index < this.stack.length) {
			this.stack[this.index] = entry;
		} else {
			this.push(entry);
		}
	}

	goBack(): HistoryEntry | null {
		if (this.index <= 0) return null;
		this.index--;
		return this.stack[this.index];
	}

	goForward(): HistoryEntry | null {
		if (this.index >= this.stack.length - 1) return null;
		this.index++;
		return this.stack[this.index];
	}

	getCurrent(): HistoryEntry | null {
		if (this.index >= 0 && this.index < this.stack.length) {
			return this.stack[this.index];
		}
		return null;
	}

	findLatestForFile(filePath: string, mode?: 'edit' | 'preview'): HistoryEntry | null {
		for (let i = this.stack.length - 1; i >= 0; i--) {
			const item = this.stack[i];
			if (item.filePath === filePath) {
				if (!mode || item.mode === mode) {
					return item;
				}
			}
		}
		return null;
	}

	getStack(): HistoryEntry[] {
		return [...this.stack];
	}

	getIndex(): number {
		return this.index;
	}

	setStack(entries: HistoryEntry[], index?: number): void {
		this.stack = Array.isArray(entries) ? [...entries] : [];
		this.enforceMaxSize();
		if (typeof index === 'number' && index >= 0 && index < this.stack.length) {
			this.index = index;
		} else {
			this.index = this.stack.length - 1;
		}
	}

	purgeInvalid(isValidFn: (filePath: string) => boolean): void {
		const currentEntry = this.getCurrent();
		this.stack = this.stack.filter(entry => isValidFn(entry.filePath));
		if (currentEntry && isValidFn(currentEntry.filePath)) {
			this.index = this.stack.indexOf(currentEntry);
			if (this.index === -1) this.index = this.stack.length - 1;
		} else {
			this.index = this.stack.length - 1;
		}
	}

	private enforceMaxSize(): void {
		while (this.stack.length > this.maxSize) {
			this.stack.shift();
			if (this.index > 0) {
				this.index--;
			}
		}
	}
}
