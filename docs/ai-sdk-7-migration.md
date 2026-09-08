# Coordinated AI SDK 7 migration

Tracking: https://github.com/yadimon/prio-llm-router/issues/79

The current release uses AI SDK 6 and supports Node >=18.18. Individual provider
majors cannot be merged into this graph: their LanguageModelV4 types do not match
the V2/V3 inputs accepted by the current router. OpenRouter now has AI SDK 7
support, so waiting for that provider alone no longer describes the blocker.

The migration must be one reviewed change with an intentional Node baseline and
release policy. Keep compatible SDK 6 updates flowing while that change is prepared.

1. Resolve the current stable AI SDK 7, every first-party provider and OpenRouter
   together. Record exact versions, engine requirements and peer ranges. Include
   `ai`, all `@ai-sdk/*` imports and `@openrouter/ai-sdk-provider`; do not use
   `--force`, `--legacy-peer-deps` or type casts to hide a mixed provider graph.
2. Confirm the intended Node floor (the SDK 7 graph requires Node 22) and document
   the removal of Node 18/20 support in engines, README, CI and release notes.
   A daily patch release is not the place to make that support change implicitly.
3. Follow the official migration guide and adapt LanguageModelV4 boundaries,
   provider construction and response/usage types. Preserve deterministic
   priorities and the rule that streaming fallback occurs only before output.
4. Extend existing mock-provider tests for V4 text, streaming, aborts, errors and
   usage. Exercise every registered provider constructor without making live
   provider requests; test mixed/incompatible input rejection explicitly.
5. Run `npm ci`, full `npm run check`, coverage, ESM and CJS packed-consumer imports
   and production/dev audits on the new minimum Node and a newer supported Node.
   Verify the exact PR head in CI before merging the coordinated change.
6. Use a deliberate breaking-change release for the 0.x package (minor rather
   than patch), record the support change, and verify exact-version npm smokes.
   Then remove the daily migration blocker and review Dependabot's major group.

Sources: https://ai-sdk.dev/docs/migration-guides/migration-guide-7-0 and the exact
npm manifests for the selected versions. Re-resolve versions when implementing;
this plan deliberately does not pin a future migration to today's latest patch.

## Temporary build-tool override

The repository overrides esbuild to ^0.28.2 because tsup 8.5.1 still selects the
affected ^0.27 line (GHSA-g7r4-m6w7-qqqr). This is a development build dependency,
not a runtime dependency of the published router. Full build, declaration,
ESM/CJS packaging and tests validate the override. Remove it when tsup's supported
range includes a patched esbuild. Do not generalize this override to SDK peers.
