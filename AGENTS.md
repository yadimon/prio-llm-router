# AGENTS

This file describes repository-specific working rules for coding agents and contributors.

## Project Scope

`@yadimon/prio-llm-router` is a small public TypeScript library for routing text generation requests through a priority-ordered chain of LLM targets across multiple providers.

The project priorities are:

- keep the public API small
- keep fallback behavior explicit and deterministic
- prefer stable provider SDK reuse over custom HTTP implementations
- keep the codebase publish-ready at all times

## Technical Baseline

- Language: TypeScript
- Runtime target: Node.js `>=18.18`
- Build: `tsup`
- Tests: `vitest`
- Lint: `eslint`
- Packaging checks: `npm pack --dry-run` and `publint`

## Core Design Rules

- Providers and model targets must stay separate concepts.
- A model target always references a provider by configured name.
- Routing behavior must remain easy to reason about from configuration alone.
- Do not introduce hidden fallback heuristics.
- Prefer explicit configuration over smart auto-discovery.

## Streaming Rules

Streaming behavior is intentionally strict:

- Fallback may happen only before the first text chunk is emitted.
- After the first emitted text chunk, the selected model is final.
- If a started stream fails, surface the error and do not silently switch to another model.

Do not weaken these rules unless the public contract is intentionally redesigned.

## Documentation Rules

- Keep all user-facing documentation in English.
- Update `README.md` when public API or setup changes.
- Add or update focused documents under `docs/` when behavior is non-trivial.
- Add or update runnable examples under `examples/` for new public features.

## Editing Rules

- Prefer minimal code with strong types over clever abstractions.
- Reuse provider SDKs already in the dependency graph where possible.
- Keep public types explicit and stable.
- Avoid unnecessary dependencies.
- Do not add framework-heavy infrastructure for simple library concerns.

## Quality Gates

Run this before finishing substantial work:

```bash
npm run check
```

This includes:

- lint
- typecheck
- tests
- build
- package validation

## Publishing Expectations

The repository should remain ready for public npm publishing:

- package metadata should stay accurate
- exports and type declarations should remain valid for ESM and CJS consumers
- GitHub Actions should keep working
- documentation should match the actual public API

## Examples

Repository examples import from `../src/index.js` so they work during local development. External users should import from `@yadimon/prio-llm-router`.
