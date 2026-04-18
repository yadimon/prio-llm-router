import { createAnthropic } from '@ai-sdk/anthropic';
import { createCohere } from '@ai-sdk/cohere';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createGroq } from '@ai-sdk/groq';
import { createMistral } from '@ai-sdk/mistral';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createPerplexity } from '@ai-sdk/perplexity';
import { createTogetherAI } from '@ai-sdk/togetherai';
import { createXai } from '@ai-sdk/xai';
import {
  createGateway,
  generateText,
  streamText,
  type LanguageModel,
} from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';

import { RouterConfigurationError } from './errors.js';
import type {
  ExecuteStreamTextTargetResult,
  ExecuteTextTargetInput,
  ExecuteTextTargetResult,
  OpenRouterProviderConfig,
  ProviderConfig,
  TextGenerationExecutor,
  TokenUsage,
} from './types.js';

type AiSdkGenerateTextOptions = Parameters<typeof generateText>[0];
type AiSdkStreamTextOptions = Parameters<typeof streamText>[0];
type ProviderHandle =
  | ((modelId: string) => LanguageModel)
  | {
      languageModel?: (modelId: string) => LanguageModel;
      chat?: (modelId: string) => LanguageModel;
      chatModel?: (modelId: string) => LanguageModel;
    };

export function createDefaultTextGenerationExecutor(options?: {
  defaultProviderMaxRetries?: number;
}): TextGenerationExecutor {
  return new AiSdkTextGenerationExecutor(options?.defaultProviderMaxRetries ?? 0);
}

class AiSdkTextGenerationExecutor implements TextGenerationExecutor {
  private readonly providerCache = new Map<string, ProviderHandle>();

  constructor(private readonly defaultProviderMaxRetries: number) {}

  async execute({
    provider,
    model,
    request,
  }: ExecuteTextTargetInput): Promise<ExecuteTextTargetResult> {
    const languageModel = this.getLanguageModel(provider, model.model);
    const call = buildBaseTextCallOptions({
      languageModel,
      request,
      defaultProviderMaxRetries: this.defaultProviderMaxRetries,
    }) as AiSdkGenerateTextOptions;

    const result = await generateText(call);

    const output: ExecuteTextTargetResult = {
      text: result.text,
      finishReason: result.finishReason ?? null,
      raw: result,
    };

    const usage = normalizeUsage(result.usage);
    if (usage) {
      output.usage = usage;
    }

    const warnings = normalizeWarnings(result.warnings);
    if (warnings) {
      output.warnings = warnings;
    }

    return output;
  }

  async stream({
    provider,
    model,
    request,
  }: ExecuteTextTargetInput): Promise<ExecuteStreamTextTargetResult> {
    await Promise.resolve();

    const languageModel = this.getLanguageModel(provider, model.model);

    const call = buildBaseTextCallOptions({
      languageModel,
      request,
      defaultProviderMaxRetries: this.defaultProviderMaxRetries,
    }) as AiSdkStreamTextOptions;

    const result = streamText(call);

    return {
      textStream: result.textStream,
      consumeStream: async () => {
        await result.consumeStream();
      },
      finishReason: Promise.resolve(result.finishReason).then(
        (value) => value ?? null,
      ),
      usage: Promise.resolve(result.totalUsage).then((value) =>
        normalizeUsage(value),
      ),
      warnings: Promise.resolve(result.warnings).then((value) =>
        normalizeWarnings(value),
      ),
      raw: result,
    };
  }

  private getLanguageModel(
    provider: ProviderConfig,
    modelId: string,
  ): LanguageModel {
    const handle =
      this.providerCache.get(provider.name) ?? createProviderHandle(provider);

    if (!this.providerCache.has(provider.name)) {
      this.providerCache.set(provider.name, handle);
    }

    return resolveLanguageModel(handle, modelId, provider.name);
  }
}

function buildBaseTextCallOptions({
  languageModel,
  request,
  defaultProviderMaxRetries,
}: {
  languageModel: LanguageModel;
  request: ExecuteTextTargetInput['request'];
  defaultProviderMaxRetries: number;
}): Record<string, unknown> {
  const call: AiSdkGenerateTextOptions = {
    model: languageModel,
    system: request.system,
    temperature: request.temperature,
    topP: request.topP,
    maxRetries: request.providerMaxRetries ?? defaultProviderMaxRetries,
    abortSignal: request.abortSignal,
  } as AiSdkGenerateTextOptions;

  if (request.maxOutputTokens !== undefined) {
    (
      call as AiSdkGenerateTextOptions & {
        maxOutputTokens?: number;
      }
    ).maxOutputTokens = request.maxOutputTokens;
  }

  if (request.stopSequences !== undefined) {
    (
      call as AiSdkGenerateTextOptions & {
        stopSequences?: string[];
      }
    ).stopSequences = request.stopSequences;
  }

  if ('prompt' in request) {
    (
      call as AiSdkGenerateTextOptions & {
        prompt?: string;
      }
    ).prompt = request.prompt;
  } else {
    (
      call as AiSdkGenerateTextOptions & {
        messages?: ExecuteTextTargetInput['request']['messages'];
      }
    ).messages = request.messages;
  }

  return call as Record<string, unknown>;
}

function createProviderHandle(provider: ProviderConfig): ProviderHandle {
  const apiKey = provider.auth.apiKey.trim();

  if (!apiKey && provider.type !== 'openai-compatible') {
    throw new RouterConfigurationError(
      `Provider "${provider.name}" is missing an API key.`,
    );
  }

  switch (provider.type) {
    case 'anthropic': {
      const options: Parameters<typeof createAnthropic>[0] = { apiKey };
      if (provider.baseURL) {
        options.baseURL = provider.baseURL;
      }
      if (provider.headers) {
        options.headers = provider.headers;
      }
      return createAnthropic(options);
    }

    case 'cohere': {
      const options: Parameters<typeof createCohere>[0] = { apiKey };
      if (provider.baseURL) {
        options.baseURL = provider.baseURL;
      }
      if (provider.headers) {
        options.headers = provider.headers;
      }
      return createCohere(options);
    }

    case 'deepseek': {
      const options: Parameters<typeof createDeepSeek>[0] = { apiKey };
      if (provider.baseURL) {
        options.baseURL = provider.baseURL;
      }
      if (provider.headers) {
        options.headers = provider.headers;
      }
      return createDeepSeek(options);
    }

    case 'google': {
      const options: Parameters<typeof createGoogleGenerativeAI>[0] = {
        apiKey,
      };
      if (provider.baseURL) {
        options.baseURL = provider.baseURL;
      }
      if (provider.headers) {
        options.headers = provider.headers;
      }
      return createGoogleGenerativeAI(options);
    }

    case 'groq': {
      const options: Parameters<typeof createGroq>[0] = { apiKey };
      if (provider.baseURL) {
        options.baseURL = provider.baseURL;
      }
      if (provider.headers) {
        options.headers = provider.headers;
      }
      return createGroq(options);
    }

    case 'mistral': {
      const options: Parameters<typeof createMistral>[0] = { apiKey };
      if (provider.baseURL) {
        options.baseURL = provider.baseURL;
      }
      if (provider.headers) {
        options.headers = provider.headers;
      }
      return createMistral(options);
    }

    case 'openai': {
      const options: Parameters<typeof createOpenAI>[0] = { apiKey };
      if (provider.baseURL) {
        options.baseURL = provider.baseURL;
      }
      if (provider.headers) {
        options.headers = provider.headers;
      }
      return createOpenAI(options);
    }

    case 'openai-compatible': {
      const options: Parameters<typeof createOpenAICompatible>[0] = {
        name: provider.providerLabel ?? provider.name,
        baseURL: provider.baseURL,
      };
      if (apiKey) {
        options.apiKey = apiKey;
      }
      if (provider.headers) {
        options.headers = provider.headers;
      }
      if (provider.queryParams) {
        options.queryParams = provider.queryParams;
      }
      return createOpenAICompatible(options);
    }

    case 'openrouter': {
      const options: NonNullable<Parameters<typeof createOpenRouter>[0]> = {
        apiKey,
      };
      const headers = buildOpenRouterHeaders(provider);
      if (headers) {
        options.headers = headers;
      }
      if (provider.baseURL) {
        options.baseURL = provider.baseURL;
      }
      return createOpenRouter(options);
    }

    case 'perplexity': {
      const options: Parameters<typeof createPerplexity>[0] = { apiKey };
      if (provider.baseURL) {
        options.baseURL = provider.baseURL;
      }
      if (provider.headers) {
        options.headers = provider.headers;
      }
      return createPerplexity(options);
    }

    case 'togetherai': {
      const options: Parameters<typeof createTogetherAI>[0] = { apiKey };
      if (provider.baseURL) {
        options.baseURL = provider.baseURL;
      }
      if (provider.headers) {
        options.headers = provider.headers;
      }
      return createTogetherAI(options);
    }

    case 'vercel': {
      const options: Parameters<typeof createGateway>[0] = { apiKey };
      if (provider.baseURL) {
        options.baseURL = provider.baseURL;
      }
      if (provider.headers) {
        options.headers = provider.headers;
      }
      return createGateway(options);
    }

    case 'xai': {
      const options: Parameters<typeof createXai>[0] = { apiKey };
      if (provider.baseURL) {
        options.baseURL = provider.baseURL;
      }
      if (provider.headers) {
        options.headers = provider.headers;
      }
      return createXai(options);
    }

    default: {
      const exhaustiveCheck: never = provider;
      throw new RouterConfigurationError(
        `Unsupported provider type: ${JSON.stringify(exhaustiveCheck)}`,
      );
    }
  }
}

function buildOpenRouterHeaders(
  provider: OpenRouterProviderConfig,
): Record<string, string> | undefined {
  const headers = { ...provider.headers };

  if (provider.appUrl) {
    headers['HTTP-Referer'] = provider.appUrl;
  }

  if (provider.appName) {
    headers['X-Title'] = provider.appName;
  }

  return Object.keys(headers).length > 0 ? headers : undefined;
}

function resolveLanguageModel(
  providerHandle: ProviderHandle,
  modelId: string,
  providerName: string,
): LanguageModel {
  if (typeof providerHandle === 'function') {
    return providerHandle(modelId);
  }

  const dynamicHandle = providerHandle as Record<string, unknown>;
  const candidates = ['languageModel', 'chatModel', 'chat'];

  for (const candidate of candidates) {
    const factory = dynamicHandle[candidate];
    if (typeof factory === 'function') {
      return (factory as (id: string) => LanguageModel)(modelId);
    }
  }

  throw new RouterConfigurationError(
    `Provider "${providerName}" does not expose a supported language model factory.`,
  );
}

function normalizeUsage(usage: unknown): TokenUsage | undefined {
  if (!usage || typeof usage !== 'object') {
    return undefined;
  }

  const numericUsage = usage as Record<string, unknown>;
  const normalized: TokenUsage = {};

  const keys: Array<keyof TokenUsage> = [
    'inputTokens',
    'outputTokens',
    'totalTokens',
    'reasoningTokens',
    'cachedInputTokens',
  ];

  for (const key of keys) {
    const value = numericUsage[key];
    if (typeof value === 'number') {
      normalized[key] = value;
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeWarnings(warnings: unknown): unknown[] | undefined {
  return Array.isArray(warnings) ? warnings : undefined;
}
