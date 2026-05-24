import { Setting } from 'obsidian';
import { EnvironmentProfile, GlobalSettings, LLMProviderID, TranscriptionProviderID } from '../types';
import { llmProviderFamily, resolveLLMApiKey, resolveTranscriptionApiKey, transcriptionProviderFamily } from '../settings';

const TRANSCRIPTION_OPTIONS: Array<{ id: TranscriptionProviderID; label: string }> = [
	{ id: 'openai', label: 'OpenAI Whisper' },
	{ id: 'openai-compatible', label: 'OpenAI-compatible (local server)' },
	{ id: 'groq', label: 'Groq' },
	{ id: 'assemblyai', label: 'AssemblyAI' },
	{ id: 'deepgram', label: 'Deepgram' },
	{ id: 'revai', label: 'Rev.ai' },
	{ id: 'webspeech', label: 'Web Speech (browser)' },
];

const LLM_OPTIONS: Array<{ id: LLMProviderID; label: string }> = [
	{ id: 'anthropic', label: 'Anthropic Claude' },
	{ id: 'openai', label: 'OpenAI GPT' },
	{ id: 'openai-compatible', label: 'OpenAI-compatible (local server)' },
	{ id: 'gemini', label: 'Google Gemini' },
	{ id: 'mistral', label: 'Mistral' },
];

export function isProfileConfigured(profile: EnvironmentProfile, settings: GlobalSettings): boolean {
	const tx = profile.transcriptionProvider;
	if (tx !== 'webspeech') {
		if (!profile.transcriptionConfig.model) return false;
		if (!resolveTranscriptionApiKey(settings, profile)) return false;
		if (tx === 'openai-compatible' && !profile.transcriptionConfig.baseUrl.trim()) return false;
	}
	if (!profile.llmConfig.model) return false;
	if (!resolveLLMApiKey(settings, profile)) return false;
	if (profile.llmProvider === 'openai-compatible' && !profile.llmConfig.baseUrl.trim()) return false;
	return true;
}

export interface SetupCardParams {
	container: HTMLElement;
	settings: GlobalSettings;
	profile: EnvironmentProfile;
	profileLabel: string;
	onSaved: () => Promise<void>;
	onOpenSettings: () => void;
}

export function renderSetupCard(params: SetupCardParams): void {
	const { container, profile, settings, profileLabel } = params;
	const card = container.createDiv({ cls: 'rewrite-setup-card' });
	card.createEl('h3', { text: 'Setup required' });
	card.createEl('p', {
		text: `Your ${profileLabel} profile needs a transcription provider and an LLM. Fill in the basics here or open settings for full configuration.`,
	});

	new Setting(card)
		.setName('Transcription provider')
		.addDropdown((dd) => {
			for (const opt of TRANSCRIPTION_OPTIONS) dd.addOption(opt.id, opt.label);
			dd.setValue(profile.transcriptionProvider);
			dd.onChange((v) => {
				profile.transcriptionProvider = v as TranscriptionProviderID;
				profile.transcriptionConfig.apiKey = '';
				container.empty();
				renderSetupCard(params);
			});
		});

	if (profile.transcriptionProvider !== 'webspeech') {
		new Setting(card)
			.setName('Transcription model')
			.setDesc(modelPlaceholderForTranscription(profile.transcriptionProvider))
			.addText((t) => {
				t.setValue(profile.transcriptionConfig.model);
				t.onChange((v) => {
					profile.transcriptionConfig.model = v;
				});
			});

		if (profile.transcriptionProvider === 'openai-compatible') {
			new Setting(card)
				.setName('Transcription base URL')
				.setDesc('e.g. http://localhost:8080 (whisper.cpp, faster-whisper-server)')
				.addText((t) => {
					t.setValue(profile.transcriptionConfig.baseUrl);
					t.onChange((v) => {
						profile.transcriptionConfig.baseUrl = v;
					});
				});
		}

		renderApiKeyField(card, {
			label: 'Transcription API key',
			placeholder: 'Saved securely on this device',
			getValue: () => keyFieldValue('transcription', settings, profile),
			setValue: (v) => writeKeyField('transcription', settings, profile, v),
		});
	}

	new Setting(card)
		.setName('LLM provider')
		.addDropdown((dd) => {
			for (const opt of LLM_OPTIONS) dd.addOption(opt.id, opt.label);
			dd.setValue(profile.llmProvider);
			dd.onChange((v) => {
				profile.llmProvider = v as LLMProviderID;
				profile.llmConfig.apiKey = '';
				container.empty();
				renderSetupCard(params);
			});
		});

	new Setting(card)
		.setName('LLM model')
		.setDesc(modelPlaceholderForLLM(profile.llmProvider))
		.addText((t) => {
			t.setValue(profile.llmConfig.model);
			t.onChange((v) => {
				profile.llmConfig.model = v;
			});
		});

	if (profile.llmProvider === 'openai-compatible') {
		new Setting(card)
			.setName('LLM base URL')
			.setDesc('e.g. http://localhost:11434/v1 (Ollama) or http://localhost:1234/v1 (LM Studio)')
			.addText((t) => {
				t.setValue(profile.llmConfig.baseUrl);
				t.onChange((v) => {
					profile.llmConfig.baseUrl = v;
				});
			});
	}

	renderApiKeyField(card, {
		label: 'LLM API key',
		placeholder: 'Saved securely on this device',
		getValue: () => keyFieldValue('llm', settings, profile),
		setValue: (v) => writeKeyField('llm', settings, profile, v),
	});

	const actions = card.createDiv({ cls: 'rewrite-setup-actions' });
	const saveBtn = actions.createEl('button', { text: 'Save and continue', cls: 'mod-cta' });
	saveBtn.addEventListener('click', () => {
		void params.onSaved();
	});
	const openSettings = actions.createEl('button', { text: 'Open full settings' });
	openSettings.addEventListener('click', () => params.onOpenSettings());
}

interface KeyField {
	label: string;
	placeholder: string;
	getValue: () => string;
	setValue: (v: string) => void;
}

function renderApiKeyField(container: HTMLElement, field: KeyField): void {
	new Setting(container)
		.setName(field.label)
		.addText((t) => {
			t.inputEl.type = 'password';
			t.setPlaceholder(field.placeholder);
			t.setValue(field.getValue());
			t.onChange((v) => field.setValue(v));
		});
}

function keyFieldValue(
	side: 'transcription' | 'llm',
	settings: GlobalSettings,
	profile: EnvironmentProfile,
): string {
	const family = side === 'transcription'
		? transcriptionProviderFamily(profile.transcriptionProvider)
		: llmProviderFamily(profile.llmProvider);
	const profileKey = side === 'transcription' ? profile.transcriptionConfig.apiKey : profile.llmConfig.apiKey;
	if (profileKey) return profileKey;
	if (family) return settings.apiKeys[family] ?? '';
	return '';
}

function writeKeyField(
	side: 'transcription' | 'llm',
	settings: GlobalSettings,
	profile: EnvironmentProfile,
	value: string,
): void {
	const family = side === 'transcription'
		? transcriptionProviderFamily(profile.transcriptionProvider)
		: llmProviderFamily(profile.llmProvider);
	if (family) {
		settings.apiKeys[family] = value;
		if (side === 'transcription') profile.transcriptionConfig.apiKey = '';
		else profile.llmConfig.apiKey = '';
	} else {
		if (side === 'transcription') profile.transcriptionConfig.apiKey = value;
		else profile.llmConfig.apiKey = value;
	}
}

function modelPlaceholderForTranscription(id: TranscriptionProviderID): string {
	switch (id) {
		case 'openai':
			return 'e.g. whisper-1';
		case 'groq':
			return 'e.g. whisper-large-v3-turbo';
		case 'assemblyai':
			return 'Optional. e.g. universal or nano';
		case 'deepgram':
			return 'e.g. nova-2 or nova-3';
		case 'revai':
			return 'Optional transcriber name';
		case 'openai-compatible':
			return 'Whichever model your local server exposes';
		case 'webspeech':
			return '';
	}
}

function modelPlaceholderForLLM(id: LLMProviderID): string {
	switch (id) {
		case 'anthropic':
			return 'e.g. claude-sonnet-4-5 or claude-haiku-4-5-20251001';
		case 'openai':
			return 'e.g. gpt-4o-mini';
		case 'gemini':
			return 'e.g. gemini-2.0-flash';
		case 'mistral':
			return 'e.g. mistral-large-latest';
		case 'openai-compatible':
			return 'Whichever model your local server exposes';
	}
}
