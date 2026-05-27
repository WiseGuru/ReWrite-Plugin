import { TranscriptionProviderID } from '../types';

// Per-provider audio upload limits. Sources:
// - OpenAI Whisper: 25 MB (platform.openai.com/docs/guides/speech-to-text)
// - Groq: 25 MB on free tier; higher on paid tiers but the UI can't tell, so use the conservative number (console.groq.com/docs/speech-to-text)
// - AssemblyAI: 5 GB / 10 h (assemblyai.com/docs/faq)
// - Deepgram: 2 GB sync (developers.deepgram.com)
// - Rev.ai: 2 GB multipart / 17 h (docs.rev.ai/api/asynchronous)
// - Mistral Voxtral: 1 GB / 30 min (docs.mistral.ai/api/endpoint/audio/transcriptions)
// - openai-compatible / whisper-local / webspeech: no client-side cap
export interface TranscriptionLimits {
	readonly maxBytes?: number;
	readonly maxDurationMs?: number;
}

const MB = 1024 * 1024;
const GB = 1024 * MB;
const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export function getTranscriptionLimits(id: TranscriptionProviderID): TranscriptionLimits {
	switch (id) {
		case 'openai':
			return { maxBytes: 25 * MB };
		case 'groq':
			return { maxBytes: 25 * MB };
		case 'assemblyai':
			return { maxBytes: 5 * GB, maxDurationMs: 10 * HOUR };
		case 'deepgram':
			return { maxBytes: 2 * GB };
		case 'revai':
			return { maxBytes: 2 * GB, maxDurationMs: 17 * HOUR };
		case 'mistral-voxtral':
			return { maxBytes: 1 * GB, maxDurationMs: 30 * MIN };
		case 'openai-compatible':
		case 'whisper-local':
		case 'webspeech':
			return {};
	}
}

export function transcriptionProviderLabel(id: TranscriptionProviderID): string {
	switch (id) {
		case 'openai': return 'OpenAI Whisper';
		case 'groq': return 'Groq';
		case 'assemblyai': return 'AssemblyAI';
		case 'deepgram': return 'Deepgram';
		case 'revai': return 'Rev.ai';
		case 'mistral-voxtral': return 'Mistral Voxtral';
		case 'openai-compatible': return 'OpenAI-compatible';
		case 'whisper-local': return 'Local whisper.cpp';
		case 'webspeech': return 'Web Speech';
	}
}

export function validateRecording(
	blobSize: number,
	durationMs: number | undefined,
	id: TranscriptionProviderID,
): void {
	const limits = getTranscriptionLimits(id);
	const label = transcriptionProviderLabel(id);
	if (limits.maxBytes !== undefined && blobSize > limits.maxBytes) {
		const sizeMb = Math.round(blobSize / MB);
		const limitMb = Math.round(limits.maxBytes / MB);
		throw new Error(
			`Recording is ${sizeMb} MB which exceeds the ${label} ${limitMb} MB limit. Save the audio elsewhere or switch transcription provider in settings.`,
		);
	}
	if (
		limits.maxDurationMs !== undefined &&
		durationMs !== undefined &&
		durationMs > limits.maxDurationMs
	) {
		const mins = Math.round(durationMs / MIN);
		const limitMins = Math.round(limits.maxDurationMs / MIN);
		throw new Error(
			`Recording is ${mins} min which exceeds the ${label} ${limitMins} min limit. Switch transcription provider in settings.`,
		);
	}
}
