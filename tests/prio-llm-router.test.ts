import { getEventListeners } from 'node:events';

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
  RouterHooks,
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

function flushUnhandledRejections(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => {
      setImmediate(resolve);
    });
  });
}

function createTwoTargetRouter(
  executor: TextGenerationExecutor,
  options: { defaultAttemptTimeoutMs?: number; hooks?: RouterHooks } = {},
) {
  return createLlmRouter({
    ...options,
    providers: [
      {
        name: 'primary-provider',
        type: 'openrouter',
        auth: { mode: 'single', apiKey: 'primary-key' },
      },
      {
        name: 'fallback-provider',
        type: 'groq',
        auth: { mode: 'single', apiKey: 'fallback-key' },
      },
    ],
    models: [
      {
        name: 'primary-target',
        provider: 'primary-provider',
        model: 'primary-model',
        priority: 10,
      },
      {
        name: 'fallback-target',
        provider: 'fallback-provider',
        model: 'fallback-model',
        priority: 20,
      },
    ],
    executor,
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

  it('compiles prefixed model configs against configured provider prefixes', async () => {
    const router = createLlmRouter({
      providers: [
        {
          name: 'openrouter-main',
          prefix: 'or',
          type: 'openrouter',
          auth: { mode: 'single', apiKey: 'openrouter-key' },
        },
      ],
      models: [
        {
          name: 'gemma-free',
          model: 'or:google/gemma-4-31b-it:free',
          priority: 10,
          tier: 'free',
        },
      ],
      executor: createExecutor(async ({ model }) => {
        await Promise.resolve();
        return {
          text: `served by ${model.provider}/${model.model}`,
          finishReason: 'stop',
          raw: { target: model.name },
        };
      }),
    });

    const result = await router.generateText({ prompt: 'Ping' });

    expect(result.target.name).toBe('gemma-free');
    expect(result.target.providerName).toBe('openrouter-main');
    expect(result.target.model).toBe('google/gemma-4-31b-it:free');
    expect(result.text).toBe(
      'served by openrouter-main/google/gemma-4-31b-it:free',
    );
  });

  it('prefers exact target-name matches before provider-prefix fallback in chains', async () => {
    const router = createLlmRouter({
      providers: [
        {
          name: 'openrouter-main',
          prefix: 'or',
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
          name: 'or:google/gemma-4-31b-it:free',
          provider: 'groq-main',
          model: 'openai/gpt-oss-20b',
        },
      ],
      executor: createExecutor(async ({ model }) => {
        await Promise.resolve();
        return {
          text: `served by ${model.provider}/${model.model}`,
          finishReason: 'stop',
          raw: { target: model.name },
        };
      }),
    });

    const result = await router.generateText({
      prompt: 'Ping',
      chain: ['or:google/gemma-4-31b-it:free'],
    });

    expect(result.target.name).toBe('or:google/gemma-4-31b-it:free');
    expect(result.target.providerName).toBe('groq-main');
    expect(result.target.model).toBe('openai/gpt-oss-20b');
  });

  it('resolves prefixed chain targets through the matching provider when no exact target exists', async () => {
    const router = createLlmRouter({
      providers: [
        {
          name: 'openrouter-main',
          prefix: 'or',
          type: 'openrouter',
          auth: { mode: 'single', apiKey: 'openrouter-key' },
        },
      ],
      models: [
        {
          name: 'configured-target',
          provider: 'openrouter-main',
          model: 'moonshotai/kimi-k2:free',
        },
      ],
      executor: createExecutor(async ({ model }) => {
        await Promise.resolve();
        return {
          text: `served by ${model.provider}/${model.model}`,
          finishReason: 'stop',
          raw: { target: model.name },
        };
      }),
    });

    const result = await router.generateText({
      prompt: 'Ping',
      chain: ['or:google/gemma-4-31b-it:free'],
    });

    expect(result.target.name).toBe('or:google/gemma-4-31b-it:free');
    expect(result.target.providerName).toBe('openrouter-main');
    expect(result.target.model).toBe('google/gemma-4-31b-it:free');
    expect(result.text).toBe(
      'served by openrouter-main/google/gemma-4-31b-it:free',
    );
  });

  it('uses prefixed refs in the default chain when configured', async () => {
    const router = createLlmRouter({
      defaultChain: ['or:google/gemma-4-31b-it:free'],
      providers: [
        {
          name: 'openrouter-main',
          prefix: 'or',
          type: 'openrouter',
          auth: { mode: 'single', apiKey: 'openrouter-key' },
        },
      ],
      models: [
        {
          name: 'configured-target',
          provider: 'openrouter-main',
          model: 'moonshotai/kimi-k2:free',
        },
      ],
      executor: createExecutor(async ({ model }) => {
        await Promise.resolve();
        return {
          text: model.name,
          finishReason: 'stop',
          raw: { target: model.name },
        };
      }),
    });

    const result = await router.generateText({ prompt: 'Ping' });

    expect(result.target.name).toBe('or:google/gemma-4-31b-it:free');
    expect(result.target.providerName).toBe('openrouter-main');
    expect(result.target.model).toBe('google/gemma-4-31b-it:free');
  });

  it('rejects duplicate provider prefixes', () => {
    expect(() =>
      createLlmRouter({
        providers: [
          {
            name: 'openrouter-main',
            prefix: 'or',
            type: 'openrouter',
            auth: { mode: 'single', apiKey: 'openrouter-key' },
          },
          {
            name: 'openrouter-backup',
            prefix: 'or',
            type: 'openrouter',
            auth: { mode: 'single', apiKey: 'openrouter-key-2' },
          },
        ],
        models: [
          {
            name: 'configured-target',
            provider: 'openrouter-main',
            model: 'moonshotai/kimi-k2:free',
          },
        ],
      }),
    ).toThrow(RouterConfigurationError);
  });

  it('rejects prefixed model configs that reference unknown provider prefixes', () => {
    expect(() =>
      createLlmRouter({
        providers: [
          {
            name: 'openrouter-main',
            prefix: 'or',
            type: 'openrouter',
            auth: { mode: 'single', apiKey: 'openrouter-key' },
          },
        ],
        models: [
          {
            name: 'broken-sugar-target',
            model: 'missing:google/gemma-4-31b-it:free',
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

  it('accepts vercel gateway providers as explicit router targets', async () => {
    const router = createLlmRouter({
      providers: [
        {
          name: 'vercel-main',
          type: 'vercel',
          auth: { mode: 'single', apiKey: 'vercel-key' },
        },
      ],
      models: [
        {
          name: 'vercel-gpt-oss',
          provider: 'vercel-main',
          model: 'openai/gpt-oss-20b',
        },
      ],
      executor: createExecutor(async ({ model }) => {
        await Promise.resolve();
        return {
          text: `served by ${model.provider}/${model.model}`,
          finishReason: 'stop',
          raw: { target: model.name },
        };
      }),
    });

    const result = await router.generateText({
      prompt: 'Ping',
    });

    expect(result.target.providerType).toBe('vercel');
    expect(result.target.providerName).toBe('vercel-main');
    expect(result.text).toBe('served by vercel-main/openai/gpt-oss-20b');
  });

  it('times out a hanging target and falls back to the next target', async () => {
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
          name: 'hanging-target',
          provider: 'openrouter-main',
          model: 'arcee-ai/trinity-large:free',
          priority: 10,
        },
        {
          name: 'fallback-target',
          provider: 'groq-main',
          model: 'openai/gpt-oss-20b',
          priority: 20,
        },
      ],
      executor: createExecutor(async ({ model, request }) => {
        await Promise.resolve();
        if (model.name === 'hanging-target') {
          return new Promise<ExecuteTextTargetResult>((_resolve, reject) => {
            request.abortSignal?.addEventListener(
              'abort',
              () =>
                reject(
                  request.abortSignal?.reason instanceof Error
                    ? request.abortSignal.reason
                    : new Error('Aborted'),
                ),
              { once: true },
            );
          });
        }

        return {
          text: 'served by fallback',
          finishReason: 'stop',
          raw: { target: model.name },
        };
      }),
    });

    const result = await router.generateText({
      prompt: 'Ping',
      attemptTimeoutMs: 10,
    });

    expect(result.target.name).toBe('fallback-target');
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0]?.error?.name).toBe('AttemptTimeoutError');
    expect(result.attempts[0]?.error?.message).toBe(
      'Model attempt timed out after 10ms',
    );
    expect(result.attempts[0]?.success).toBe(false);
    expect(result.attempts[1]?.success).toBe(true);
  });

  it('applies the router default attempt timeout when a request override is not set', async () => {
    const router = createLlmRouter({
      defaultAttemptTimeoutMs: 10,
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
          name: 'slow-target',
          provider: 'openrouter-main',
          model: 'arcee-ai/trinity-large:free',
          priority: 10,
        },
        {
          name: 'fast-target',
          provider: 'groq-main',
          model: 'openai/gpt-oss-20b',
          priority: 20,
        },
      ],
      executor: createExecutor(async ({ model, request }) => {
        await Promise.resolve();
        if (model.name === 'slow-target') {
          return new Promise<ExecuteTextTargetResult>((_resolve, reject) => {
            request.abortSignal?.addEventListener(
              'abort',
              () =>
                reject(
                  request.abortSignal?.reason instanceof Error
                    ? request.abortSignal.reason
                    : new Error('Aborted'),
                ),
              { once: true },
            );
          });
        }

        return {
          text: 'ok',
          finishReason: 'stop',
          raw: { target: model.name },
        };
      }),
    });

    const result = await router.generateText({ prompt: 'Ping' });

    expect(result.target.name).toBe('fast-target');
    expect(result.attempts[0]?.error?.name).toBe('AttemptTimeoutError');
  });

  it('clears the attempt timer after generateText succeeds', async () => {
    vi.useFakeTimers();

    try {
      const router = createTwoTargetRouter(
        createExecutor(async () => {
          await Promise.resolve();
          return {
            text: 'fast success',
            finishReason: 'stop',
            raw: {},
          };
        }),
        { defaultAttemptTimeoutMs: 12_000 },
      );

      const result = await router.generateText({ prompt: 'Ping' });

      expect(result.text).toBe('fast success');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears the first-chunk timer after streamText selects a target', async () => {
    vi.useFakeTimers();

    try {
      const router = createTwoTargetRouter(
        createExecutor(async () => {
          await Promise.resolve();
          return {
            text: 'unused',
            finishReason: 'stop',
            raw: {},
          };
        }),
        { defaultAttemptTimeoutMs: 12_000 },
      );

      const result = await router.streamText({ prompt: 'Ping' });

      expect(result.target.name).toBe('primary-target');
      expect(vi.getTimerCount()).toBe(0);

      for await (const chunk of result.textStream) {
        expect(chunk).toBe('stream:primary-target');
      }
      await result.final;
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops generateText fallback when the caller aborts with a custom error', async () => {
    const callerAbort = new Error('client disconnected');
    const controller = new AbortController();
    const execute = vi.fn(
      async ({ model, request }: ExecuteTextTargetInput) => {
        await Promise.resolve();

        if (model.name === 'primary-target') {
          return new Promise<ExecuteTextTargetResult>((_resolve, reject) => {
            const rejectFromAbort = (): void => {
              reject(
                request.abortSignal?.reason instanceof Error
                  ? request.abortSignal.reason
                  : new Error('Aborted'),
              );
            };

            if (request.abortSignal?.aborted) {
              rejectFromAbort();
            } else {
              request.abortSignal?.addEventListener('abort', rejectFromAbort, {
                once: true,
              });
            }
          });
        }

        return {
          text: 'fallback must not run',
          finishReason: 'stop',
          raw: {},
        };
      },
    );
    const router = createTwoTargetRouter(createExecutor(execute));

    const resultPromise = router.generateText({
      prompt: 'Ping',
      abortSignal: controller.signal,
    });
    controller.abort(callerAbort);

    await expect(resultPromise).rejects.toBe(callerAbort);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('stops pre-chunk stream fallback when the caller aborts with a custom error', async () => {
    const callerAbort = new Error('client disconnected');
    const controller = new AbortController();
    const stream = vi.fn(
      async ({ model, request }: ExecuteTextTargetInput) => {
        await Promise.resolve();

        if (model.name === 'primary-target') {
          const textStream: AsyncIterable<string> = {
            [Symbol.asyncIterator]() {
              return {
                next: () =>
                  new Promise<IteratorResult<string>>((_resolve, reject) => {
                    const rejectFromAbort = (): void => {
                      reject(
                        request.abortSignal?.reason instanceof Error
                          ? request.abortSignal.reason
                          : new Error('Aborted'),
                      );
                    };

                    if (request.abortSignal?.aborted) {
                      rejectFromAbort();
                    } else {
                      request.abortSignal?.addEventListener(
                        'abort',
                        rejectFromAbort,
                        { once: true },
                      );
                    }
                  }),
              };
            },
          };

          return {
            textStream,
            finishReason: Promise.resolve('stop'),
            usage: Promise.resolve(undefined),
            warnings: Promise.resolve(undefined),
            raw: {},
          };
        }

        return {
          textStream: singleUseStream(['fallback must not run']),
          finishReason: Promise.resolve('stop'),
          usage: Promise.resolve(undefined),
          warnings: Promise.resolve(undefined),
          raw: {},
        };
      },
    );
    const router = createTwoTargetRouter(
      createExecutor(
        async () => {
          await Promise.resolve();
          return {
            text: 'unused',
            finishReason: 'stop',
            raw: {},
          };
        },
        stream,
      ),
    );

    const resultPromise = router.streamText({
      prompt: 'Ping',
      abortSignal: controller.signal,
    });
    controller.abort(callerAbort);

    await expect(resultPromise).rejects.toBe(callerAbort);
    expect(stream).toHaveBeenCalledTimes(1);
  });

  it('logs router attempts in debug mode', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const router = createLlmRouter({
        debug: true,
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
            name: 'failing-target',
            provider: 'openrouter-main',
            model: 'arcee-ai/trinity-large:free',
            priority: 10,
          },
          {
            name: 'working-target',
            provider: 'groq-main',
            model: 'openai/gpt-oss-20b',
            priority: 20,
          },
        ],
        executor: createExecutor(async ({ model }) => {
          await Promise.resolve();
          if (model.name === 'failing-target') {
            throw new Error('boom');
          }

          return {
            text: 'ok',
            finishReason: 'stop',
            raw: { target: model.name },
          };
        }),
      });

      await router.generateText({ prompt: 'Ping' });

      expect(logSpy).toHaveBeenCalledWith(
        '[prio-llm-router] attempt:start',
        expect.objectContaining({ targetName: 'failing-target' }),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        '[prio-llm-router] attempt:failure',
        expect.objectContaining({ targetName: 'failing-target' }),
      );
      expect(logSpy).toHaveBeenCalledWith(
        '[prio-llm-router] attempt:success',
        expect.objectContaining({ targetName: 'working-target' }),
      );
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
  });

  it('keeps user hooks active when debug mode is enabled', async () => {
    const onAttemptStart = vi.fn();
    const onAttemptSuccess = vi.fn();
    const onAttemptFailure = vi.fn();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const router = createLlmRouter({
        debug: true,
        hooks: {
          onAttemptStart,
          onAttemptSuccess,
          onAttemptFailure,
        },
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
          return {
            text: 'ok',
            finishReason: 'stop',
            raw: {},
          };
        }),
      });

      await router.generateText({ prompt: 'Ping' });

      expect(onAttemptStart).toHaveBeenCalledTimes(1);
      expect(onAttemptSuccess).toHaveBeenCalledTimes(1);
      expect(onAttemptFailure).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }
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
            name: 'paid-looking-openrouter',
            model: 'openai/gpt-4.1-mini',
            access: 'free',
          } as never),
        ],
      }),
    ).toThrow(RouterConfigurationError);
  });

  it('accepts openrouter/free as a random free-model routing alias', () => {
    const openRouterConnection = createLlmConnection({
      name: 'openrouter-main',
      type: 'openrouter',
      auth: { mode: 'single', apiKey: 'openrouter-key' },
    });

    expect(() =>
      createLlmRouter({
        sources: [
          createLlmSource(openRouterConnection, {
            name: 'random-openrouter-free',
            model: 'openrouter/free',
            access: 'free',
          }),
        ],
      }),
    ).not.toThrow();
  });

  it('accepts openai-compatible router configs with an empty API key', async () => {
    const router = createLlmRouter({
      providers: [
        {
          name: 'lm-studio',
          type: 'openai-compatible',
          baseURL: 'http://127.0.0.1:1234/v1',
          auth: { mode: 'single', apiKey: '' },
        },
      ],
      models: [
        {
          name: 'local-model',
          provider: 'lm-studio',
          model: 'qwen2.5-7b-instruct',
        },
      ],
      executor: createExecutor(async () => {
        await Promise.resolve();
        return {
          text: 'local ok',
          finishReason: 'stop',
          raw: {},
        };
      }),
    });

    const result = await router.generateText({ prompt: 'Ping' });

    expect(result.text).toBe('local ok');
  });

  it('still rejects openrouter router configs with an empty API key', () => {
    expect(() =>
      createLlmRouter({
        providers: [
          {
            name: 'openrouter-main',
            type: 'openrouter',
            auth: { mode: 'single', apiKey: '' },
          },
        ],
        models: [
          {
            name: 'openrouter-free',
            provider: 'openrouter-main',
            model: 'moonshotai/kimi-k2:free',
          },
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

  it('rejects prefixed chain targets when the matched provider is disabled', async () => {
    const router = createLlmRouter({
      providers: [
        {
          name: 'openrouter-main',
          prefix: 'or',
          type: 'openrouter',
          auth: { mode: 'single', apiKey: 'openrouter-key' },
          enabled: false,
        },
      ],
      models: [
        {
          name: 'configured-target',
          provider: 'openrouter-main',
          model: 'moonshotai/kimi-k2:free',
        },
      ],
    });

    await expect(
      router.generateText({
        prompt: 'Ping',
        chain: ['or:google/gemma-4-31b-it:free'],
      }),
    ).rejects.toThrow('disabled or its provider is disabled');
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
    expect(streamResult.attempts[0]?.error?.name).toBe('AttemptTimeoutError');
    expect(chunks.join('')).toBe('fast stream');
    expect(final.text).toBe('fast stream');
    expect(final.attempts).toHaveLength(2);
    expect(final.attempts[1]?.success).toBe(true);
  });

  it('uses attemptTimeoutMs as the streaming first-chunk timeout fallback', async () => {
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
      attemptTimeoutMs: 10,
    });

    const chunks: string[] = [];
    for await (const chunk of streamResult.textStream) {
      chunks.push(chunk);
    }

    const final = await streamResult.final;

    expect(streamResult.target.name).toBe('fast-stream');
    expect(streamResult.attempts[0]?.error?.name).toBe('AttemptTimeoutError');
    expect(chunks.join('')).toBe('fast stream');
    expect(final.text).toBe('fast stream');
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

  it('does not report an unhandled rejection when the caller abandons the text stream without awaiting final', async () => {
    const unhandled: unknown[] = [];
    const collectUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    const controller = new AbortController();

    process.on('unhandledRejection', collectUnhandled);

    try {
      const router = createTwoTargetRouter(
        createExecutor(
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
            return {
              textStream: singleUseStream(['first', ' second', ' third']),
              finishReason: Promise.resolve('stop'),
              usage: Promise.resolve(undefined),
              warnings: Promise.resolve(undefined),
              raw: { model: model.name },
            };
          },
        ),
      );

      const streamResult = await router.streamText({
        prompt: 'Ping',
        abortSignal: controller.signal,
      });

      const received: string[] = [];
      for await (const chunk of streamResult.textStream) {
        received.push(chunk);
        break;
      }

      await flushUnhandledRejections();

      expect(received).toEqual(['first']);
      expect(unhandled).toEqual([]);
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', collectUnhandled);
    }
  });

  it(
    'rejects the final promise when the attempt success hook throws',
    { timeout: 1000 },
    async () => {
      const controller = new AbortController();
      const router = createTwoTargetRouter(
        createExecutor(
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
            return {
              textStream: singleUseStream(['hello', ' world']),
              finishReason: Promise.resolve('stop'),
              usage: Promise.resolve(undefined),
              warnings: Promise.resolve(undefined),
              raw: { model: model.name },
            };
          },
        ),
        {
          hooks: {
            onAttemptSuccess: () => {
              throw new Error('attempt success hook exploded');
            },
          },
        },
      );

      const streamResult = await router.streamText({
        prompt: 'Ping',
        abortSignal: controller.signal,
      });

      const received: string[] = [];

      await expect(
        (async () => {
          for await (const chunk of streamResult.textStream) {
            received.push(chunk);
          }
        })(),
      ).rejects.toThrow('attempt success hook exploded');

      await expect(streamResult.final).rejects.toThrow(
        'attempt success hook exploded',
      );
      expect(received.join('')).toBe('hello world');
      expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    },
  );
});
