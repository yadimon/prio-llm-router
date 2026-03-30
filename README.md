# @yadimon/prio-llm-router

`@yadimon/prio-llm-router` is a TypeScript library for routing text generation requests through a priority-ordered chain of LLM targets.

It is built for the common "free models first, paid models later" setup:

- providers are configured once with names and API keys
- models are configured once with names, provider references, priorities, and metadata
- each request can use either an explicit chain or the implicit global priority order
- failures automatically fall through to the next configured target

The package keeps the routing logic intentionally small and predictable while reusing the Vercel AI SDK provider ecosystem for the actual provider calls.

## Features

- Priority-based fallback across multiple providers and models
- Separate provider config and model target config
- Optional source builders for source-centric setup and strict free policies
- Non-streaming text generation and optional streaming
- Optional debug mode that mirrors attempt hooks to the console
- Built-in support for `google`, `openrouter`, `groq`, `mistral`, `cohere`, `perplexity`, `xai`, `togetherai`, `openai`, `anthropic`, `deepseek`, and generic `openai-compatible`
- Strict TypeScript types
- Hook points for attempt-level logging and telemetry
- Ready for npm publishing and GitHub CI
- Structured to support future provider key pools without changing the model-chain API

## Documentation

- [Configuration Guide](./docs/configuration.md)
- [Streaming Semantics](./docs/streaming.md)
- [Architecture Notes](./docs/architecture.md)
- [Current Free Possibilities](./docs/current-free-possibilities.md)
- [Local Providers](./docs/local-providers.md)
- [Examples](./examples/README.md)
- [Contributor Agent Notes](./AGENTS.md)

## Installation

```bash
npm install @yadimon/prio-llm-router
```

## When To Use It

This package is a good fit when:

- you want to try multiple providers in a deterministic order
- you want free models first and paid models later
- you want one stable application-facing API while provider choices evolve
- you want fallback behavior to live in one place instead of being spread across app code

It is not trying to be a universal orchestration framework. The goal is a narrow, reliable router for text calls.

## Quick Start

```ts
import { createLlmRouter } from '@yadimon/prio-llm-router';

const router = createLlmRouter({
  providers: [
    {
      name: 'openrouter-main',
      type: 'openrouter',
      auth: {
        mode: 'single',
        apiKey: process.env.OPENROUTER_API_KEY!,
      },
      appName: 'prio-llm-router-demo',
      appUrl: 'https://example.com',
    },
    {
      name: 'groq-main',
      type: 'groq',
      auth: {
        mode: 'single',
        apiKey: process.env.GROQ_API_KEY!,
      },
    },
    {
      name: 'openai-main',
      type: 'openai',
      auth: {
        mode: 'single',
        apiKey: process.env.OPENAI_API_KEY!,
      },
    },
  ],
  models: [
    {
      name: 'trinity-free',
      provider: 'openrouter-main',
      model: 'arcee-ai/trinity-large:free',
      priority: 10,
      tier: 'free',
    },
    {
      name: 'groq-oss',
      provider: 'groq-main',
      model: 'openai/gpt-oss-20b',
      priority: 20,
      tier: 'free',
    },
    {
      name: 'gpt-4.1-paid',
      provider: 'openai-main',
      model: 'gpt-4.1-mini',
      priority: 100,
      tier: 'paid',
    },
  ],
  debug: true,
  hooks: {
    onAttemptFailure(attempt) {
      console.warn('LLM attempt failed:', attempt);
    },
  },
});

const result = await router.generateText({
  prompt: 'Summarize the advantages of priority-based model routing in 3 bullets.',
});

console.log(result.text);
console.log(result.target);
console.log(result.attempts);
```

With `debug: true`, the router writes `attempt:start`, `attempt:success`, and `attempt:failure` events to the console while still calling your custom hooks.

## Basic Mental Model

There are two separate layers:

- `providers`: named credentials and transport settings
- `models`: named routing targets that point to a provider and a concrete model id

Your app sends requests to the router using model target names, not raw provider config.

There is also an additive builder layer for source-centric setup:

- `createLlmConnection(...)`
- `createLlmSource(...)`
- `createOpenRouterConnection(...)`
- `createOpenRouterFreeSource(...)`
- `createOpenAICompatibleConnection(...)`

This is the preferred path when you want to mark a source as strict `free`.

## Strict Free Sources

Strict `free` mode is intentionally narrow.

It exists only where the package can prevent paid usage from the request shape alone. Today that means:

- only `openrouter`
- only explicit model ids that end in `:free`

Example:

```ts
import {
  createOpenRouterConnection,
  createOpenRouterFreeSource,
  createLlmRouter,
} from '@yadimon/prio-llm-router';

const openRouter = createOpenRouterConnection({
  name: 'openrouter-main',
  auth: {
    mode: 'single',
    apiKey: process.env.OPENROUTER_API_KEY!,
  },
  appName: 'prio-llm-router-demo',
  appUrl: 'https://example.com',
});

const router = createLlmRouter({
  sources: [
    createOpenRouterFreeSource(openRouter, {
      name: 'kimi-free',
      model: 'moonshotai/kimi-k2:free',
      priority: 10,
    }),
  ],
});
```

The package rejects strict `free` sources for providers whose free status depends on account plan or billing setup, such as `google`, `groq`, `mistral`, or `cohere`.

## Explicit Request Chains

If you want per-request routing, pass a chain of configured model target names:

```ts
const result = await router.generateText({
  prompt: 'Write a terse release note.',
  chain: ['trinity-free', 'groq-oss', 'gpt-4.1-paid'],
});
```

The chain values are target names from the `models` config, not raw provider names or raw model ids.

If `chain` is not provided, the router uses:

- `defaultChain` from setup if present
- otherwise all enabled model targets sorted by ascending `priority`

## Messages Instead of Prompt

```ts
const result = await router.generateText({
  system: 'Be concise.',
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'Explain fallback routing.' }] },
  ],
});
```

## Streaming With First-Chunk Fallback

For chat-style UX you can use `streamText`.

The router behavior is intentionally strict:

- before the first text chunk arrives, it may fall back to the next target
- once the first text chunk has been emitted, the model is locked in
- if the selected stream later fails, the error is surfaced and no further fallback happens

```ts
const stream = await router.streamText({
  prompt: 'Explain this system in short sentences.',
  chain: ['trinity-free', 'groq-oss', 'gpt-4.1-paid'],
  firstChunkTimeoutMs: 2500,
});

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}

const final = await stream.final;
console.log(final.target.name);
```

Use `firstChunkTimeoutMs` when you want "switch if nothing starts quickly enough" behavior. If you omit it, the router waits indefinitely for the first chunk of the current target.

This makes the behavior safe for chat UIs:

- no silent model switch after the answer has already started
- no mixed output from multiple models in one response
- deterministic fallback only during the "nothing has started yet" phase

## Configuration Model

### Providers

Providers are named credentials plus provider type:

```ts
{
  name: 'groq-main',
  type: 'groq',
  auth: {
    mode: 'single',
    apiKey: process.env.GROQ_API_KEY!,
  },
}
```

Today the auth mode is `single`. The type layout is intentionally future-friendly so provider key pools or key-priority strategies can be added later without changing how models reference providers.

Common provider-level fields:

- `name`
- `type`
- `auth`
- `enabled`
- `baseURL`
- `headers`

### Models

Models are named routing targets:

```ts
{
  name: 'trinity-free',
  provider: 'openrouter-main',
  model: 'arcee-ai/trinity-large:free',
  priority: 10,
  tier: 'free',
}
```

The router either:

- uses `request.chain` if provided
- uses `defaultChain` from setup if provided
- otherwise sorts enabled targets by ascending `priority`

Common model-level fields:

- `name`
- `provider`
- `model`
- `enabled`
- `priority`
- `tier`
- `metadata`

## Debug Mode And Hooks

Use `debug: true` when you want the router to mirror attempt hooks to the console during development.

```ts
const router = createLlmRouter({
  debug: true,
  providers,
  models,
});
```

That debug mode is intentionally small:

- `console.log('[prio-llm-router] attempt:start', attempt)`
- `console.log('[prio-llm-router] attempt:success', attempt)`
- `console.error('[prio-llm-router] attempt:failure', attempt)`

If you also pass `hooks`, both stay active. Debug mode does not replace custom telemetry.

## Supported Providers

- `google`
- `openrouter`
- `groq`
- `mistral`
- `cohere`
- `perplexity`
- `xai`
- `togetherai`
- `openai`
- `anthropic`
- `deepseek`
- `openai-compatible`

These built-in types focus on API-key-based providers that map cleanly to the Vercel AI SDK. For OpenAI-style gateways and proxies, use `openai-compatible`.

Use `openai-compatible` when you have an OpenAI-style endpoint that is not covered by a first-party adapter:

```ts
{
  name: 'my-proxy',
  type: 'openai-compatible',
  baseURL: 'https://my-proxy.example.com/v1',
  providerLabel: 'my-proxy',
  auth: {
    mode: 'single',
    apiKey: process.env.MY_PROXY_API_KEY!,
  },
}
```

If you prefer typed helpers over raw provider objects, use:

```ts
import {
  createOpenAICompatibleConnection,
  createOpenRouterConnection,
  createOpenRouterFreeSource,
} from '@yadimon/prio-llm-router';
```

This also covers local OpenAI-compatible runtimes such as LM Studio, Ollama, or other local gateways.

Example for LM Studio running locally on `http://127.0.0.1:1234/v1`:

Before using this setup, make sure LM Studio's local server is running with the OpenAI-compatible API enabled.

```ts
import {
  createLlmRouter,
  createOpenAICompatibleConnection,
} from '@yadimon/prio-llm-router';

const router = createLlmRouter({
  providers: [
    createOpenAICompatibleConnection({
      name: 'lm-studio-local',
      baseURL: 'http://127.0.0.1:1234/v1',
      providerLabel: 'lm-studio',
      auth: {
        mode: 'single',
        apiKey: 'lm-studio',
      },
    }).provider,
  ],
  models: [
    {
      name: 'local-qwen',
      provider: 'lm-studio-local',
      model: 'qwen2.5-7b-instruct',
      priority: 10,
    },
  ],
});

const result = await router.generateText({
  prompt: 'Describe this local LM Studio setup in one sentence.',
});

console.log(result.text);
```

Notes:

- for LM Studio, enable the OpenAI-compatible local API before using this config
- the local server still needs to expose an OpenAI-compatible HTTP API
- the package currently requires a non-empty `apiKey`, so local runtimes that ignore auth should use a dummy value such as `'lm-studio'`
- the `model` value must match the local model name exposed by your runtime

For a focused local-setup guide, see [Local Providers](./docs/local-providers.md).

## Error Model

If every target fails, the router throws `AllModelsFailedError`.

That error includes:

- `attempts`: all failed attempts in execution order
- `cause`: the last underlying error

This makes it straightforward to log or surface detailed fallback history.

For streaming requests:

- fallback is allowed only before the first emitted text chunk
- after the stream starts, later errors are surfaced directly
- `stream.final` resolves to the final aggregated result when the stream completes successfully

## Public API

Main exports:

- `createLlmRouter`
- `PrioLlmRouter`
- `createDefaultTextGenerationExecutor`
- `createOpenRouterConnection`
- `createOpenRouterFreeSource`
- `createOpenAICompatibleConnection`
- `AllModelsFailedError`
- `RouterConfigurationError`

Main methods:

- `router.generateText(...)`
- `router.streamText(...)`
- `router.listProviders()`
- `router.listModels()`

## Development

```bash
npm install
npm run check
```

Repository layout:

- [src](./src)
- [tests](./tests)
- [examples](./examples)
- [docs](./docs)

## Notes

- The routing logic is deliberately separate from provider execution logic.
- OpenRouter request headers `HTTP-Referer` and `X-Title` can be set via `appUrl` and `appName`.
- Examples in this repository import from `../src/index.js` for local development. In external projects, import from `@yadimon/prio-llm-router`.
