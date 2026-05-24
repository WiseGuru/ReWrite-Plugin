import { LLMConfig } from '../types';
import { jsonPost } from '../http';
import { LLMProvider } from './index';

interface GenerateContentResponse {
	candidates?: Array<{
		content?: { parts?: Array<{ text?: string }> };
		finishReason?: string;
	}>;
	promptFeedback?: { blockReason?: string };
}

export function createGeminiLLM(): LLMProvider {
	return {
		id: 'gemini',
		async complete(
			systemPrompt: string,
			userMessage: string,
			config: LLMConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!config.apiKey) throw new Error('gemini: API key is not configured');
			if (!config.model) throw new Error('gemini: model is not configured');
			const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`;
			const body: Record<string, unknown> = {
				system_instruction: { parts: [{ text: systemPrompt }] },
				contents: [{ parts: [{ text: userMessage }] }],
			};
			if (config.maxTokens > 0) {
				body.generationConfig = { maxOutputTokens: config.maxTokens };
			}
			const response = await jsonPost<GenerateContentResponse>(
				'gemini',
				url,
				body,
				{},
				signal,
			);
			if (response.promptFeedback?.blockReason) {
				throw new Error(`gemini: blocked by safety filter (${response.promptFeedback.blockReason})`);
			}
			const candidate = response.candidates?.[0];
			if (candidate?.finishReason === 'SAFETY') {
				throw new Error('gemini: response blocked by safety filter');
			}
			const text = candidate?.content?.parts?.[0]?.text;
			if (typeof text !== 'string') {
				throw new Error(`gemini: response missing text (finishReason=${candidate?.finishReason ?? 'unknown'})`);
			}
			return text.trim();
		},
	};
}
