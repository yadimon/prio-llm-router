# Troubleshooting

## Every Target Failed

Catch `AllModelsFailedError` and inspect its ordered `attempts` array:

```ts
try {
  await router.generateText({ prompt: 'Hello' });
} catch (error) {
  if (error instanceof AllModelsFailedError) {
    console.error(error.attempts);
    console.error('last cause:', error.cause);
  }
}
```

Each failed attempt includes target, provider, model, duration, and a serialized error with name/message and, when available, code or HTTP status.

Common causes are an invalid API key, an unavailable model ID, quota exhaustion, unsupported request parameters, or a wrong `baseURL`.

## The Router Did Not Fall Back From Bad JSON

Fallback reacts to execution errors, not output semantics. A provider call that returns malformed JSON still completed successfully from the router's perspective.

Validate the text in your application. If invalid output should select another model, call each target with `chain: [target]`, validate, and continue explicitly. See [Production Guidance](./production.md#validate-semantic-output-in-the-application).

## The Chain Is Much Slower Than Expected

Check all three latency layers:

1. AI SDK retries inside each target (`providerMaxRetries`).
2. The per-target router timeout (`attemptTimeoutMs`).
3. The number of targets before the successful one.

This package defaults provider retries to `0`, but has no default attempt timeout. Configure both deliberately and use an overall `abortSignal` deadline when needed.

## A Caller Abort Still Tried Another Target

Pass the caller's signal as `abortSignal` and make sure the provider adapter surfaces cancellation as an abort error. Parent aborts are rethrown instead of being converted into fallback attempts.

Do not use a short caller abort signal as a per-target timeout. Use `attemptTimeoutMs` for fallback and reserve `abortSignal` for cancelling the whole operation.

## A Stream Never Reaches `final`

`stream.final` resolves after the text stream finishes. Consume `stream.textStream` first, or call `await stream.consumeStream()` to drain it. Do not await `final` before consuming the stream.

The stream is single-use. A second consumer throws `RouterConfigurationError` with `This stream can only be consumed once.`

## A Stream Switched Models Too Quickly

Increase or omit `firstChunkTimeoutMs`. A shorter value favors responsiveness but moves away from slow-starting models more often.

`attemptTimeoutMs` is used as the streaming first-chunk timeout when `firstChunkTimeoutMs` is absent. The router never switches after the first text chunk has been emitted.

## `providerOptions` Had No Effect

The router forwards `providerOptions` unchanged. Verify:

- the outer key matches the AI SDK provider's namespace
- the installed provider version supports the option
- every fallback target that may receive the request supports or safely ignores it

Provider-specific options can make a cross-provider chain invalid. Use separate request chains when providers need incompatible controls.

## A Free Target Was Billed

`tier: 'free'` is metadata only. It does not enforce provider billing.

Use `createOpenRouterFreeSource` for the package's narrow config-time guard, and use only explicit `:free` model IDs or `openrouter/free`. For other providers, verify the account plan, quota, and current terms directly.

## A Local OpenAI-Compatible Server Returns 401

For `openai-compatible`, an empty API key tells the adapter not to send an `Authorization` header. Some local gateways instead require any non-empty placeholder key.

Check the server's expected behavior and set:

```ts
auth: { mode: 'single', apiKey: 'local-placeholder' }
```

Also confirm that `baseURL` includes the server's OpenAI-compatible prefix, commonly `/v1`, and that `model` exactly matches a model ID exposed by the server.

## A Target Is Missing Or Disabled

An explicit `chain` must resolve to configured, enabled targets or to a configured provider prefix. Unknown and disabled targets raise `RouterConfigurationError`; they are not silently skipped.

The implicit priority chain does skip disabled targets and targets whose provider has `enabled: false`.

## Duplicate Targets Were Tried Only Once

The router de-duplicates exact strings in an explicit chain. Repeating a target name does not create retries. Use `providerMaxRetries` for same-target transport retries, or implement an application-level retry policy when it needs delays or semantic validation.
