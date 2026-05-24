import { Plugin } from 'obsidian';
import { loadSettings, saveSettings } from './settings';
import { ReWriteSettingTab } from './settings/tab';
import { ReWriteModal } from './ui/modal';
import { QuickRecordController, startQuickRecord } from './ui/quick-record';
import { GlobalSettings } from './types';

export default class ReWritePlugin extends Plugin {
	settings!: GlobalSettings;
	private activeQuickRecord: QuickRecordController | null = null;

	async onload(): Promise<void> {
		this.settings = await loadSettings(this);
		this.addSettingTab(new ReWriteSettingTab(this.app, this));

		this.addRibbonIcon('mic', 'ReWrite', () => {
			this.openModal();
		});

		this.addCommand({
			id: 'open-modal',
			name: 'Open',
			callback: () => {
				this.openModal();
			},
		});

		this.addCommand({
			id: 'quick-record',
			name: 'Quick record',
			callback: () => {
				void this.toggleQuickRecord();
			},
		});
	}

	onunload(): void {
		this.activeQuickRecord?.cancel();
		this.activeQuickRecord = null;
	}

	async saveSettings(): Promise<void> {
		await saveSettings(this, this.settings);
	}

	private openModal(): void {
		new ReWriteModal(this.app, this).open();
	}

	private async toggleQuickRecord(): Promise<void> {
		if (this.activeQuickRecord) {
			await this.activeQuickRecord.finish();
			return;
		}
		this.activeQuickRecord = await startQuickRecord(this, () => {
			this.activeQuickRecord = null;
		});
	}
}
