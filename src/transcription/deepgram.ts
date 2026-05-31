import { TranscriptionConfig } from '../types';
import { jsonGet, providerRequest } from '../http';
import { TranscriptionProvider } from './index';

interface DeepgramWord {
	speaker?: number;
	word?: string;
	punctuated_word?: string;
}

interface DeepgramResponse {
	results?: {
		channels?: Array<{
			alternatives?: Array<{ transcript?: string; words?: DeepgramWord[] }>;
		}>;
	};
}

interface DeepgramModelsResponse {
	stt?: Array<{ canonical_name?: unknown; name?: unknown }>;
}

// Groups Deepgram's per-word speaker indices into `Speaker N:` segments,
// starting a new segment whenever the speaker index changes. Deepgram's indices
// are 0-based; bump to 1-based so labels never read "Speaker 0".
function formatDiarizedWords(words: DeepgramWord[]): string {
	const segments: string[] = [];
	let currentSpeaker: number | undefined;
	let buffer: string[] = [];
	const flush = (): void => {
		if (buffer.length === 0) return;
		const label = `Speaker ${(currentSpeaker ?? 0) + 1}`;
		segments.push(`${label}: ${buffer.join(' ')}`);
		buffer = [];
	};
	for (const w of words) {
		const text = w.punctuated_word ?? w.word;
		if (!text) continue;
		if (w.speaker !== currentSpeaker) {
			flush();
			currentSpeaker = w.speaker;
		}
		buffer.push(text);
	}
	flush();
	return segments.join('\n\n').trim();
}

export function createDeepgramTranscription(): TranscriptionProvider {
	return {
		id: 'deepgram',
		requiresAudio: true,
		async transcribe(
			audio: Blob,
			config: TranscriptionConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!config.apiKey) throw new Error('deepgram: API key is not configured');
			if (!config.model) throw new Error('deepgram: model is not configured');
			const params = new URLSearchParams({
				model: config.model,
				smart_format: 'true',
			});
			if (config.diarize) params.set('diarize', 'true');
			if (config.language) params.set('language', config.language);
			const url = `https://api.deepgram.com/v1/listen?${params.toString()}`;
			const data = await audio.arrayBuffer();
			const res = await providerRequest({
				provider: 'deepgram',
				url,
				method: 'POST',
				headers: {
					Authorization: `Token ${config.apiKey}`,
					'Content-Type': audio.type || 'audio/webm',
				},
				body: data,
				signal,
			});
			const json = res.json as DeepgramResponse;
			const alternative = json.results?.channels?.[0]?.alternatives?.[0];
			if (config.diarize && alternative?.words && alternative.words.length > 0) {
				const diarized = formatDiarizedWords(alternative.words);
				if (diarized) return diarized;
			}
			const transcript = alternative?.transcript;
			if (typeof transcript !== 'string') {
				throw new Error('deepgram: response missing transcript');
			}
			return transcript.trim();
		},
		async listModels(config, signal) {
			if (!config.apiKey) throw new Error('deepgram: API key is not configured');
			const response = await jsonGet<DeepgramModelsResponse>(
				'deepgram',
				'https://api.deepgram.com/v1/models',
				{ Authorization: `Token ${config.apiKey}` },
				signal,
			);
			const seen = new Set<string>();
			for (const row of response.stt ?? []) {
				const id = typeof row.canonical_name === 'string'
					? row.canonical_name
					: typeof row.name === 'string' ? row.name : '';
				if (id) seen.add(id);
			}
			return [...seen].sort();
		},
	};
}
