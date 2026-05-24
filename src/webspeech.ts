interface SpeechRecognitionAlternativeLike {
	transcript: string;
}

interface SpeechRecognitionResultLike {
	0: SpeechRecognitionAlternativeLike;
	length: number;
	isFinal: boolean;
}

interface SpeechRecognitionResultListLike {
	length: number;
	[index: number]: SpeechRecognitionResultLike;
}

interface SpeechRecognitionEventLike {
	results: SpeechRecognitionResultListLike;
	resultIndex: number;
}

interface SpeechRecognitionErrorEventLike {
	error?: string;
}

interface SpeechRecognitionLike {
	continuous: boolean;
	interimResults: boolean;
	lang: string;
	start(): void;
	stop(): void;
	abort(): void;
	addEventListener(type: 'result', listener: (e: SpeechRecognitionEventLike) => void): void;
	addEventListener(type: 'error', listener: (e: SpeechRecognitionErrorEventLike) => void): void;
	addEventListener(type: 'end', listener: () => void): void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getConstructor(): SpeechRecognitionCtor | null {
	const w = window as unknown as {
		SpeechRecognition?: SpeechRecognitionCtor;
		webkitSpeechRecognition?: SpeechRecognitionCtor;
	};
	return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface WebSpeechSession {
	stop(): Promise<string>;
	cancel(): void;
}

export interface StartWebSpeechOptions {
	language?: string;
	onUpdate?: (combinedTranscript: string) => void;
}

export function startWebSpeech(options: StartWebSpeechOptions = {}): WebSpeechSession {
	const Ctor = getConstructor();
	if (!Ctor) {
		throw new Error('Web Speech API is not available in this environment');
	}
	const recognition = new Ctor();
	recognition.continuous = true;
	recognition.interimResults = true;
	if (options.language) recognition.lang = options.language;

	let finalTranscript = '';
	let interimTranscript = '';
	let resolveStop: ((text: string) => void) | null = null;
	let rejectStop: ((err: Error) => void) | null = null;
	let terminated = false;

	recognition.addEventListener('result', (event: SpeechRecognitionEventLike) => {
		let interim = '';
		for (let i = event.resultIndex; i < event.results.length; i++) {
			const result = event.results[i];
			if (!result || result.length === 0) continue;
			const transcript = result[0].transcript;
			if (result.isFinal) {
				finalTranscript += transcript;
			} else {
				interim += transcript;
			}
		}
		interimTranscript = interim;
		options.onUpdate?.((finalTranscript + interim).trim());
	});

	recognition.addEventListener('error', (event: SpeechRecognitionErrorEventLike) => {
		if (terminated) return;
		terminated = true;
		const err = new Error(`Web Speech error: ${event.error ?? 'unknown'}`);
		if (rejectStop) {
			rejectStop(err);
			rejectStop = null;
			resolveStop = null;
		}
	});

	recognition.addEventListener('end', () => {
		const text = (finalTranscript + interimTranscript).trim();
		if (resolveStop) {
			resolveStop(text);
			resolveStop = null;
			rejectStop = null;
		}
	});

	recognition.start();

	return {
		stop(): Promise<string> {
			return new Promise<string>((resolve, reject) => {
				if (terminated) {
					resolve((finalTranscript + interimTranscript).trim());
					return;
				}
				resolveStop = resolve;
				rejectStop = reject;
				try {
					recognition.stop();
				} catch {
					terminated = true;
					resolveStop = null;
					rejectStop = null;
					resolve((finalTranscript + interimTranscript).trim());
				}
			});
		},
		cancel(): void {
			terminated = true;
			resolveStop = null;
			rejectStop = null;
			try {
				recognition.abort();
			} catch {
				// ignore
			}
		},
	};
}
