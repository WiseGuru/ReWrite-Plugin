import { TranscriptionConfig } from '../types';
import { MultipartPart, multipartPost, ProviderError } from '../http';
import { transcodeToWavPcm } from '../audio-transcode';
import { TranscriptionProvider } from './index';

// Mistral Voxtral diverges from the OpenAI Whisper shape on three points, so it
// gets its own adapter rather than dispatching through openai.ts:
//   1. Response is JSON only ({ text, segments, ... }); no response_format=text.
//   2. WebM/Opus is not an accepted input format, so the recorded blob is always
//      transcoded to 16 kHz mono WAV before upload (same path as whisper-local).
//      30 min of 16 kHz mono 16-bit PCM is ~57 MB, well under the 1 GB cap.
//   3. /v1/models does not document audio-model surfacing, so listModels is omitted.
const VOXTRAL_ENDPOINT = 'https://api.mistral.ai/v1/audio/transcriptions';

interface VoxtralResponse {
	text?: unknown;
}

export function createMistralVoxtralTranscription(): TranscriptionProvider {
	return {
		id: 'mistral-voxtral',
		requiresAudio: true,
		async transcribe(
			audio: Blob,
			config: TranscriptionConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!config.apiKey) throw new Error('mistral-voxtral: API key is not configured');
			if (!config.model) throw new Error('mistral-voxtral: model is not configured');
			let wavBuffer: ArrayBuffer;
			try {
				wavBuffer = await transcodeToWavPcm(audio);
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				throw new ProviderError('mistral-voxtral', 0, '', `Failed to transcode audio to WAV for Voxtral: ${msg}`);
			}
			const parts: MultipartPart[] = [
				{
					type: 'file',
					name: 'file',
					filename: 'audio.wav',
					contentType: 'audio/wav',
					data: wavBuffer,
				},
				{ type: 'text', name: 'model', value: config.model },
			];
			if (config.language) {
				parts.push({ type: 'text', name: 'language', value: config.language });
			}
			const res = await multipartPost(
				'mistral-voxtral',
				VOXTRAL_ENDPOINT,
				parts,
				{ Authorization: `Bearer ${config.apiKey}` },
				signal,
			);
			const body = res.json as VoxtralResponse;
			const text = typeof body.text === 'string' ? body.text : '';
			if (!text) {
				throw new ProviderError('mistral-voxtral', res.status, res.text, 'Voxtral returned no text.');
			}
			return text.trim();
		},
	};
}
