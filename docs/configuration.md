# Configuration Guide

This guide explains both supported configuration styles:

- direct `providers` plus `models`
- source builders via `createLlmConnection(...)` and `createLlmSource(...)`
- typed convenience helpers for common setups such as `createOpenRouterConnection(...)`, `createOpenRouterFreeSource(...)`, and `createOpenAICompatibleConnection(...)`

## Provider Configuration

Each provider config must have:

- `name`
- `type`
- `auth`

Example:

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

## Provider Types

Supported provider types:

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
- `vercel`
- `openai-compatible`

These built-in presets cover API-key-based providers with first-class AI SDK adapters plus explicit Vercel AI Gateway and generic OpenAI-compatible endpoints.

## Shared Provider Fields

These fields are available on most provider configs:

- `name: string`
- `prefix?: string`
- `type: ProviderType`
- `auth: { mode: 'single'; apiKey: string }`
- `enabled?: boolean`
- `baseURL?: string`
- `headers?: Record<string, string>`

`prefix` is optional sugar for shorter model refs such as `or:google/gemma-4-31b-it:free`.

## OpenRouter Extras

OpenRouter supports:

- `appName?: string`
- `appUrl?: string`

These are mapped to:

- `X-Title`
- `HTTP-Referer`

## OpenAI-Compatible Extras

The `openai-compatible` type supports:

- `baseURL: string`
- `providerLabel?: string`
- `queryParams?: Record<string, string>`

Use this for proxies or OpenAI-style APIs that do not have a dedicated adapter.

Unlike the hosted SaaS providers, `openai-compatible` may use an empty API key for local or internal backends. When the key is empty, the router accepts the config and creates the provider adapter without an `Authorization` header.

## Vercel AI Gateway

The `vercel` type maps to the official Vercel AI Gateway adapter.

Use it when you want the router config to say explicitly that requests go through Vercel AI Gateway rather than a generic proxy.

Supported fields:

- `baseURL?: string`
- `headers?: Record<string, string>`

Example:

```ts
{
  name: 'vercel-main',
  type: 'vercel',
  auth: {
    mode: 'single',
    apiKey: process.env.AI_GATEWAY_API_KEY!,
  },
}
```

## Model Target Configuration

Each model target must have:

- `name`
- `model`

Example:

```ts
{
  name: 'trinity-free',
  provider: 'openrouter-main',
  model: 'arcee-ai/trinity-large:free',
  priority: 10,
  tier: 'free',
}
```

If the provider config declares `prefix: 'or'`, you can also use the sugar form:

```ts
{
  name: 'gemma-free',
  model: 'or:google/gemma-4-31b-it:free',
  priority: 10,
  tier: 'free',
}
```

## Model Fields

- `name: string`
- `provider?: string`
- `model: string`
- `enabled?: boolean`
- `priority?: number`
- `tier?: 'free' | 'paid'`
- `metadata?: Record<string, unknown>`

Use `provider` in the standard form. Omit it only when `model` starts with a configured provider prefix like `or:`.

## Source Builder Configuration

The source builder API is the preferred path when you want source-local access policy such as strict `free` mode.

Source definitions remain explicit: they do not use provider-prefix model sugar in `createLlmSource(...)`.

Create a reusable connection:

```ts
const openRouter = createOpenRouterConnection({
  name: 'openrouter-main',
  auth: {
    mode: 'single',
    apiKey: process.env.OPENROUTER_API_KEY!,
  },
});
```

Then create one or more sources from that connection:

```ts
const kimiFree = createOpenRouterFreeSource(openRouter, {
  name: 'kimi-free',
  model: 'moonshotai/kimi-k2:free',
  priority: 10,
});
```

Use them in the router:

```ts
const router = createLlmRouter({
  sources: [kimiFree],
});
```

### Source Fields

- `name: string`
- `model: string`
- `access?: 'standard' | 'free'`
- `enabled?: boolean`
- `priority?: number`
- `tier?: 'free' | 'paid'`
- `metadata?: Record<string, unknown>`

### Strict Free Mode

`access: 'free'` is intentionally strict.

It means:

- the package must be able to reject non-free usage at config time
- the package must not rely on account plan, billing state, or trial status

Current rule:

- only `openrouter` supports strict `free`
- the model must be an explicit `:free` model id
- `openrouter/free` is rejected in strict `free` mode

Examples:

```ts
createOpenRouterFreeSource(openRouter, {
  name: 'valid-free-source',
  model: 'moonshotai/kimi-k2:free',
});
```

```ts
createLlmSource(openRouter, {
  name: 'invalid-free-source',
  model: 'openrouter/free',
  access: 'free',
});
```

Providers such as `google`, `groq`, `mistral`, and `cohere` may still have real free signup paths, but those are account-level conditions, so the package rejects `access: 'free'` for them.

## Debug Mode

Set `debug: true` on the router when you want attempt-level console output during development.

```ts
const router = createLlmRouter({
  debug: true,
  providers,
  models,
});
```

This mode only mirrors the router hooks to the console:

- `attempt:start`
- `attempt:success`
- `attempt:failure`

If you also configure `hooks`, the router still calls them.

## Attempt Timeouts

You can configure timeouts at two levels:

- `defaultAttemptTimeoutMs` on the router
- `attemptTimeoutMs` on an individual request

Request-level timeout overrides the router default.

```ts
const router = createLlmRouter({
  defaultAttemptTimeoutMs: 12000,
  providers,
  models,
});
```

```ts
await router.generateText({
  prompt: 'Write a short answer.',
  attemptTimeoutMs: 8000,
});
```

If a model attempt times out:

- the attempt is recorded as failed
- `attempt.error.name` is `AttemptTimeoutError`
- `onAttemptFailure(...)` fires as usual
- the router continues with the next model

For `streamText(...)`, `attemptTimeoutMs` is used as the first-chunk timeout when `firstChunkTimeoutMs` is not set explicitly.

## Priority Resolution

If no explicit request chain is provided, the router resolves the execution order as follows:

1. Use `defaultChain` if configured.
2. Otherwise, collect all enabled model targets.
3. Sort them by ascending `priority`.
4. Use declaration order as the tiebreaker.

## Default Chains

Use `defaultChain` when you want explicit global ordering:

```ts
const router = createLlmRouter({
  providers,
  models,
  defaultChain: ['trinity-free', 'groq-oss', 'gpt-4.1-paid'],
});
```

This is often clearer than relying only on numeric priorities when you already know the exact desired sequence.

`defaultChain` also accepts prefixed model refs like `or:google/gemma-4-31b-it:free`. Exact configured target names still win before prefix fallback is attempted.

## Per-Request Chains

Use `chain` when different requests should use different priorities:

```ts
await router.generateText({
  prompt: 'Write a short answer.',
  chain: ['groq-oss', 'trinity-free'],
});
```

The `chain` values are model target names, not provider names.

If no exact target name matches, the router also checks for prefixed model refs using configured provider prefixes. For example, `or:google/gemma-4-31b-it:free` resolves through the provider whose config declares `prefix: 'or'`.

## Disabling Providers And Targets

You can disable a whole provider:

```ts
{
  name: 'openrouter-main',
  type: 'openrouter',
  enabled: false,
  auth: { mode: 'single', apiKey: '...' },
}
```

Or disable a single model target:

```ts
{
  name: 'trinity-free',
  provider: 'openrouter-main',
  model: 'arcee-ai/trinity-large:free',
  enabled: false,
}
```

Disabled providers make their model targets unavailable.
