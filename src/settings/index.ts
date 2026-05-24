import { Plugin } from 'obsidian';
import {
	ActiveProfileKind,
	EnvironmentProfile,
	GlobalSettings,
	LLMConfig,
	LLMProviderID,
	ProviderFamily,
	TranscriptionConfig,
	TranscriptionProviderID,
} from '../types';
import { loadAllKeys, saveManyKeys } from '../secrets';
import { freshDefaultTemplates } from './default-templates';

const EMPTY_TRANSCRIPTION_CONFIG: TranscriptionConfig = {
	apiKey: '',
	baseUrl: '',
	model: '',
	language: '',
};

const EMPTY_LLM_CONFIG: LLMConfig = {
	apiKey: '',
	baseUrl: '',
	model: '',
	maxTokens: 2048,
};

const DESKTOP_DEFAULT_PROFILE: EnvironmentProfile = {
	name: 'Desktop',
	transcriptionProvider: 'openai',
	transcriptionConfig: { ...EMPTY_TRANSCRIPTION_CONFIG },
	llmProvider: 'anthropic',
	llmConfig: { ...EMPTY_LLM_CONFIG },
};

const MOBILE_DEFAULT_PROFILE: EnvironmentProfile = {
	name: 'Mobile',
	transcriptionProvider: 'webspeech',
	transcriptionConfig: { ...EMPTY_TRANSCRIPTION_CONFIG },
	llmProvider: 'anthropic',
	llmConfig: { ...EMPTY_LLM_CONFIG },
};

export const DEFAULT_SETTINGS: GlobalSettings = {
	apiKeys: {},
	activeProfileOverride: 'auto',
	desktopProfile: DESKTOP_DEFAULT_PROFILE,
	mobileProfile: MOBILE_DEFAULT_PROFILE,
	defaultTemplateId: '',
	lastUsedTemplateId: '',
	recordingFormat: 'webm',
	templates: [],
};

const PROVIDER_FAMILIES: ProviderFamily[] = [
	'openai',
	'anthropic',
	'groq',
	'assemblyai',
	'deepgram',
	'revai',
	'gemini',
	'mistral',
];

const PROFILE_KINDS: ActiveProfileKind[] = ['desktop', 'mobile'];

function globalKeyId(family: ProviderFamily): string {
	return `global:${family}`;
}

function profileTranscriptionKeyId(kind: ActiveProfileKind): string {
	return `profile:${kind}:transcription`;
}

function profileLLMKeyId(kind: ActiveProfileKind): string {
	return `profile:${kind}:llm`;
}

export async function loadSettings(plugin: Plugin): Promise<GlobalSettings> {
	const stored = (await plugin.loadData()) as Partial<GlobalSettings> | null;
	const merged = mergeSettings(DEFAULT_SETTINGS, stored ?? {});
	if (merged.templates.length === 0) {
		merged.templates = freshDefaultTemplates();
		if (!merged.defaultTemplateId) {
			merged.defaultTemplateId = merged.templates[0]?.id ?? '';
		}
	}
	await hydrateSecrets(plugin, merged);
	return merged;
}

export async function saveSettings(plugin: Plugin, settings: GlobalSettings): Promise<void> {
	await persistSecrets(plugin, settings);
	const stripped = stripSecrets(settings);
	await plugin.saveData(stripped);
}

async function hydrateSecrets(plugin: Plugin, settings: GlobalSettings): Promise<void> {
	const all = await loadAllKeys(plugin);
	for (const family of PROVIDER_FAMILIES) {
		const value = all[globalKeyId(family)];
		if (value) settings.apiKeys[family] = value;
	}
	for (const kind of PROFILE_KINDS) {
		const profile = profileFor(settings, kind);
		const trKey = all[profileTranscriptionKeyId(kind)];
		if (trKey) profile.transcriptionConfig.apiKey = trKey;
		const llmKey = all[profileLLMKeyId(kind)];
		if (llmKey) profile.llmConfig.apiKey = llmKey;
	}
}

async function persistSecrets(plugin: Plugin, settings: GlobalSettings): Promise<void> {
	const updates: Record<string, string> = {};
	for (const family of PROVIDER_FAMILIES) {
		updates[globalKeyId(family)] = settings.apiKeys[family] ?? '';
	}
	for (const kind of PROFILE_KINDS) {
		const profile = profileFor(settings, kind);
		updates[profileTranscriptionKeyId(kind)] = profile.transcriptionConfig.apiKey;
		updates[profileLLMKeyId(kind)] = profile.llmConfig.apiKey;
	}
	await saveManyKeys(plugin, updates);
}

function stripSecrets(settings: GlobalSettings): GlobalSettings {
	return {
		...settings,
		apiKeys: {},
		desktopProfile: stripProfileKeys(settings.desktopProfile),
		mobileProfile: stripProfileKeys(settings.mobileProfile),
	};
}

function stripProfileKeys(profile: EnvironmentProfile): EnvironmentProfile {
	return {
		...profile,
		transcriptionConfig: { ...profile.transcriptionConfig, apiKey: '' },
		llmConfig: { ...profile.llmConfig, apiKey: '' },
	};
}

function profileFor(settings: GlobalSettings, kind: ActiveProfileKind): EnvironmentProfile {
	return kind === 'desktop' ? settings.desktopProfile : settings.mobileProfile;
}

function mergeSettings(
	base: GlobalSettings,
	partial: Partial<GlobalSettings>,
): GlobalSettings {
	return {
		...base,
		...partial,
		apiKeys: { ...base.apiKeys, ...(partial.apiKeys ?? {}) },
		desktopProfile: mergeProfile(base.desktopProfile, partial.desktopProfile),
		mobileProfile: mergeProfile(base.mobileProfile, partial.mobileProfile),
		templates: partial.templates ?? base.templates,
	};
}

function mergeProfile(
	base: EnvironmentProfile,
	partial: Partial<EnvironmentProfile> | undefined,
): EnvironmentProfile {
	if (!partial) return base;
	return {
		...base,
		...partial,
		transcriptionConfig: {
			...base.transcriptionConfig,
			...(partial.transcriptionConfig ?? {}),
		},
		llmConfig: {
			...base.llmConfig,
			...(partial.llmConfig ?? {}),
		},
	};
}

export function transcriptionProviderFamily(id: TranscriptionProviderID): ProviderFamily | null {
	switch (id) {
		case 'openai':
			return 'openai';
		case 'groq':
			return 'groq';
		case 'assemblyai':
			return 'assemblyai';
		case 'deepgram':
			return 'deepgram';
		case 'revai':
			return 'revai';
		case 'openai-compatible':
		case 'webspeech':
			return null;
	}
}

export function llmProviderFamily(id: LLMProviderID): ProviderFamily | null {
	switch (id) {
		case 'anthropic':
			return 'anthropic';
		case 'openai':
			return 'openai';
		case 'gemini':
			return 'gemini';
		case 'mistral':
			return 'mistral';
		case 'openai-compatible':
			return null;
	}
}

export function resolveTranscriptionApiKey(
	settings: GlobalSettings,
	profile: EnvironmentProfile,
): string {
	if (profile.transcriptionConfig.apiKey) return profile.transcriptionConfig.apiKey;
	const family = transcriptionProviderFamily(profile.transcriptionProvider);
	if (!family) return '';
	return settings.apiKeys[family] ?? '';
}

export function resolveLLMApiKey(
	settings: GlobalSettings,
	profile: EnvironmentProfile,
): string {
	if (profile.llmConfig.apiKey) return profile.llmConfig.apiKey;
	const family = llmProviderFamily(profile.llmProvider);
	if (!family) return '';
	return settings.apiKeys[family] ?? '';
}
