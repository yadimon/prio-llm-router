# Production Guidance

`prio-llm-router` keeps model selection deterministic, but production reliability still depends on how the application builds and observes each chain.

## Build Chains Around A Workload

Every target in a chain should be able to handle the request's input and expected response:

- use separate chains for fast chat, long extraction, vision input, or higher-quality generation
- verify context-window, modality, and provider-option support for every target
- keep a dependable final target if availability matters more than cost
- disable a target instead of leaving a known-broken route in the chain

A fallback chain is an availability policy, not a quality policy. The router advances when execution throws; it cannot know that valid text is factually wrong, off-topic, or malformed for your business schema.

## Bound Latency At Two Levels

`attemptTimeoutMs` limits one target. `abortSignal` can limit the whole request.

```ts
const result = await router.generateText({
  prompt,
  attemptTimeoutMs: 8_000,
  providerMaxRetries: 0,
  abortSignal: AbortSignal.timeout(20_000),
});
```

Without an attempt timeout, a slow target can block the chain indefinitely. With three `10s` attempts, the fallback portion alone can take roughly `30s` before the final error, plus application and transport overhead.

The package sets AI SDK provider retries to `0` by default. Raising `providerMaxRetries` retries inside one target before the router moves to the next target. Avoid combining many provider retries with long chains unless the resulting worst-case latency is intentional.

For streaming, `firstChunkTimeoutMs` controls selection latency. Once the first text chunk arrives, the target is locked in and a later error is surfaced.

## Treat Caller Abort Differently From Provider Failure

A caller abort stops the full operation and does not advance to the next model. This prevents work from continuing after a user disconnects or an upstream request deadline expires.

Pass the request's abort signal through from your HTTP framework when possible. Use a separate application-level timeout if you need a hard deadline across the complete chain.

## Validate Semantic Output In The Application

The router does not currently expose structured-output schemas or automatically fall back on invalid JSON.

For schema-sensitive work, call one target at a time and validate between targets:

```ts
for (const target of ['extract-fast', 'extract-reliable']) {
  try {
    const result = await router.generateText({ prompt, chain: [target] });
    const parsed = parseAndValidate(result.text);
    return { parsed, result };
  } catch (error) {
    recordTargetFailure(target, error);
  }
}

throw new Error('No target produced a valid result.');
```

Decide whether validation failures should try the next target, retry the same target with a stricter prompt, or fail immediately. Keep that product-specific policy outside the generic availability router.

## Observe Every Attempt

Use hooks for attempt-level metrics and the result for final selection and usage:

```ts
const router = createLlmRouter({
  providers,
  models,
  hooks: {
    onAttemptStart: (attempt) => metrics.attemptStarted(attempt),
    onAttemptFailure: (attempt) => metrics.attemptFailed(attempt),
    onAttemptSuccess: (attempt) => metrics.attemptSucceeded(attempt),
  },
});
```

Useful dimensions include target, provider, model, duration, serialized error name/status, and whether the selected target was free or paid.

`result.usage` describes the successful provider result when the adapter reports usage. It is not complete billing telemetry for failed attempts: an upstream may process tokens before returning an error, and an error may not carry usage data. Use provider billing exports for authoritative cost accounting.

`debug: true` is convenient locally, but structured hooks are a better production interface.

## Understand Free And Paid Labels

`tier` is metadata. It does not query account plans or billing state.

Only the strict OpenRouter source builder rejects obviously non-free model IDs at configuration time. Even then, provider catalogs, limits, availability, and terms remain external. Re-check them before relying on a route in production.

Place a paid fallback last only when the application is allowed to spend. If a hard no-spend policy is required, omit paid targets instead of trusting metadata.

## Add Application-Level Resilience Deliberately

This package does not provide:

- provider health scoring or automatic reordering
- circuit breakers for repeatedly exhausted quotas
- API-key pools or weighted load balancing
- response caching
- token or currency budgets
- schema guardrails or content moderation

Add these in the application when needed, or use a full gateway. For example, an app can disable a provider for the rest of a job after repeated quota errors, cache unchanged extraction inputs, and enforce a daily budget before calling the router.

## Local And Internal Gateways

Use `openai-compatible` for LM Studio, Ollama-compatible endpoints, vLLM, or an internal OpenAI-style bridge:

```ts
{
  name: 'local-gateway',
  type: 'openai-compatible',
  providerLabel: 'local-gateway',
  baseURL: 'http://127.0.0.1:3010/v1',
  auth: { mode: 'single', apiKey: '' },
}
```

An empty key suppresses the `Authorization` header for this provider type. Protect non-loopback internal endpoints at the network or gateway layer; the router does not add access control.

## Deployment Checklist

- Test each target directly before testing the full chain.
- Confirm every target supports the request's modality and parameters.
- Set an attempt timeout and a whole-request deadline.
- Choose provider retries intentionally.
- Validate structured or business-critical output outside the router.
- Record attempt failures and final target selection.
- Alert on paid-fallback frequency and `AllModelsFailedError` rate.
- Verify current provider pricing, free-tier terms, and model IDs.
- Avoid logging prompts or responses unless your privacy policy allows it.
