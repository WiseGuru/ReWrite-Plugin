export type TranscriptionProviderID =
	| 'none'
	| 'openai'
	| 'openai-compatible'
	| 'groq'
	| 'assemblyai'
	| 'deepgram'
	| 'revai'
	| 'mistral-voxtral'
	| 'whisper-local';

export type LLMProviderID =
	| 'none'
	| 'anthropic'
	| 'openai'
	| 'openai-compatible'
	| 'gemini'
	| 'mistral';

export interface TranscriptionConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	language: string;
	// Opt-in speaker diarization. Only honored by providers that support it
	// (assemblyai, deepgram, revai); ignored by the rest. When on, the capable
	// adapter embeds `Speaker X:` labels into the returned transcript string.
	diarize?: boolean;
}

export interface LLMConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	maxTokens: number;
}

export type InsertMode = 'cursor' | 'newFile' | 'append';

export interface NoteTemplate {
	id: string;
	name: string;
	prompt: string;
	insertMode: InsertMode;
	newFileFolder: string;
	newFileNameTemplate: string;
	// When true, the shared core preface is NOT prepended to this template's
	// prompt. Absent/false means the shared core is used (when one is loaded).
	disableSharedCore?: boolean;
	// When true, the modal / reprocess picker surfaces an optional free-text
	// "Context" field for this template (speakers, setting, subject). Opt-in:
	// absent/false means the field is hidden. NOTE the polarity is the reverse
	// of disableSharedCore (positive opt-in, not negative opt-out).
	enableContextHint?: boolean;
	// When true, forces speaker diarization on for this template's transcription,
	// regardless of the profile's "Identify speakers" toggle. Only effective on
	// diarization-capable providers (assemblyai/deepgram/revai); a no-op on the
	// rest. Absent/false means the profile setting governs.
	diarize?: boolean;
}

export interface DestinationOverride {
	insertMode?: InsertMode;
	newFileFolder?: string;
	newFileNameTemplate?: string;
}

export interface KnownNoun {
	canonical: string;
	alternates: string[];
}

export interface PipelineHost {
	sharedCore: string | null;
	assistantPrompt: string | null;
	knownNouns: KnownNoun[];
}

export interface EnvironmentProfile {
	name: string;
	transcriptionProvider: TranscriptionProviderID;
	transcriptionConfig: TranscriptionConfig;
	llmProvider: LLMProviderID;
	llmConfig: LLMConfig;
}

export type ActiveProfileOverride = 'auto' | 'desktop' | 'mobile';
export type ActiveProfileKind = 'desktop' | 'mobile';
export type RecordingFormatPreference = 'webm' | 'mp4';
export type NewFileCollisionMode = 'auto' | 'prompt';

export interface ModelCacheEntry {
	ids: string[];
	fetchedAt: number;
}

export interface ModelCache {
	transcription: Partial<Record<TranscriptionProviderID, ModelCacheEntry>>;
	llm: Partial<Record<LLMProviderID, ModelCacheEntry>>;
}

export interface LocalWhisperSettings {
	binaryPath: string;
	modelPath: string;
	port: number;
	extraArgs: string;
}

export interface GlobalSettings {
	activeProfileOverride: ActiveProfileOverride;
	desktopProfile: EnvironmentProfile;
	mobileProfile: EnvironmentProfile;
	defaultTemplateId: string;
	lastUsedTemplateId: string;
	quickRecordTemplateId: string;
	recordingFormat: RecordingFormatPreference;
	templatesFolderPath: string;
	sharedCorePath: string;
	attachmentsFolderPath: string;
	newFileCollisionMode: NewFileCollisionMode;
	adHocInstructionsEnabled: boolean;
	assistantName: string;
	assistantPromptPath: string;
	knownNounsPath: string;
	modelCache: ModelCache;
	localWhisper: LocalWhisperSettings;
}
