# Streaming Semantics

This document describes the exact fallback behavior for `router.streamText(...)`.

## Why Streaming Needs Different Rules

Non-streaming fallback is easy: a request either finishes or fails before anything is returned to the caller.

Streaming is different. Once text is already being shown to the user, silently switching to another model can create:

- mixed output
- broken tone or reasoning continuity
- duplicated or contradictory text
- hard-to-debug chat behavior

Because of that, `prio-llm-router` uses a strict streaming contract.

## Rule 1: Fallback Is Allowed Only Before The First Text Chunk

If the selected target does not emit its first text chunk quickly enough, the router can move to the next target.

Use `firstChunkTimeoutMs` to define that threshold:

```ts
const stream = await router.streamText({
  prompt: 'Explain routing.',
  chain: ['trinity-free', 'groq-oss', 'gpt-4.1-paid'],
  firstChunkTimeoutMs: 2500,
});
```

If the first target produces nothing within `2500ms`, the router aborts that attempt and tries the next target.

## Rule 2: The First Emitted Chunk Locks The Model In

As soon as the first text chunk is emitted to the caller:

- that model becomes the selected model
- no more fallback attempts are allowed for that request

This is a deliberate consistency guarantee.

## Rule 3: Errors After Streaming Starts Are Surfaced Directly

If the selected stream later fails:

- the stream rejects
- `stream.final` rejects
- no next model is tried

This is the correct tradeoff for chat-like UX where partial output was already visible.

## Returned Values

`streamText(...)` returns:

- `target`: the selected target after first-chunk selection
- `selectedAttempt`: the attempt metadata for the chosen target
- `attempts`: failures that happened before the stream was selected
- `textStream`: the async iterable stream of text chunks
- `final`: a promise for the aggregated final result
- `consumeStream()`: helper that drains the stream and returns the final result

## Recommended Timeout Strategy

Choose `firstChunkTimeoutMs` based on your UX:

- `1000-2000ms` for aggressive chat responsiveness
- `2000-4000ms` for balanced behavior
- omit it entirely if you prefer to wait for the first selected model

Shorter timeouts improve responsiveness but may switch away from slower models more often.

## Practical Recommendation

Use streaming when:

- the response is shown directly to a person
- perceived responsiveness matters
- fallback-before-start behavior is useful

Prefer non-streaming when:

- you need full results only
- you are doing automation or background processing
- you want the simplest possible operational behavior
