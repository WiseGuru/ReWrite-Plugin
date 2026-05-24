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
}

export function createLLMProvider(id: LLMProviderID): LLMProvider {
	switch (id) {
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
