import { App, PluginSettingTab, Setting } from 'obsidian';
import type CursorHistoryPlugin from './main';

export interface CursorHistorySettings {
	hotkeyDefaultsApplied: boolean;
	useFolderLocalHistory: boolean;
	restoreScrollPosition: boolean;
	maxEntries: number;
	jumpThreshold: number;
}

export const DEFAULT_SETTINGS: CursorHistorySettings = {
	hotkeyDefaultsApplied: false,
	useFolderLocalHistory: false,
	restoreScrollPosition: true,
	maxEntries: 50,
	jumpThreshold: 10,
};

export class CursorHistorySettingTab extends PluginSettingTab {
	plugin: CursorHistoryPlugin;

	constructor(app: App, plugin: CursorHistoryPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Cursor History Settings' });

		new Setting(containerEl)
			.setName('Use folder local history')
			.setDesc('Save history stack to .obsidian/cursor-history.json instead of plugin data.json')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.useFolderLocalHistory)
					.onChange(async value => {
						this.plugin.settings.useFolderLocalHistory = value;
						await this.plugin.saveSettingsAndHistory();
					})
			);

		new Setting(containerEl)
			.setName('Restore scroll position on file open')
			.setDesc('Automatically restore the last known cursor or scroll position when opening a file in the normal way')
			.addToggle(toggle =>
				toggle
					.setValue(this.plugin.settings.restoreScrollPosition)
					.onChange(async value => {
						this.plugin.settings.restoreScrollPosition = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Max history entries')
			.setDesc('Maximum number of global history positions to keep in each stack (default: 50)')
			.addText(text =>
				text
					.setPlaceholder('50')
					.setValue(String(this.plugin.settings.maxEntries))
					.onChange(async value => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.maxEntries = num;
							this.plugin.updateMaxEntries(num);
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName('Jump threshold (lines)')
			.setDesc('Minimum line difference required to record a new history entry during editing (default: 10)')
			.addText(text =>
				text
					.setPlaceholder('10')
					.setValue(String(this.plugin.settings.jumpThreshold))
					.onChange(async value => {
						const num = parseInt(value, 10);
						if (!isNaN(num) && num >= 1) {
							this.plugin.settings.jumpThreshold = num;
							await this.plugin.saveSettings();
						}
					})
			);
	}
}
