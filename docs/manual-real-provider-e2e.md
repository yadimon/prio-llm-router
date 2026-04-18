# Manual Real-Provider E2E

This repository includes a local-only E2E runner for validating the packed npm artifact against real provider APIs.

It is intentionally separate from `npm test` and GitHub Actions:

- it requires real API keys
- it performs live network calls
- it verifies the packed tarball, not the in-repo source import path

## What It Does

`npm run test:e2e:real` performs these steps:

1. loads environment variables from `scripts/e2e/.env` if present
2. runs `npm pack`
3. creates a temporary throwaway project
4. installs the packed tarball into that temp project
5. imports `@yadimon/prio-llm-router` from the installed package
6. sends one real request each to Groq, OpenRouter, and Vercel AI Gateway
7. verifies:
   - response text matches the expected token
   - `result.usage.totalTokens` is present
   - the attempt metadata shows one successful attempt

## Required `.env` Keys

Copy [`scripts/e2e/.env.example`](../scripts/e2e/.env.example) to `scripts/e2e/.env` and fill in:

```dotenv
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
AI_GATEWAY_API_KEY=...
```

`scripts/e2e/.env` is ignored by Git and must not be committed.

## Optional Model Overrides

The runner uses these defaults:

- `E2E_GROQ_MODEL=openai/gpt-oss-20b`
- `E2E_OPENROUTER_MODEL=openai/gpt-4.1-nano`
- `E2E_VERCEL_MODEL=openai/gpt-5-nano`

Override them in `scripts/e2e/.env` when your account should use different real models:

```dotenv
E2E_GROQ_MODEL=openai/gpt-oss-120b
E2E_OPENROUTER_MODEL=openai/gpt-4.1-mini
E2E_VERCEL_MODEL=openai/gpt-5-nano
```

## Optional Provider Selection

By default the runner checks all three providers:

```dotenv
E2E_REAL_PROVIDERS=groq,openrouter,vercel
```

You can narrow the run:

```dotenv
E2E_REAL_PROVIDERS=vercel
```

## Temporary Artifacts

The runner removes its temp directory and generated tarball by default.

If you want to inspect the temporary installation, run with:

```dotenv
E2E_KEEP_ARTIFACTS=1
```

## Usage

```bash
npm run test:e2e:real
```

This runner is meant for manual local verification before release work or after transport-level changes.
