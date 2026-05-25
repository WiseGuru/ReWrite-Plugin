import { TranscriptionConfig } from '../types';
import { MultipartPart, multipartPost, ProviderError } from '../http';
import { audioFilename, TranscriptionProvider } from './index';
import type { WhisperHost } from '../whisper-host';

let host: WhisperHost | null = null;

export function bindWhisperHost(h: WhisperHost): void {
	host = h;
}

export function createWhisperLocalTranscription(): TranscriptionProvider {
	return {
		id: 'whisper-local',
		requiresAudio: true,
		async transcribe(
			audio: Blob,
			config: TranscriptionConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!host) {
				throw new ProviderError('whisper-local', 0, '', 'Local whisper.cpp server is not initialized (desktop only).');
			}
			if (host.status() !== 'running') {
				throw new ProviderError('whisper-local', 0, '', 'Local whisper.cpp server is not running. Start it from settings.');
			}
			const baseUrl = host.baseUrl();
			if (!baseUrl) {
				throw new ProviderError('whisper-local', 0, '', 'Local whisper.cpp server has no base URL.');
			}
			const data = await audio.arrayBuffer();
			const parts: MultipartPart[] = [
				{
					type: 'file',
					name: 'file',
					filename: audioFilename(audio),
					contentType: audio.type || 'application/octet-stream',
					data,
				},
				{ type: 'text', name: 'model', value: config.model || 'whisper-1' },
				{ type: 'text', name: 'response_format', value: 'text' },
			];
			if (config.language) {
				parts.push({ type: 'text', name: 'language', value: config.language });
			}
			const res = await multipartPost(
				'whisper-local',
				`${baseUrl}/v1/audio/transcriptions`,
				parts,
				{},
				signal,
			);
			return res.text.trim();
		},
	};
}
