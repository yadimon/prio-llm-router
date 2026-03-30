import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(async (call: { model: unknown }) => {
    await Promise.resolve();

    return {
      text: 'ok',
      finishReason: 'stop',
      warnings: undefined,
      usage: undefined,
      raw: call.model,
    };
  }),
  streamText: vi.fn(),
  googleFactory: vi.fn((options: unknown) => (modelId: string) => ({
    kind: 'google',
    modelId,
    options,
  })),
  openAiCompatibleFactory: vi.fn((options: unknown) => ({
    chatModel: (modelId: string) => ({
      kind: 'openai-compatible',
      modelId,
      options,
    }),
  })),
  openRouterFactory: vi.fn((options: unknown) => (modelId: string) => ({
    kind: 'openrouter',
    modelId,
    options,
  })),
}));

vi.mock('ai', () => ({
  generateText: mocks.generateText,
  streamText: mocks.streamText,
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: mocks.googleFactory,
}));

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: mocks.openAiCompatibleFactory,
}));

vi.mock('@openrouter/ai-sdk-provider', () => ({
  createOpenRouter: mocks.openRouterFactory,
}));

import {
  RouterConfigurationError,
  createDefaultTextGenerationExecutor,
} from '../src/index.js';
import type { ExecuteTextTargetInput } from '../src/index.js';

describe('createDefaultTextGenerationExecutor', () => {
  beforeEach(() => {
    mocks.generateText.mockClear();
    mocks.streamText.mockClear();
    mocks.googleFactory.mockClear();
    mocks.openAiCompatibleFactory.mockClear();
    mocks.openRouterFactory.mockClear();
  });

  it('passes google provider options through to the AI SDK adapter', async () => {
    const executor = createDefaultTextGenerationExecutor();

    await executor.execute({
      provider: {
        name: 'google-main',
        type: 'google',
        auth: { mode: 'single', apiKey: '  google-key  ' },
        baseURL: 'https://google.example',
        headers: { 'x-test': '1' },
      },
      model: {
        name: 'gemini-fast',
        provider: 'google-main',
        model: 'gemini-2.5-flash-lite',
      },
      request: {
        prompt: 'Ping',
      },
    } satisfies ExecuteTextTargetInput);

    expect(mocks.googleFactory).toHaveBeenCalledWith({
      apiKey: 'google-key',
      baseURL: 'https://google.example',
      headers: { 'x-test': '1' },
    });
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Ping',
        maxRetries: 0,
        model: {
          kind: 'google',
          modelId: 'gemini-2.5-flash-lite',
          options: {
            apiKey: 'google-key',
            baseURL: 'https://google.example',
            headers: { 'x-test': '1' },
          },
        },
      }),
    );
  });

  it('passes openai-compatible provider labels and query params through', async () => {
    const executor = createDefaultTextGenerationExecutor();

    await executor.execute({
      provider: {
        name: 'local-proxy',
        type: 'openai-compatible',
        baseURL: 'http://127.0.0.1:1234/v1',
        providerLabel: 'lm-studio',
        queryParams: { project: 'demo' },
        headers: { 'x-proxy': '1' },
        auth: { mode: 'single', apiKey: 'dummy-key' },
      },
      model: {
        name: 'local-model',
        provider: 'local-proxy',
        model: 'qwen2.5-7b-instruct',
      },
      request: {
        prompt: 'Ping',
      },
    } satisfies ExecuteTextTargetInput);

    expect(mocks.openAiCompatibleFactory).toHaveBeenCalledWith({
      name: 'lm-studio',
      apiKey: 'dummy-key',
      baseURL: 'http://127.0.0.1:1234/v1',
      headers: { 'x-proxy': '1' },
      queryParams: { project: 'demo' },
    });
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {
          kind: 'openai-compatible',
          modelId: 'qwen2.5-7b-instruct',
          options: {
            name: 'lm-studio',
            apiKey: 'dummy-key',
            baseURL: 'http://127.0.0.1:1234/v1',
            headers: { 'x-proxy': '1' },
            queryParams: { project: 'demo' },
          },
        },
      }),
    );
  });

  it('allows openai-compatible providers with an empty API key', async () => {
    const executor = createDefaultTextGenerationExecutor();

    await executor.execute({
      provider: {
        name: 'local-proxy',
        type: 'openai-compatible',
        baseURL: 'http://127.0.0.1:1234/v1',
        providerLabel: 'lm-studio',
        auth: { mode: 'single', apiKey: '   ' },
      },
      model: {
        name: 'local-model',
        provider: 'local-proxy',
        model: 'qwen2.5-7b-instruct',
      },
      request: {
        prompt: 'Ping',
      },
    } satisfies ExecuteTextTargetInput);

    expect(mocks.openAiCompatibleFactory).toHaveBeenCalledWith({
      name: 'lm-studio',
      baseURL: 'http://127.0.0.1:1234/v1',
    });
  });

  it('merges OpenRouter app metadata into request headers', async () => {
    const executor = createDefaultTextGenerationExecutor();

    await executor.execute({
      provider: {
        name: 'openrouter-main',
        type: 'openrouter',
        auth: { mode: 'single', apiKey: 'openrouter-key' },
        headers: { 'x-extra': '1' },
        appName: 'prio-llm-router',
        appUrl: 'https://example.com/prio-llm-router',
      },
      model: {
        name: 'openrouter-free',
        provider: 'openrouter-main',
        model: 'moonshotai/kimi-k2:free',
      },
      request: {
        prompt: 'Ping',
      },
    } satisfies ExecuteTextTargetInput);

    expect(mocks.openRouterFactory).toHaveBeenCalledWith({
      apiKey: 'openrouter-key',
      headers: {
        'x-extra': '1',
        'HTTP-Referer': 'https://example.com/prio-llm-router',
        'X-Title': 'prio-llm-router',
      },
    });
  });

  it('rejects providers with empty API keys before calling any adapter', async () => {
    const executor = createDefaultTextGenerationExecutor();

    await expect(
      executor.execute({
        provider: {
          name: 'google-main',
          type: 'google',
          auth: { mode: 'single', apiKey: '   ' },
        },
        model: {
          name: 'gemini-fast',
          provider: 'google-main',
          model: 'gemini-2.5-flash-lite',
        },
        request: {
          prompt: 'Ping',
        },
      } satisfies ExecuteTextTargetInput),
    ).rejects.toThrow(RouterConfigurationError);

    expect(mocks.googleFactory).not.toHaveBeenCalled();
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it('still rejects OpenRouter providers with empty API keys', async () => {
    const executor = createDefaultTextGenerationExecutor();

    await expect(
      executor.execute({
        provider: {
          name: 'openrouter-main',
          type: 'openrouter',
          auth: { mode: 'single', apiKey: '   ' },
        },
        model: {
          name: 'openrouter-free',
          provider: 'openrouter-main',
          model: 'moonshotai/kimi-k2:free',
        },
        request: {
          prompt: 'Ping',
        },
      } satisfies ExecuteTextTargetInput),
    ).rejects.toThrow(RouterConfigurationError);

    expect(mocks.openRouterFactory).not.toHaveBeenCalled();
  });
});
