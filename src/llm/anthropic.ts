import { LLMConfig } from '../types';
import { jsonPost } from '../http';
import { LLMProvider } from './index';

interface MessagesResponse {
	content?: Array<{ type?: string; text?: string }>;
	stop_reason?: string;
}

export function createAnthropicLLM(): LLMProvider {
	return {
		id: 'anthropic',
		async complete(
			systemPrompt: string,
			userMessage: string,
			config: LLMConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!config.apiKey) throw new Error('anthropic: API key is not configured');
			if (!config.model) throw new Error('anthropic: model is not configured');
			const body = {
				model: config.model,
				max_tokens: config.maxTokens > 0 ? config.maxTokens : 2048,
				system: systemPrompt,
				messages: [{ role: 'user', content: userMessage }],
			};
			const response = await jsonPost<MessagesResponse>(
				'anthropic',
				'https://api.anthropic.com/v1/messages',
				body,
				{
					'x-api-key': config.apiKey,
					'anthropic-version': '2023-06-01',
					'anthropic-dangerous-direct-browser-access': 'true',
				},
				signal,
			);
			const firstText = response.content?.find((block) => block.type === 'text' && typeof block.text === 'string');
			if (!firstText || typeof firstText.text !== 'string') {
				throw new Error(`anthropic: response missing text content (stop_reason=${response.stop_reason ?? 'unknown'})`);
			}
			return firstText.text.trim();
		},
	};
}
