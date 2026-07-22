import { App, FuzzyMatch, FuzzySuggestModal, MarkdownView } from "obsidian";
import type CursorHistoryPlugin from "./main";
import { HistoryEntry } from "./navigation-stack";

export class CurrentFileHistoryModal extends FuzzySuggestModal<HistoryEntry> {
  private plugin: CursorHistoryPlugin;
  private lines: string[] = [];

  constructor(app: App, plugin: CursorHistoryPlugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder("Type to search current file cursor history...");
  }

  onOpen(): void {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      const content = activeView.editor ? activeView.editor.getValue() : (activeView.data || "");
      this.lines = content.split("\n");
    } else {
      this.lines = [];
    }
    super.onOpen();
  }

  private getCurrentMode(): "edit" | "preview" {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      const mode = activeView.getMode();
      return mode === "source" ? "edit" : "preview";
    }
    return "preview";
  }

  getItems(): HistoryEntry[] {
    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!activeView || !activeView.file) return [];

    const mode = this.getCurrentMode();
    const stack = this.plugin.getNavStack().getStackForFile(activeView.file.path, mode);
    return stack.slice().reverse();
  }

  getItemText(item: HistoryEntry): string {
    const lineNum = item.mode === "edit" ? item.selection.startLine + 1 : Math.floor(item.selection.scrollLine) + 1;
    const lineIndex = lineNum - 1;
    const lineContent = (this.lines[lineIndex] ?? "").trim();
    return `${lineNum}: ${lineContent}`;
  }

  renderSuggestion(match: FuzzyMatch<HistoryEntry>, el: HTMLElement): void {
    super.renderSuggestion(match, el);
    if (this.plugin.settings.showDateInModal && match.item.timestamp) {
      el.style.display = "flex";
      el.style.justifyContent = "space-between";
      el.style.alignItems = "center";
      const dateStr = new Date(match.item.timestamp).toLocaleString();
      const dateEl = el.createEl("span", {
        text: dateStr,
        cls: "cursor-history-modal-date",
      });
      dateEl.style.color = "var(--text-muted, gray)";
      dateEl.style.fontSize = "0.8em";
      dateEl.style.marginLeft = "10px";
      dateEl.style.whiteSpace = "nowrap";
    }
  }

  onChooseItem(item: HistoryEntry, evt: MouseEvent | KeyboardEvent): void {
    void this.plugin.navigateTo(item);
  }
}
