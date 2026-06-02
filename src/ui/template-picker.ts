import { App, Modal, Platform } from 'obsidian';
import { NoteTemplate } from '../types';

export interface TemplatePickerParams {
	app: App;
	templates: NoteTemplate[];
	defaultTemplateId: string;
	previewText: string;
	// When true, surface an optional collapsed "Context" field above the list.
	// The trimmed value is handed to onPick; the caller decides whether to honor
	// it (e.g. only when the picked template has `enableContextHint`).
	showContext?: boolean;
	onPick: (template: NoteTemplate, contextHint: string) => void;
}

export class TemplatePickerModal extends Modal {
	private contextHint = '';

	constructor(private readonly params: TemplatePickerParams) {
		super(params.app);
	}

	onOpen(): void {
		this.modalEl.addClass('rewrite-modal');
		const { contentEl } = this;
		contentEl.createEl('h2', { text: 'Pick a template' });
		if (this.params.previewText) {
			contentEl.createEl('p', {
				text: this.params.previewText,
				cls: 'rewrite-template-picker-preview',
			});
		}

		if (this.params.templates.length === 0) {
			contentEl.createEl('p', { text: 'No templates configured. Add one in settings.' });
			return;
		}

		if (this.params.showContext) this.renderContext(contentEl);

		const list = contentEl.createDiv({ cls: 'rewrite-template-picker-list' });
		for (const template of this.params.templates) {
			const item = list.createEl('button', {
				text: template.name || '(unnamed)',
				cls: 'rewrite-template-picker-item',
			});
			if (template.id === this.params.defaultTemplateId) item.addClass('mod-cta');
			item.addEventListener('click', () => {
				this.close();
				this.params.onPick(template, this.contextHint.trim());
			});
		}
	}

	private renderContext(parent: HTMLElement): void {
		const details = parent.createEl('details', { cls: 'rewrite-context-row' });
		const summary = details.createEl('summary', { cls: 'rewrite-context-summary' });
		summary.createSpan({ cls: 'rewrite-context-summary-label', text: 'Context: ' });
		summary.createSpan({ cls: 'rewrite-context-summary-value', text: 'None (optional)' });

		const body = details.createDiv({ cls: 'rewrite-context-body' });
		const textarea = body.createEl('textarea', { cls: 'rewrite-context-input' });
		textarea.rows = Platform.isMobile ? 2 : 3;
		textarea.placeholder = 'Who is speaking and what this recording is (for example a lecture by one professor, or a meeting with several teammates)';
		textarea.addEventListener('input', () => {
			this.contextHint = textarea.value;
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
