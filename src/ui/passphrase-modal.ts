import { App, Modal, Notice, Platform, Setting } from 'obsidian';
import { evaluatePassphrase, MIN_PASSPHRASE_SCORE, warmPassphraseStrength } from 'passphrase-strength';
import { generateDicewarePassphrase } from 'diceware';

const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'];

export interface PassphrasePromptParams {
	app: App;
	title: string;
	description?: string;
	confirmLabel?: string;
	// When true, render a second "Confirm passphrase" field that must match.
	requireConfirm?: boolean;
	// When set, render a plain-text confirmation field above the passphrase that must
	// exactly match this phrase before submit is allowed (e.g. "DELETE APIS" for the
	// destructive reset flow).
	requirePhrase?: string;
	// When true (create/change flows), render the strength meter + Generate button and
	// block submit below MIN_PASSPHRASE_SCORE. Leave false for the unlock flow.
	enforceStrength?: boolean;
	// Called with the entered passphrase. Throw to keep the modal open and surface an error.
	onSubmit: (passphrase: string) => Promise<void>;
}

export class PassphraseModal extends Modal {
	private passphrase = '';
	private confirm = '';
	private phrase = '';
	private busy = false;
	private errorEl: HTMLElement | null = null;
	private tipsEl: HTMLDetailsElement | null = null;
	private passInput: HTMLInputElement | null = null;
	private confirmInput: HTMLInputElement | null = null;
	private phraseInput: HTMLInputElement | null = null;
	private strengthBarEl: HTMLElement | null = null;
	private strengthTextEl: HTMLElement | null = null;
	private strengthTimer: number | null = null;
	private strengthSeq = 0;

	constructor(private readonly params: PassphrasePromptParams) {
		super(params.app);
	}

	onOpen(): void {
		this.modalEl.addClass('rewrite-modal');
		this.modalEl.addClass('rewrite-passphrase-modal');
		const { contentEl } = this;
		contentEl.createEl('h2', { text: this.params.title });

		if (this.params.description) {
			contentEl.createEl('p', { text: this.params.description, cls: 'rewrite-passphrase-desc' });
		}

		if (this.params.requirePhrase) {
			const phrase = this.params.requirePhrase;
			new Setting(contentEl)
				.setName(`Type "${phrase}" to confirm`)
				.setDesc('This permanently deletes all stored API keys.')
				.addText((t) => {
					t.inputEl.addClass('rewrite-passphrase-confirm-phrase');
					this.phraseInput = t.inputEl;
					t.onChange((v) => { this.phrase = v; });
					t.inputEl.addEventListener('keydown', (e) => this.onKeydown(e));
				});
		}

		if (this.params.requireConfirm) {
			this.renderPassphraseTips(contentEl);
		}

		const passSetting = new Setting(contentEl)
			.setName('Passphrase')
			.addText((t) => {
				t.inputEl.type = 'password';
				t.inputEl.addClass('rewrite-passphrase-input');
				// On mobile, programmatic autofocus would fire `focus` (collapsing
				// the tips) before the user has read them; let the user's tap do it.
				t.inputEl.autofocus = !Platform.isMobile;
				this.passInput = t.inputEl;
				t.onChange((v) => {
					this.passphrase = v;
					this.scheduleStrengthUpdate();
				});
				t.inputEl.addEventListener('focus', () => this.collapseTipsOnMobile());
				t.inputEl.addEventListener('keydown', (e) => this.onKeydown(e));
			});

		if (this.params.enforceStrength) {
			// Begin loading the estimator now (while the user reads the tips / picks a
			// field) so the first keystroke does not pay the dictionary-build cost.
			warmPassphraseStrength();
			passSetting.addButton((b) => {
				b.setButtonText('Generate')
					.setTooltip('Generate a 6-word passphrase')
					.onClick(() => this.fillGenerated());
				b.buttonEl.addClass('rewrite-passphrase-generate');
			});
			this.renderStrengthMeter(contentEl);
		}

		if (this.params.requireConfirm) {
			new Setting(contentEl)
				.setName('Confirm passphrase')
				.addText((t) => {
					t.inputEl.type = 'password';
					t.inputEl.addClass('rewrite-passphrase-input');
					this.confirmInput = t.inputEl;
					t.onChange((v) => { this.confirm = v; });
					t.inputEl.addEventListener('focus', () => this.collapseTipsOnMobile());
					t.inputEl.addEventListener('keydown', (e) => this.onKeydown(e));
				});

			contentEl.createEl('p', {
				text: 'If you lose this passphrase, you will need to re-enter every API key. There is no recovery.',
				cls: 'rewrite-passphrase-warning',
			});
		}

		this.errorEl = contentEl.createEl('p', { cls: 'rewrite-passphrase-error rewrite-hidden' });

		const actions = contentEl.createDiv({ cls: 'rewrite-passphrase-actions' });
		const submit = actions.createEl('button', { text: this.params.confirmLabel ?? 'Unlock', cls: 'mod-cta' });
		submit.addEventListener('click', () => { void this.submit(); });
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.addEventListener('click', () => this.close());
	}

	onClose(): void {
		if (this.strengthTimer !== null) {
			window.clearTimeout(this.strengthTimer);
			this.strengthTimer = null;
		}
		// Invalidate any in-flight strength evaluation and drop DOM refs so a late
		// async result does not write to detached nodes.
		this.strengthSeq++;
		this.strengthBarEl = null;
		this.strengthTextEl = null;
		this.passphrase = '';
		this.confirm = '';
		this.phrase = '';
		this.contentEl.empty();
	}

	private renderPassphraseTips(parent: HTMLElement): void {
		// Expanded by default everywhere so the guidance is seen before typing
		// (opt-out, not opt-in). On mobile it auto-collapses when a passphrase
		// field is focused (see collapseTipsOnMobile), so it doesn't push the
		// fields into the soft keyboard once the user starts entering a value.
		const tips = parent.createEl('details', { cls: 'rewrite-passphrase-tips' });
		tips.setAttr('open', '');
		this.tipsEl = tips;
		tips.createEl('summary', { text: 'Picking a strong passphrase' });

		const list = tips.createEl('ul');

		const li1 = list.createEl('li');
		li1.createSpan({ text: 'Length beats complexity. The Generate button makes a 6-word diceware passphrase, far stronger than ' });
		li1.createEl('code', { text: 'P@ssw0rd!' });
		li1.createSpan({ text: ' and much easier to remember than ' });
		// eslint-disable-next-line obsidianmd/ui/sentence-case
		li1.createEl('code', { text: 'xv^02>lWP6nm2gR' });
		li1.createSpan({ text: '.' });

		const li2 = list.createEl('li');
		li2.createEl('strong', { text: 'Never reuse a password from elsewhere.' });
		li2.createSpan({ text: ' If it appears in a breach corpus, it can be cracked instantly no matter how complex it looks.' });

		const li3 = list.createEl('li');
		li3.createSpan({ text: 'Check candidates against ' });
		appendExternalLink(li3, 'haveibeenpwned.com/Passwords', 'https://haveibeenpwned.com/Passwords');
		li3.createSpan({ text: ' before using them. See ' });
		appendExternalLink(li3, 'hivesystems.com/password', 'https://www.hivesystems.com/password');
		li3.createSpan({ text: ' for brute-force time estimates by length and character class.' });
	}

	private renderStrengthMeter(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: 'rewrite-passphrase-strength' });
		this.strengthBarEl = wrap.createDiv({ cls: 'rewrite-passphrase-strength-bar' });
		for (let i = 0; i < 4; i++) {
			this.strengthBarEl.createDiv({ cls: 'rewrite-passphrase-strength-seg' });
		}
		this.strengthTextEl = wrap.createDiv({ cls: 'rewrite-passphrase-strength-text' });
		void this.updateStrength();
	}

	private scheduleStrengthUpdate(): void {
		if (!this.params.enforceStrength) return;
		if (this.strengthTimer !== null) window.clearTimeout(this.strengthTimer);
		this.strengthTimer = window.setTimeout(() => {
			this.strengthTimer = null;
			void this.updateStrength();
		}, 150);
	}

	private async updateStrength(): Promise<void> {
		if (!this.strengthBarEl || !this.strengthTextEl) return;
		// Guard against out-of-order async results: only the most recent call wins.
		const seq = ++this.strengthSeq;
		const pass = this.passphrase;
		const empty = pass.length === 0;
		const { score, warning, suggestions } = empty
			? { score: 0, warning: '', suggestions: [] as string[] }
			: await evaluatePassphrase(pass);
		// A newer keystroke (or modal close) superseded this evaluation; drop it.
		if (seq !== this.strengthSeq || !this.strengthBarEl || !this.strengthTextEl) return;
		const level = score <= 1 ? 'is-weak' : score === 2 ? 'is-fair' : score === 3 ? 'is-good' : 'is-strong';
		const filled = empty ? 0 : Math.max(score, 1);
		const segs = Array.from(this.strengthBarEl.children) as HTMLElement[];
		segs.forEach((seg, i) => {
			seg.removeClass('is-weak', 'is-fair', 'is-good', 'is-strong', 'is-filled');
			if (i < filled) {
				seg.addClass('is-filled');
				seg.addClass(level);
			}
		});

		let msg = '';
		if (!empty) {
			msg = STRENGTH_LABELS[score] ?? '';
			if (score < MIN_PASSPHRASE_SCORE) {
				const hint = warning || suggestions[0] || 'Add more words or make it more unique.';
				msg = `${msg}: ${hint}`;
			}
		}
		this.strengthTextEl.setText(msg);
		this.strengthTextEl.toggleClass('is-acceptable', !empty && score >= MIN_PASSPHRASE_SCORE);
	}

	private fillGenerated(): void {
		const phrase = generateDicewarePassphrase(6);
		this.passphrase = phrase;
		this.confirm = phrase;
		// Reveal so the user can read/copy what was generated.
		if (this.passInput) {
			this.passInput.value = phrase;
			this.passInput.type = 'text';
		}
		if (this.confirmInput) {
			this.confirmInput.value = phrase;
			this.confirmInput.type = 'text';
		}
		void this.updateStrength();
		this.clearError();
	}

	private collapseTipsOnMobile(): void {
		if (Platform.isMobile) this.tipsEl?.removeAttribute('open');
	}

	private onKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter') {
			e.preventDefault();
			void this.submit();
		}
	}

	private setError(msg: string): void {
		if (!this.errorEl) return;
		this.errorEl.setText(msg);
		this.errorEl.removeClass('rewrite-hidden');
	}

	private clearError(): void {
		if (!this.errorEl) return;
		this.errorEl.setText('');
		this.errorEl.addClass('rewrite-hidden');
	}

	private async submit(): Promise<void> {
		if (this.busy) return;
		this.clearError();

		if (this.params.requirePhrase && this.phrase !== this.params.requirePhrase) {
			this.setError(`Type "${this.params.requirePhrase}" exactly to confirm.`);
			return;
		}
		if (this.passphrase.length === 0) {
			this.setError('Enter a passphrase.');
			return;
		}
		if (this.params.requireConfirm && this.passphrase !== this.confirm) {
			this.setError('Passphrases do not match.');
			return;
		}
		if (this.params.enforceStrength && (await evaluatePassphrase(this.passphrase)).score < MIN_PASSPHRASE_SCORE) {
			this.setError('Passphrase is too weak. Add more words or use Generate.');
			return;
		}
		this.busy = true;
		try {
			await this.params.onSubmit(this.passphrase);
			this.close();
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			this.setError(msg);
			new Notice(msg);
		} finally {
			this.busy = false;
		}
	}
}

function appendExternalLink(parent: HTMLElement, label: string, href: string): void {
	const a = parent.createEl('a', { text: label, href });
	a.target = '_blank';
	a.rel = 'noopener noreferrer';
}
