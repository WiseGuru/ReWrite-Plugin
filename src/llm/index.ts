import { LLMConfig, LLMProviderID } from '../types';
import { createAnthropicLLM } from './anthropic';
import { createOpenAILLM } from './openai';
import { createGeminiLLM } from './gemini';

export interface LLMProvider {
	readonly id: LLMProviderID;
	complete(
		systemPrompt: string,
		userMessage: string,
		config: LLMConfig,
		signal?: AbortSignal,
	): Promise<string>;
	listModels?(config: LLMConfig, signal?: AbortSignal): Promise<string[]>;
}

export function createLLMProvider(id: LLMProviderID): LLMProvider {
	switch (id) {
		case 'none':
			return {
				id: 'none',
				complete: async (_systemPrompt, userMessage) => userMessage,
			};
		case 'anthropic':
			return createAnthropicLLM();
		case 'openai':
		case 'openai-compatible':
		case 'mistral':
			return createOpenAILLM(id);
		case 'gemini':
			return createGeminiLLM();
	}
}
