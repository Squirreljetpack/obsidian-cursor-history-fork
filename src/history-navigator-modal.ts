import { App, FuzzySuggestModal } from 'obsidian';
import { HistoryEntry } from './navigation-stack';
import type CursorHistoryPlugin from './main';

export class HistoryNavigatorModal extends FuzzySuggestModal<HistoryEntry> {
	private plugin: CursorHistoryPlugin;

	constructor(app: App, plugin: CursorHistoryPlugin) {
		super(app);
		this.plugin = plugin;
		this.setPlaceholder('Type to search cursor history...');
	}

	getItems(): HistoryEntry[] {
		// Return entries in reverse order (newest first)
		const stack = this.plugin.getNavStack().getStack();
		return stack.slice().reverse();
	}

	getItemText(item: HistoryEntry): string {
		if (item.mode === 'edit') {
			const line = item.selection.startLine + 1; // 1-based display
			return `L${line}: ${item.filePath}`;
		} else {
			const line = item.selection.scrollLine + 1; // 1-based display
			return `L~${line} (read mode): ${item.filePath}`;
		}
	}

	onChooseItem(item: HistoryEntry, evt: MouseEvent | KeyboardEvent): void {
		void this.plugin.navigateTo(item);
	}
}
