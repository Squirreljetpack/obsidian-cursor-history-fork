import { App, FuzzyMatch, FuzzySuggestModal, TFile } from "obsidian";
import type CursorHistoryPlugin from "./main";

export interface RecentFileItem {
  file: TFile;
  timestamp: number;
}

export class RecentFilesModal extends FuzzySuggestModal<RecentFileItem> {
  private plugin: CursorHistoryPlugin;

  constructor(app: App, plugin: CursorHistoryPlugin) {
    super(app);
    this.plugin = plugin;
    this.setPlaceholder("Type to search recently opened files...");
  }

  getItems(): RecentFileItem[] {
    return this.plugin.getRecentlyOpenedFiles();
  }

  getItemText(item: RecentFileItem): string {
    const path = item.file.path;
    return path.endsWith(".md") ? path.slice(0, -3) : path;
  }

  renderSuggestion(match: FuzzyMatch<RecentFileItem>, el: HTMLElement): void {
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

  onChooseItem(item: RecentFileItem, evt: MouseEvent | KeyboardEvent): void {
    void this.plugin.openRecentFile(item.file);
  }
}
