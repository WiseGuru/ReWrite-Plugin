import { RecordingFormatPreference } from './types';

export type RecorderState = 'idle' | 'recording' | 'paused' | 'stopped';

export interface RecorderResult {
	blob: Blob;
	mimeType: string;
	durationMs: number;
}

const WEBM_FIRST: string[] = [
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/ogg;codecs=opus',
	'audio/mp4',
];

const MP4_FIRST: string[] = [
	'audio/mp4',
	'audio/webm;codecs=opus',
	'audio/webm',
	'audio/ogg;codecs=opus',
];

export function getBestMimeType(preference: RecordingFormatPreference): string {
	if (typeof MediaRecorder === 'undefined') return '';
	const candidates = preference === 'mp4' ? MP4_FIRST : WEBM_FIRST;
	for (const candidate of candidates) {
		if (MediaRecorder.isTypeSupported(candidate)) return candidate;
	}
	return '';
}

export class Recorder {
	private mediaRecorder: MediaRecorder | null = null;
	private stream: MediaStream | null = null;
	private chunks: Blob[] = [];
	private state: RecorderState = 'idle';
	private startedAt = 0;
	private accumulatedMs = 0;
	private mimeType = '';

	getState(): RecorderState {
		return this.state;
	}

	getElapsedMs(): number {
		if (this.state === 'recording') {
			return this.accumulatedMs + (Date.now() - this.startedAt);
		}
		return this.accumulatedMs;
	}

	async start(preference: RecordingFormatPreference): Promise<void> {
		if (this.state !== 'idle') {
			throw new Error(`Recorder.start: invalid transition from ${this.state}`);
		}
		let stream: MediaStream;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
		} catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			throw new Error(`Microphone access denied: ${msg}`);
		}
		const mimeType = getBestMimeType(preference);
		let recorder: MediaRecorder;
		try {
			recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
		} catch (e) {
			for (const track of stream.getTracks()) track.stop();
			const msg = e instanceof Error ? e.message : String(e);
			throw new Error(`Failed to start MediaRecorder: ${msg}`);
		}
		this.stream = stream;
		this.mediaRecorder = recorder;
		this.mimeType = mimeType;
		this.chunks = [];
		recorder.addEventListener('dataavailable', (ev) => {
			if (ev.data && ev.data.size > 0) this.chunks.push(ev.data);
		});
		this.startedAt = Date.now();
		this.accumulatedMs = 0;
		this.state = 'recording';
		recorder.start();
	}

	pause(): void {
		if (this.state !== 'recording') {
			throw new Error(`Recorder.pause: invalid transition from ${this.state}`);
		}
		if (!this.mediaRecorder) throw new Error('Recorder.pause: missing MediaRecorder');
		this.accumulatedMs += Date.now() - this.startedAt;
		this.mediaRecorder.pause();
		this.state = 'paused';
	}

	resume(): void {
		if (this.state !== 'paused') {
			throw new Error(`Recorder.resume: invalid transition from ${this.state}`);
		}
		if (!this.mediaRecorder) throw new Error('Recorder.resume: missing MediaRecorder');
		this.mediaRecorder.resume();
		this.startedAt = Date.now();
		this.state = 'recording';
	}

	async stop(): Promise<RecorderResult> {
		if (this.state !== 'recording' && this.state !== 'paused') {
			throw new Error(`Recorder.stop: invalid transition from ${this.state}`);
		}
		const recorder = this.mediaRecorder;
		if (!recorder) throw new Error('Recorder.stop: missing MediaRecorder');
		if (this.state === 'recording') {
			this.accumulatedMs += Date.now() - this.startedAt;
		}
		const finished = new Promise<void>((resolve) => {
			recorder.addEventListener('stop', () => resolve(), { once: true });
		});
		recorder.stop();
		await finished;
		this.state = 'stopped';
		this.releaseStream();
		const firstChunk = this.chunks[0];
		const type = this.mimeType || (firstChunk ? firstChunk.type : '') || 'audio/webm';
		const blob = new Blob(this.chunks, { type });
		return { blob, mimeType: type, durationMs: this.accumulatedMs };
	}

	cancel(): void {
		if (this.mediaRecorder && (this.state === 'recording' || this.state === 'paused')) {
			try {
				this.mediaRecorder.stop();
			} catch {
				// ignore
			}
		}
		this.releaseStream();
		this.chunks = [];
		this.state = 'idle';
		this.accumulatedMs = 0;
		this.startedAt = 0;
		this.mediaRecorder = null;
	}

	private releaseStream(): void {
		if (this.stream) {
			for (const track of this.stream.getTracks()) track.stop();
			this.stream = null;
		}
	}
}
