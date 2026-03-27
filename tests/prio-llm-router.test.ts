import { describe, expect, it, vi } from 'vitest';

import {
  AllModelsFailedError,
  RouterConfigurationError,
  createLlmConnection,
  createLlmRouter,
  createLlmSource,
} from '../src/index.js';
import type {
  ExecuteStreamTextTargetResult,
  ExecuteTextTargetInput,
  ExecuteTextTargetResult,
  TextGenerationExecutor,
} from '../src/index.js';

function createExecutor(
  executeHandler: (
    input: ExecuteTextTargetInput,
  ) => Promise<ExecuteTextTargetResult>,
  streamHandler?: (
    input: ExecuteTextTargetInput,
  ) => Promise<ExecuteStreamTextTargetResult>,
): TextGenerationExecutor {
  return {
    execute: executeHandler,
    stream:
      streamHandler ??
      (async ({ model }) => {
        await Promise.resolve();
        return {
          textStream: singleUseStream([`stream:${model.name}`]),
          finishReason: Promise.resolve('stop'),
          usage: Promise.resolve(undefined),
          warnings: Promise.resolve(undefined),
          raw: { model: model.name },
        };
      }),
  };
}

function singleUseStream(
  chunks: string[],
  options?: {
    delayMs?: number;
    errorAfterChunks?: Error;
  },
): AsyncIterable<string> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        if (options?.delayMs) {
          await sleep(options.delayMs);
        }

        yield chunk;
      }

      if (options?.errorAfterChunks) {
        throw options.errorAfterChunks;
      }
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

describe('PrioLlmRouter', () => {
  it('falls back to the next target when a higher-priority target fails', async () => {
    const execute = vi.fn<
      (input: ExecuteTextTargetInput) => Promise<ExecuteTextTargetResult>
    >(async ({ model }) => {
      await Promise.resolve();

      if (model.name === 'openrouter-free') {
        throw new Error('rate limited');
      }

      return {
        text: 'Hello from Groq',
        finishReason: 'stop',
        raw: { provider: model.provider, model: model.model },
      };
    });

    const router = createLlmRouter({
      providers: [
        {
          name: 'openrouter-main',
          type: 'openrouter',
          auth: { mode: 'single', apiKey: 'openrouter-key' },
        },
        {
          name: 'groq-main',
          type: 'groq',
          auth: { mode: 'single', apiKey: 'groq-key' },
        },
      ],
      models: [
        {
          name: 'openrouter-free',
          provider: 'openrouter-main',
          model: 'arcee-ai/trinity-large:free',
          priority: 10,
          tier: 'free',
        },
        {
          name: 'groq-free',
          provider: 'groq-main',
          model: 'openai/gpt-oss-20b',
          priority: 20,
          tier: 'free',
        },
      ],
      executor: createExecutor(execute),
    });

    const result = await router.generateText({
      prompt: 'Ping',
    });

    expect(result.text).toBe('Hello from Groq');
    expect(result.target.name).toBe('groq-free');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.success).toBe(false);
    expect(result.attempts[1]?.success).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('uses the explicit chain order when provided', async () => {
    const seenTargets: string[] = [];

    const router = createLlmRouter({
      providers: [
        {
          name: 'openrouter-main',
          type: 'openrouter',
          auth: { mode: 'single', apiKey: 'openrouter-key' },
        },
        {
          name: 'groq-main',
          type: 'groq',
          auth: { mode: 'single', apiKey: 'groq-key' },
        },
      ],
      models: [
        {
          name: 'low-priority',
          provider: 'groq-main',
          model: 'openai/gpt-oss-20b',
          priority: 20,
        },
        {
          name: 'high-priority',
          provider: 'openrouter-main',
          model: 'arcee-ai/trinity-large:free',
          priority: 10,
        },
      ],
      executor: createExecutor(async ({ model }) => {
        await Promise.resolve();
        seenTargets.push(model.name);
        return {
          text: `served by ${model.name}`,
          finishReason: 'stop',
          raw: { target: model.name },
        };
      }),
    });

    const result = await router.generateText({
      prompt: 'Ping',
      chain: ['low-priority', 'high-priority'],
    });

    expect(result.target.name).toBe('low-priority');
    expect(seenTargets).toEqual(['low-priority']);
  });

  it('throws a rich error when all attempts fail', async () => {
    const router = createLlmRouter({
      providers: [
        {
          name: 'openrouter-main',
          type: 'openrouter',
          auth: { mode: 'single', apiKey: 'openrouter-key' },
        },
      ],
      models: [
        {
          name: 'only-target',
          provider: 'openrouter-main',
          model: 'arcee-ai/trinity-large:free',
        },
      ],
      executor: createExecutor(async () => {
        await Promise.resolve();
        throw new Error('provider unavailable');
      }),
    });

    await expect(
      router.generateText({
        prompt: 'Ping',
      }),
    ).rejects.toBeInstanceOf(AllModelsFailedError);

    try {
      await router.generateText({ prompt: 'Ping' });
    } catch (error) {
      expect(error).toBeInstanceOf(AllModelsFailedError);
      expect((error as AllModelsFailedError).attempts).toHaveLength(1);
    }
  });

  it('rejects model configurations that reference unknown providers', () => {
    expect(() =>
      createLlmRouter({
        providers: [
          {
            name: 'openrouter-main',
            type: 'openrouter',
            auth: { mode: 'single', apiKey: 'openrouter-key' },
          },
        ],
        models: [
          {
            name: 'broken',
            provider: 'missing-provider',
            model: 'arcee-ai/trinity-large:free',
          },
        ],
      }),
    ).toThrow(RouterConfigurationError);
  });

  it('supports additional AI SDK provider presets in router configuration', async () => {
    const router = createLlmRouter({
      providers: [
        {
          name: 'gemini-main',
          type: 'google',
          auth: { mode: 'single', apiKey: 'google-key' },
        },
        {
          name: 'mistral-main',
          type: 'mistral',
          auth: { mode: 'single', apiKey: 'mistral-key' },
        },
      ],
      models: [
        {
          name: 'gemini-free',
          provider: 'gemini-main',
          model: 'gemini-2.5-flash-lite',
          priority: 10,
        },
        {
          name: 'mistral-backup',
          provider: 'mistral-main',
          model: 'mistral-small-latest',
          priority: 20,
        },
      ],
      executor: createExecutor(async ({ model }) => {
        await Promise.resolve();
        return {
          text: `served by ${model.name}`,
          finishReason: 'stop',
          raw: { target: model.name },
        };
      }),
    });

    const result = await router.generateText({
      prompt: 'Ping',
    });

    expect(result.target.providerType).toBe('google');
    expect(result.text).toBe('served by gemini-free');
  });

  it('compiles source builders into router targets', async () => {
    const openRouterConnection = createLlmConnection({
      name: 'openrouter-main',
      type: 'openrouter',
      auth: { mode: 'single', apiKey: 'openrouter-key' },
    });

    const groqConnection = createLlmConnection({
      name: 'groq-main',
      type: 'groq',
      auth: { mode: 'single', apiKey: 'groq-key' },
    });

    const router = createLlmRouter({
      sources: [
        createLlmSource(openRouterConnection, {
          name: 'openrouter-free',
          model: 'moonshotai/kimi-k2:free',
          access: 'free',
          priority: 10,
        }),
        createLlmSource(groqConnection, {
          name: 'groq-standard',
          model: 'openai/gpt-oss-20b',
          priority: 20,
        }),
      ],
      executor: createExecutor(async ({ model }) => {
        await Promise.resolve();
        return {
          text: `served by ${model.name}`,
          finishReason: 'stop',
          raw: { target: model.name },
        };
      }),
    });

    const result = await router.generateText({ prompt: 'Ping' });

    expect(result.target.name).toBe('openrouter-free');
    expect(result.target.tier).toBe('free');
    expect(router.listProviders()).toHaveLength(2);
    expect(router.listModels()).toHaveLength(2);
  });

  it('rejects free sources for providers without guaranteed free enforcement', () => {
    const geminiConnection = createLlmConnection({
      name: 'gemini-main',
      type: 'google',
      auth: { mode: 'single', apiKey: 'google-key' },
    });

    expect(() =>
      createLlmRouter({
        sources: [
          createLlmSource(geminiConnection, {
            name: 'gemini-free',
            model: 'gemini-2.5-flash-lite',
            access: 'free',
          } as never),
        ],
      }),
    ).toThrow(RouterConfigurationError);
  });

  it('rejects openrouter free sources without explicit free variants', () => {
    const openRouterConnection = createLlmConnection({
      name: 'openrouter-main',
      type: 'openrouter',
      auth: { mode: 'single', apiKey: 'openrouter-key' },
    });

    expect(() =>
      createLlmRouter({
        sources: [
          createLlmSource(openRouterConnection, {
            name: 'bad-openrouter-free',
            model: 'openrouter/free',
            access: 'free',
          } as never),
        ],
      }),
    ).toThrow(RouterConfigurationError);

    expect(() =>
      createLlmRouter({
        sources: [
          createLlmSource(openRouterConnection, {
            name: 'paid-looking-openrouter',
            model: 'openai/gpt-4.1-mini',
            access: 'free',
          } as never),
        ],
      }),
    ).toThrow(RouterConfigurationError);
  });

  it('skips disabled targets from the implicit priority chain', async () => {
    const seenTargets: string[] = [];

    const router = createLlmRouter({
      providers: [
        {
          name: 'openrouter-main',
          type: 'openrouter',
          auth: { mode: 'single', apiKey: 'openrouter-key' },
          enabled: false,
        },
        {
          name: 'groq-main',
          type: 'groq',
          auth: { mode: 'single', apiKey: 'groq-key' },
        },
      ],
      models: [
        {
          name: 'disabled-target',
          provider: 'openrouter-main',
          model: 'arcee-ai/trinity-large:free',
          priority: 10,
        },
        {
          name: 'enabled-target',
          provider: 'groq-main',
          model: 'openai/gpt-oss-20b',
          priority: 20,
        },
      ],
      executor: createExecutor(async ({ model }) => {
        await Promise.resolve();
        seenTargets.push(model.name);
        return {
          text: 'ok',
          finishReason: 'stop',
          raw: {},
        };
      }),
    });

    const result = await router.generateText({
      prompt: 'Ping',
    });

    expect(result.target.name).toBe('enabled-target');
    expect(seenTargets).toEqual(['enabled-target']);
  });

  it('falls back to the next stream target when the first chunk takes too long', async () => {
    const router = createLlmRouter({
      providers: [
        {
          name: 'openrouter-main',
          type: 'openrouter',
          auth: { mode: 'single', apiKey: 'openrouter-key' },
        },
        {
          name: 'groq-main',
          type: 'groq',
          auth: { mode: 'single', apiKey: 'groq-key' },
        },
      ],
      models: [
        {
          name: 'slow-stream',
          provider: 'openrouter-main',
          model: 'arcee-ai/trinity-large:free',
          priority: 10,
        },
        {
          name: 'fast-stream',
          provider: 'groq-main',
          model: 'openai/gpt-oss-20b',
          priority: 20,
        },
      ],
      executor: createExecutor(
        async () => {
          await Promise.resolve();
          return {
            text: 'unused',
            finishReason: 'stop',
            raw: {},
          };
        },
        async ({ model }) => {
          await Promise.resolve();
          if (model.name === 'slow-stream') {
            return {
              textStream: singleUseStream(['late'], { delayMs: 50 }),
              finishReason: Promise.resolve('stop'),
              usage: Promise.resolve(undefined),
              warnings: Promise.resolve(undefined),
              raw: { model: model.name },
            };
          }

          return {
            textStream: singleUseStream(['fast', ' stream']),
            finishReason: Promise.resolve('stop'),
            usage: Promise.resolve(undefined),
            warnings: Promise.resolve(undefined),
            raw: { model: model.name },
          };
        },
      ),
    });

    const streamResult = await router.streamText({
      prompt: 'Ping',
      firstChunkTimeoutMs: 10,
    });

    const chunks: string[] = [];
    for await (const chunk of streamResult.textStream) {
      chunks.push(chunk);
    }

    const final = await streamResult.final;

    expect(streamResult.target.name).toBe('fast-stream');
    expect(streamResult.attempts).toHaveLength(1);
    expect(streamResult.attempts[0]?.error?.name).toBe('FirstChunkTimeoutError');
    expect(chunks.join('')).toBe('fast stream');
    expect(final.text).toBe('fast stream');
    expect(final.attempts).toHaveLength(2);
    expect(final.attempts[1]?.success).toBe(true);
  });

  it('does not fall back after the first stream chunk has already been emitted', async () => {
    const router = createLlmRouter({
      providers: [
        {
          name: 'openrouter-main',
          type: 'openrouter',
          auth: { mode: 'single', apiKey: 'openrouter-key' },
        },
        {
          name: 'groq-main',
          type: 'groq',
          auth: { mode: 'single', apiKey: 'groq-key' },
        },
      ],
      models: [
        {
          name: 'selected-stream',
          provider: 'openrouter-main',
          model: 'arcee-ai/trinity-large:free',
          priority: 10,
        },
        {
          name: 'fallback-stream',
          provider: 'groq-main',
          model: 'openai/gpt-oss-20b',
          priority: 20,
        },
      ],
      executor: createExecutor(
        async () => {
          await Promise.resolve();
          return {
            text: 'unused',
            finishReason: 'stop',
            raw: {},
          };
        },
        async ({ model }) => {
          await Promise.resolve();
          if (model.name === 'selected-stream') {
            return {
              textStream: singleUseStream(['hello'], {
                errorAfterChunks: new Error('stream exploded'),
              }),
              finishReason: Promise.resolve('error'),
              usage: Promise.resolve(undefined),
              warnings: Promise.resolve(undefined),
              raw: { model: model.name },
            };
          }

          return {
            textStream: singleUseStream(['fallback']),
            finishReason: Promise.resolve('stop'),
            usage: Promise.resolve(undefined),
            warnings: Promise.resolve(undefined),
            raw: { model: model.name },
          };
        },
      ),
    });

    const streamResult = await router.streamText({
      prompt: 'Ping',
      firstChunkTimeoutMs: 100,
    });

    const received: string[] = [];

    await expect(
      (async () => {
        for await (const chunk of streamResult.textStream) {
          received.push(chunk);
        }
      })(),
    ).rejects.toThrow('stream exploded');

    await expect(streamResult.final).rejects.toThrow('stream exploded');
    expect(received.join('')).toBe('hello');
    expect(streamResult.target.name).toBe('selected-stream');
    expect(streamResult.attempts).toHaveLength(0);
  });
});
