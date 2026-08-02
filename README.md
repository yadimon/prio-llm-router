# @yadimon/prio-llm-router

Deterministic, in-process fallback routing for text generation across Vercel AI SDK providers.

Use one application-facing API while trying model targets in the order you choose: a free model first, a fast provider second, a paid model last, or a different chain for each workload. The router uses your provider keys directly and does not require a separate gateway service.

```text
request -> target 1 -> execution error or timeout -> target 2 -> success
                                                    |
                                                    +-> result + attempt history
```

## Install

```bash
npm install @yadimon/prio-llm-router
```

Requirements: Node.js `>=18.18` and ESM or CommonJS.

## Quick Start

This example uses one OpenRouter key, tries the random free-model route first, and uses a paid model only if the first call throws.

```ts
import { createLlmRouter } from '@yadimon/prio-llm-router';

const router = createLlmRouter({
  providers: [
    {
      name: 'openrouter',
      type: 'openrouter',
      auth: {
        mode: 'single',
        apiKey: process.env.OPENROUTER_API_KEY!,
      },
      appName: 'my-app',
      appUrl: 'https://example.com',
    },
  ],
  models: [
    {
      name: 'free-first',
      provider: 'openrouter',
      model: 'openrouter/free',
      priority: 10,
      tier: 'free',
    },
    {
      name: 'paid-backup',
      provider: 'openrouter',
      model: 'openai/gpt-4.1-mini',
      priority: 100,
      tier: 'paid',
    },
  ],
});

const result = await router.generateText({
  prompt: 'Explain fallback routing in two short bullets.',
});

console.log(result.text);
console.log('selected:', result.target.name);
console.log('attempts:', result.attempts);
console.log('usage:', result.usage);
```

Replace the example model IDs with models available to your provider account. Provider catalogs and pricing change independently of this package.

## Why Use It?

Use `prio-llm-router` when you want:

- deterministic fallback across model IDs, providers, or local gateways
- free-first or cost-aware chains that are visible in application config
- one typed API for `generateText` and `streamText`
- per-request chains for different workloads
- attempt timeouts, attempt history, and telemetry hooks
- a small library inside your Node.js process instead of a hosted gateway

Choose a full AI gateway or orchestration framework instead if you need load balancing, managed key pools, health-based routing, circuit breakers, caching, budgets, guardrails, or a control plane. Those features are intentionally outside this package.

## How Routing Works

For non-streaming calls, the router:

1. Uses `request.chain`, then `defaultChain`, then enabled targets sorted by ascending `priority`.
2. Calls one target at a time.
3. Returns immediately when a target completes successfully.
4. Records an execution error or attempt timeout and tries the next target.
5. Throws `AllModelsFailedError` with every failed attempt if the chain is exhausted.

Targets with the same priority keep their declaration order. Disabled targets and targets belonging to disabled providers are skipped in the implicit priority chain.

### What Counts As Failure?

Fallback is triggered by a thrown provider/AI SDK error or an `AttemptTimeoutError`. It is not triggered by output quality.

| Outcome | Router behavior |
| --- | --- |
| Provider rejects, rate-limits, times out, or throws | Record failure and try the next target |
| `generateText` returns empty, malformed, off-topic, or schema-invalid text without throwing | Treat the attempt as successful |
| Caller aborts the request | Stop the whole request; do not continue fallback |
| Every target fails | Throw `AllModelsFailedError` |
| A stream completes before emitting text | Record `EmptyStreamError` and try the next target |
| A stream fails before its first text chunk | Try the next target |
| A stream fails after its first text chunk | Surface the error; do not mix models |

If validity matters, validate `result.text` in your application. See [Structured Output And Validation](#structured-output-and-validation).

## Multiple Providers

Providers hold credentials and transport settings. Model targets point to providers and define routing order.

```ts
const router = createLlmRouter({
  providers: [
    {
      name: 'groq',
      type: 'groq',
      auth: { mode: 'single', apiKey: process.env.GROQ_API_KEY! },
    },
    {
      name: 'openai',
      type: 'openai',
      auth: { mode: 'single', apiKey: process.env.OPENAI_API_KEY! },
    },
  ],
  models: [
    {
      name: 'fast-first',
      provider: 'groq',
      model: 'openai/gpt-oss-20b',
      priority: 10,
    },
    {
      name: 'quality-backup',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      priority: 100,
    },
  ],
  defaultChain: ['fast-first', 'quality-backup'],
});
```

Use `chain` to override the order for one request:

```ts
const result = await router.generateText({
  prompt: 'Write a concise release note.',
  chain: ['quality-backup', 'fast-first'],
});
```

Chain values are target names, not provider names. Duplicate chain entries are tried only once.

## Provider Prefixes

Prefixes are optional shorthand for apps that build chains from configuration or environment variables:

```ts
const router = createLlmRouter({
  providers: [
    {
      name: 'openrouter',
      prefix: 'or',
      type: 'openrouter',
      auth: { mode: 'single', apiKey: process.env.OPENROUTER_API_KEY! },
    },
  ],
  models: [
    {
      name: 'free-model',
      model: 'or:google/gemma-3-27b-it:free',
      priority: 10,
      tier: 'free',
    },
  ],
});

await router.generateText({
  prompt: 'Answer briefly.',
  chain: ['or:google/gemma-3-27b-it:free'],
});
```

An exact configured target-name match wins before prefix resolution. A prefixed request-chain entry may also reference a model that was not declared in `models`; the router resolves it through the matching provider prefix.

## Free-First Chains

`tier: 'free'` is metadata for routing records and telemetry. It does not inspect billing or prevent a provider from charging.

For a config-time free-only guard, use `createOpenRouterFreeSource`. Strict free sources currently accept only OpenRouter model IDs ending in `:free` or the `openrouter/free` alias:

```ts
import {
  createLlmRouter,
  createOpenRouterConnection,
  createOpenRouterFreeSource,
} from '@yadimon/prio-llm-router';

const openRouter = createOpenRouterConnection({
  name: 'openrouter',
  auth: { mode: 'single', apiKey: process.env.OPENROUTER_API_KEY! },
});

const router = createLlmRouter({
  sources: [
    createOpenRouterFreeSource(openRouter, {
      name: 'free-model',
      model: 'google/gemma-3-27b-it:free',
      priority: 10,
    }),
  ],
});
```

Other providers may offer free quotas, but that depends on account state and cannot be guaranteed from the request shape.

## Timeouts, Retries, And Abort

Set a default timeout for each target attempt:

```ts
const router = createLlmRouter({
  providers,
  models,
  defaultAttemptTimeoutMs: 12_000,
  defaultProviderMaxRetries: 0,
});
```

Override it for one request and optionally bound the whole operation:

```ts
await router.generateText({
  prompt: 'Answer briefly.',
  attemptTimeoutMs: 8_000,
  providerMaxRetries: 0,
  abortSignal: AbortSignal.timeout(20_000),
});
```

- `attemptTimeoutMs` bounds one target before fallback.
- `providerMaxRetries` controls AI SDK retries inside that target. It defaults to `0` in this package.
- `abortSignal` cancels the complete operation and stops fallback.
- There is no attempt timeout unless you configure one.

With several targets, total latency can approach the sum of their attempt timeouts. See [Production Guidance](https://github.com/yadimon/prio-llm-router/blob/main/docs/production.md) for timeout and retry recommendations.

## Streaming

Streaming fallback is allowed only before the first text chunk. After a chunk is selected, the router never switches models mid-answer.

```ts
const stream = await router.streamText({
  prompt: 'Explain first-chunk fallback.',
  chain: ['fast-first', 'quality-backup'],
  firstChunkTimeoutMs: 2_500,
});

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}

const final = await stream.final;
console.log(final.target.name, final.usage);
```

Consume `textStream` before awaiting `final`, or call `await stream.consumeStream()`. A stream can be consumed only once. Read [Streaming Semantics](https://github.com/yadimon/prio-llm-router/blob/main/docs/streaming.md) for the full contract.

## Structured Output And Validation

The current public API routes text generation. It does not expose the AI SDK `output`/schema option or automatically retry schema-invalid output.

Validate after generation and decide explicitly whether a semantic failure should retry the same model or move to another target:

```ts
import { z } from 'zod';

const Answer = z.object({ summary: z.string(), tags: z.array(z.string()) });
const chain = ['fast-first', 'quality-backup'];

let parsed: z.infer<typeof Answer> | undefined;

for (const target of chain) {
  try {
    const result = await router.generateText({
      prompt: 'Return JSON with summary and tags.',
      chain: [target],
    });

    const candidate = Answer.safeParse(JSON.parse(result.text));
    if (candidate.success) {
      parsed = candidate.data;
      break;
    }
  } catch {
    // Provider errors and invalid JSON both advance this app-level chain.
  }
}

if (!parsed) throw new Error('No model returned valid structured output.');
```

The compact example handles provider errors and invalid JSON alike. In production, record those cases separately so availability failures and schema failures remain distinguishable.

## Messages And Provider Options

Use either `prompt` or AI SDK `ModelMessage[]`:

```ts
await router.generateText({
  system: 'Be concise.',
  messages: [{ role: 'user', content: 'Explain deterministic fallback.' }],
  temperature: 0.2,
  maxOutputTokens: 300,
});
```

Multimodal message parts can pass through when the selected AI SDK provider and model support them. The package has no dedicated image, audio, embedding, tool-calling, or object-generation methods.

Provider-specific AI SDK options pass through unchanged:

```ts
await router.generateText({
  prompt: 'Answer briefly.',
  chain: ['google-flash'],
  providerOptions: {
    google: {
      thinkingConfig: { thinkingBudget: 0 },
    },
  },
});
```

Check the matching AI SDK provider documentation for accepted option keys.

## Errors And Observability

```ts
import {
  AllModelsFailedError,
  createLlmRouter,
} from '@yadimon/prio-llm-router';

const router = createLlmRouter({
  providers,
  models,
  hooks: {
    onAttemptFailure(attempt) {
      telemetry.record('llm.attempt.failed', attempt);
    },
  },
});

try {
  await router.generateText({ prompt: 'Hello' });
} catch (error) {
  if (error instanceof AllModelsFailedError) {
    console.error(error.attempts);
  }
  throw error;
}
```

Every result includes the selected `target`, ordered `attempts`, `finishReason`, optional normalized `usage`, optional `warnings`, and the raw AI SDK result. `debug: true` mirrors attempt events to the console; hooks remain active.

## Supported Providers

- `anthropic`
- `cohere`
- `deepseek`
- `google`
- `groq`
- `mistral`
- `openai`
- `openrouter`
- `perplexity`
- `togetherai`
- `xai`
- `vercel` (Vercel AI Gateway)
- `openai-compatible` (local runtimes, proxies, and custom gateways)

`openai-compatible` requires `baseURL` and may use an empty API key for a local backend that does not require authentication. See [Local Providers](https://github.com/yadimon/prio-llm-router/blob/main/docs/local-providers.md).

## Documentation And Examples

- [Configuration](https://github.com/yadimon/prio-llm-router/blob/main/docs/configuration.md) — all provider, model, source, timeout, and prefix fields
- [Production Guidance](https://github.com/yadimon/prio-llm-router/blob/main/docs/production.md) — retries, latency, cost, validation, and telemetry
- [Troubleshooting](https://github.com/yadimon/prio-llm-router/blob/main/docs/troubleshooting.md) — common routing and streaming surprises
- [Streaming Semantics](https://github.com/yadimon/prio-llm-router/blob/main/docs/streaming.md) — first-chunk selection and failure behavior
- [Local Providers](https://github.com/yadimon/prio-llm-router/blob/main/docs/local-providers.md) — LM Studio and OpenAI-compatible endpoints
- [Current Free Possibilities](https://github.com/yadimon/prio-llm-router/blob/main/docs/current-free-possibilities.md) — what strict free mode can and cannot guarantee
- [Examples](https://github.com/yadimon/prio-llm-router/tree/main/examples) — runnable TypeScript examples
- [Architecture](https://github.com/yadimon/prio-llm-router/blob/main/docs/architecture.md) — internal boundaries and extension points

## Public API

Main methods:

- `router.generateText(request)`
- `router.streamText(request)`
- `router.listProviders()`
- `router.listModels()`

Main exports:

- `createLlmRouter`, `PrioLlmRouter`
- `createLlmConnection`, `createLlmSource`
- `createOpenRouterConnection`, `createOpenRouterFreeSource`
- `createOpenAICompatibleConnection`
- `AllModelsFailedError`, `AttemptTimeoutError`, `RouterConfigurationError`
- `createDefaultTextGenerationExecutor`

## Development

```bash
npm install
npm run check
```

For a packed-artifact smoke test against credentials in `scripts/e2e/.env`:

```bash
npm run test:e2e:real
```

Repository examples import from `../src/index.js` for local development. In your application, import from `@yadimon/prio-llm-router`.
