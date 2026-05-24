import { TranscriptionConfig } from '../types';
import { jsonGet, MultipartPart, multipartPost, providerRequest, sleep } from '../http';
import { audioFilename, TranscriptionProvider } from './index';

const POLL_TIMEOUT_MS = 60_000;
const INITIAL_DELAY_MS = 1000;
const MAX_DELAY_MS = 8000;

interface JobCreateResponse {
	id?: string;
}

interface JobStatusResponse {
	status?: 'in_progress' | 'transcribed' | 'failed';
	failure_detail?: string;
	failure?: string;
}

export function createRevAITranscription(): TranscriptionProvider {
	return {
		id: 'revai',
		requiresAudio: true,
		async transcribe(
			audio: Blob,
			config: TranscriptionConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!config.apiKey) throw new Error('revai: API key is not configured');
			const authHeaders = { Authorization: `Bearer ${config.apiKey}` };

			const data = await audio.arrayBuffer();
			const parts: MultipartPart[] = [
				{
					type: 'file',
					name: 'media',
					filename: audioFilename(audio),
					contentType: audio.type || 'application/octet-stream',
					data,
				},
			];
			const options: Record<string, unknown> = {};
			if (config.language) options.language = config.language;
			if (config.model) options.transcriber = config.model;
			if (Object.keys(options).length > 0) {
				parts.push({ type: 'text', name: 'options', value: JSON.stringify(options) });
			}
			const submit = await multipartPost(
				'revai',
				'https://api.rev.ai/speechtotext/v1/jobs',
				parts,
				authHeaders,
				signal,
			);
			const created = submit.json as JobCreateResponse;
			if (!created.id) {
				throw new Error('revai: submit response missing id');
			}

			await pollRevAI(created.id, authHeaders, signal);

			const transcript = await providerRequest({
				provider: 'revai',
				url: `https://api.rev.ai/speechtotext/v1/jobs/${created.id}/transcript`,
				method: 'GET',
				headers: { ...authHeaders, Accept: 'text/plain' },
				signal,
			});
			return transcript.text.trim();
		},
	};
}

async function pollRevAI(
	id: string,
	headers: Record<string, string>,
	signal: AbortSignal | undefined,
): Promise<void> {
	const start = Date.now();
	let delay = INITIAL_DELAY_MS;
	for (;;) {
		const elapsed = Date.now() - start;
		if (elapsed > POLL_TIMEOUT_MS) {
			throw new Error(`revai: poll timeout after ${POLL_TIMEOUT_MS / 1000}s`);
		}
		const status = await jsonGet<JobStatusResponse>(
			'revai',
			`https://api.rev.ai/speechtotext/v1/jobs/${id}`,
			headers,
			signal,
		);
		if (status.status === 'transcribed') return;
		if (status.status === 'failed') {
			throw new Error(`revai: ${status.failure_detail ?? status.failure ?? 'transcription failed'}`);
		}
		await sleep(delay, signal);
		delay = Math.min(delay * 2, MAX_DELAY_MS);
	}
}
