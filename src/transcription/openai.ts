import { TranscriptionConfig, TranscriptionProviderID } from '../types';
import { MultipartPart, multipartPost } from '../http';
import { audioFilename, TranscriptionProvider } from './index';

export function createOpenAITranscription(
	id: TranscriptionProviderID,
): TranscriptionProvider {
	return {
		id,
		requiresAudio: true,
		async transcribe(
			audio: Blob,
			config: TranscriptionConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!config.apiKey) throw new Error(`${id}: API key is not configured`);
			if (!config.model) throw new Error(`${id}: model is not configured`);
			const url = resolveEndpoint(id, config);
			const data = await audio.arrayBuffer();
			const parts: MultipartPart[] = [
				{
					type: 'file',
					name: 'file',
					filename: audioFilename(audio),
					contentType: audio.type || 'application/octet-stream',
					data,
				},
				{ type: 'text', name: 'model', value: config.model },
				{ type: 'text', name: 'response_format', value: 'text' },
			];
			if (config.language) {
				parts.push({ type: 'text', name: 'language', value: config.language });
			}
			const res = await multipartPost(
				id,
				url,
				parts,
				{ Authorization: `Bearer ${config.apiKey}` },
				signal,
			);
			return res.text.trim();
		},
	};
}

function resolveEndpoint(id: TranscriptionProviderID, config: TranscriptionConfig): string {
	switch (id) {
		case 'openai':
			return 'https://api.openai.com/v1/audio/transcriptions';
		case 'groq':
			return 'https://api.groq.com/openai/v1/audio/transcriptions';
		case 'openai-compatible': {
			const base = config.baseUrl.trim().replace(/\/+$/, '');
			if (!base) {
				throw new Error('openai-compatible: base URL is not configured');
			}
			return `${base}/v1/audio/transcriptions`;
		}
		default:
			throw new Error(`Unsupported transcription provider id in OpenAI adapter: ${String(id)}`);
	}
}
