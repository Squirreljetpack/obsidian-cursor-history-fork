import { App, FuzzySuggestModal, MarkdownView } from "obsidian";
import type CursorHistoryPlugin from "./main";
import { HistoryEntry } from "./navigation-stack";

export class HistoryNavigatorModal extends FuzzySuggestModal<HistoryEntry> {
  private plugin: CursorHistoryPlugin;

  constructor(app: App, plugin: CursorHistoryPlugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder("Type to search cursor history...");
  }

  private getCurrentMode(): "edit" | "preview" {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      const mode = activeView.getMode();
      return mode === "source" ? "edit" : "preview";
    }
    // Default to read mode if no active markdown view detected
    return "preview";
  }

  getItems(): HistoryEntry[] {
    const mode = this.getCurrentMode();
    const stack = this.plugin.getNavStack().getStack(mode);
    return stack.slice().reverse();
  }

  getItemText(item: HistoryEntry): string {
    const line = item.mode === "edit" ? item.selection.startLine + 1 : Math.floor(item.selection.scrollLine) + 1;
    return `${line}: ${item.filePath}`;
  }

  onChooseItem(item: HistoryEntry, evt: MouseEvent | KeyboardEvent): void {
    void this.plugin.navigateTo(item);
  }
}
