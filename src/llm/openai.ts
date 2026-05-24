import { LLMConfig, LLMProviderID } from '../types';
import { jsonPost } from '../http';
import { LLMProvider } from './index';

interface ChatCompletionResponse {
	choices?: Array<{
		message?: { content?: string };
	}>;
}

export function createOpenAILLM(id: LLMProviderID): LLMProvider {
	return {
		id,
		async complete(
			systemPrompt: string,
			userMessage: string,
			config: LLMConfig,
			signal?: AbortSignal,
		): Promise<string> {
			if (!config.apiKey) throw new Error(`${id}: API key is not configured`);
			if (!config.model) throw new Error(`${id}: model is not configured`);
			const url = resolveEndpoint(id, config);
			const body: Record<string, unknown> = {
				model: config.model,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userMessage },
				],
			};
			if (config.maxTokens > 0) body.max_tokens = config.maxTokens;
			const response = await jsonPost<ChatCompletionResponse>(
				id,
				url,
				body,
				{ Authorization: `Bearer ${config.apiKey}` },
				signal,
			);
			const content = response.choices?.[0]?.message?.content;
			if (typeof content !== 'string') {
				throw new Error(`${id}: response missing message content`);
			}
			return content.trim();
		},
	};
}

function resolveEndpoint(id: LLMProviderID, config: LLMConfig): string {
	switch (id) {
		case 'openai':
			return 'https://api.openai.com/v1/chat/completions';
		case 'mistral':
			return 'https://api.mistral.ai/v1/chat/completions';
		case 'openai-compatible': {
			const base = config.baseUrl.trim().replace(/\/+$/, '');
			if (!base) {
				throw new Error('openai-compatible: base URL is not configured');
			}
			return `${base}/chat/completions`;
		}
		default:
			throw new Error(`Unsupported LLM provider id in OpenAI adapter: ${String(id)}`);
	}
}
