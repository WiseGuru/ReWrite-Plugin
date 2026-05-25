import { TranscriptionConfig } from '../types';
import { jsonGet, providerRequest } from '../http';
import { TranscriptionProvider } from './index';

interface DeepgramResponse {
	results?: {
		channels?: Array<{
			alternatives?: Array<{ transcript?: string }>;
		}>;
	};
}

interface DeepgramModelsResponse {
	stt?: Array<{ canonical_name?: unknown; name?: unknown }>;
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
			const transcript = json.results?.channels?.[0]?.alternatives?.[0]?.transcript;
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
