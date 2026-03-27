# Architecture

This document explains how `prio-llm-router` is structured and why the package intentionally keeps its scope narrow.

## Design Goal

The library is not a generic orchestration platform. It solves one problem:

- choose a model target from a configured priority chain
- try it
- if it fails before success, move to the next target
- stop as soon as one target succeeds

That is the entire product boundary.

## Main Concepts

### Providers

Providers are named credentials and transport settings.

Examples:

- `openrouter-main`
- `groq-main`
- `openai-primary`

Providers hold:

- provider type
- API key
- optional base URL
- optional headers
- provider-specific configuration

### Model Targets

Model targets are named routing destinations.

Examples:

- `trinity-free`
- `groq-oss`
- `gpt-4.1-paid`

Model targets hold:

- provider reference
- raw provider model id
- optional priority
- optional tier
- optional metadata

Applications should route through target names, not through raw model ids.

## Layering

The package has two primary runtime layers.

### Router Layer

Implemented in [src/prio-llm-router.ts](../src/prio-llm-router.ts).

Responsibilities:

- validate configuration
- resolve the execution chain
- record attempts
- handle fallback
- expose stable library-facing results

### Provider Execution Layer

Implemented in [src/provider-factory.ts](../src/provider-factory.ts).

Responsibilities:

- build provider SDK instances
- map provider config to AI SDK provider constructors
- execute `generateText` and `streamText`
- normalize usage and warning output

This split keeps provider integration concerns out of the routing policy.

## Why This Split Matters

Without this split, routing code tends to become coupled to provider-specific request logic.

That causes:

- harder testing
- harder future provider additions
- less stable public API
- more hidden behavior

By separating them:

- routing can be tested with fake executors
- provider SDK details stay isolated
- future key-pool logic can evolve behind the provider layer

## Fallback Semantics

### Non-Streaming

For `generateText`, fallback is simple:

- try target A
- if A fails, record the failure
- try target B
- continue until success or exhaustion

### Streaming

For `streamText`, fallback is intentionally stricter:

- fallback is allowed only before the first text chunk
- once the first chunk is emitted, the model is locked in
- later stream errors are surfaced directly

This prevents one response from being stitched together from multiple models.

## Future Extension Point

The config model is already shaped for future provider key strategies.

Today:

- provider auth mode is `single`

Future possibilities:

- key rotation
- per-provider key priority
- temporary key disablement
- cooldown behavior after provider-specific rate limits

These can be added behind the provider config and executor layers without changing how model targets are referenced.
