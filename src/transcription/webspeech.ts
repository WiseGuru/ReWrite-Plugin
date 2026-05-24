import { TranscriptionConfig } from '../types';
import { TranscriptionProvider } from './index';

// Web Speech does not produce an audio blob. The recorder (src/webspeech.ts) drives a
// SpeechRecognition session and emits a finalized transcript directly. The pipeline must
// short-circuit when source === 'webspeech' so this transcribe() is never called.
// It exists only so the factory has a complete switch case.
export function createWebSpeechTranscription(): TranscriptionProvider {
	return {
		id: 'webspeech',
		requiresAudio: false,
		async transcribe(_audio: Blob, _config: TranscriptionConfig): Promise<string> {
			throw new Error(
				'webspeech: transcribe() should not be called; the pipeline must use the live SpeechRecognition transcript',
			);
		},
	};
}
