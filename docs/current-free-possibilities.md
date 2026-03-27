# Current Free Possibilities For LLM API Access

This document summarizes currently verifiable free or partly free API access and classifies what `prio-llm-router` can enforce in strict `free` mode.

This distinction matters:

- some providers have free usage, but only at the account or project level
- some providers expose explicit free model identifiers
- strict `free` mode must only exist where the package can prevent paid usage from the request shape alone

Current snapshot date:

- 2026-03-30

## Strict Free Support Matrix

`free` means:

- the source is explicitly marked `access: 'free'`
- the package must be able to reject non-free models at config time
- the package must not rely on hidden account state, plan tier, or billing setup

Current matrix for built-in providers:

| Provider type | Current free path | Strict `free` support | Notes |
| --- | --- | --- | --- |
| `openrouter` | explicit `:free` model ids | yes | only explicit `:free` models are accepted in strict `free` mode |
| `google` | Gemini API free tier | no, manual only | free depends on project billing state |
| `groq` | account Free plan | no, manual only | free depends on account plan |
| `mistral` | Experiment plan | no, manual only | free depends on workspace plan |
| `cohere` | trial / evaluation keys | no, manual only | free depends on key/account type |
| `openai` | no public general free tier | no | paid-only in practice |
| `anthropic` | no public general free tier | no | paid-only in practice |
| `deepseek` | balance-based access | no | no deterministic free-only request path |
| `perplexity` | no public general free tier found | no | no deterministic free-only request path |
| `xai` | credit / billing controls | no | no deterministic free-only request path |
| `togetherai` | minimum credit purchase | no | explicitly paid entry |
| `openai-compatible` | backend dependent | no | generic adapter cannot infer billing semantics |

## Guaranteed-Free Today

### OpenRouter

Status:

- supported by strict `free` mode
- enforced by explicit model ids that end in `:free`

Why it qualifies:

- the free-safe path is part of the model identifier itself
- the package can reject non-free variants before sending any request

Strict `free` rules in this package:

- provider type must be `openrouter`
- model id must end with `:free`
- `openrouter/free` is not accepted in strict `free` mode because it is provider-side routing, not an explicit deterministic model target

Relevant sources:

- https://openrouter.ai/docs/guides/routing/model-variants/free
- https://openrouter.ai/pricing

Recommended setup:

```ts
const openRouter = createLlmConnection({
  name: 'openrouter-main',
  type: 'openrouter',
  auth: { mode: 'single', apiKey: process.env.OPENROUTER_API_KEY! },
});

const router = createLlmRouter({
  sources: [
    createLlmSource(openRouter, {
      name: 'kimi-free',
      model: 'moonshotai/kimi-k2:free',
      access: 'free',
      priority: 10,
    }),
  ],
});
```

## Manual-Free-Only Providers

These providers may be usable for free, but the package cannot prove that from the API key or request shape alone. Therefore `access: 'free'` is rejected for them.

### Google Gemini API

Why manual only:

- Gemini API has a documented free tier
- but the same API/project can also become paid after billing is enabled
- the package cannot inspect that state safely from the key alone

What users must do manually:

- use a project that remains on Gemini free tier
- avoid relying on models or billing settings that move the project into paid usage

Sources:

- https://ai.google.dev/gemini-api/docs/billing/

### Groq

Why manual only:

- Groq free usage depends on the account being on Free plan
- the package cannot infer Free vs Developer from the key alone

What users must do manually:

- keep the account on Free plan
- choose models that are available within current free limits

Sources:

- https://console.groq.com/docs/rate-limits
- https://console.groq.com/docs/billing-faqs

### Mistral

Why manual only:

- Mistral documents an Experiment tier
- but free access depends on workspace and billing activation state

What users must do manually:

- keep the workspace on Experiment
- verify current API-key onboarding flow before depending on it

Sources:

- https://docs.mistral.ai/getting-started/quickstart

### Cohere

Why manual only:

- Cohere trial or evaluation keys can be free
- production keys are not
- the package cannot safely distinguish those key classes in a provider-agnostic way

What users must do manually:

- use trial or evaluation keys only
- do not switch the same setup to production keys and assume strict-free guarantees remain valid

Sources:

- https://docs.cohere.com/docs/rate-limits

## Not Free-Guarantee Candidates Today

These providers are useful in the router, but not candidates for strict `free` mode:

- `openai`
- `anthropic`
- `deepseek`
- `perplexity`
- `xai`
- `togetherai`
- `openai-compatible`

Reasons include:

- no public general free API tier
- billing based on credits or account balance rather than explicit free model ids
- generic backends whose billing semantics are unknowable from the adapter

Relevant sources:

- OpenAI: https://developers.openai.com/api/docs/pricing
- Anthropic: https://support.claude.com/en/articles/8977456-how-do-i-pay-for-my-claude-api-usage
- DeepSeek: https://api-docs.deepseek.com/quick_start/pricing/
- Perplexity: https://docs.perplexity.ai/docs/getting-started/pricing
- xAI: https://docs.x.ai/docs/key-information/billing
- Together AI: https://docs.together.ai/docs/billing-credits

## Practical Guidance

If the goal is “all requests must stay free,” the current safe rule is:

1. use strict `free` mode only with OpenRouter explicit `:free` models
2. treat all other providers as standard sources, even if their signup path may be free today
3. document manual provider setup separately from package-enforced guarantees

If the goal is “free first, paid later,” a practical mixed setup is:

1. strict-free OpenRouter source first
2. standard manual-free providers like Gemini or Groq after that
3. paid fallbacks at the end

That gives:

- one genuinely enforced free layer
- additional opportunistic free capacity where the user manages account settings
- deterministic routing without pretending that account-level free plans are provable from the key
