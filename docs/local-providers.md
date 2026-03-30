# Local Providers

`@yadimon/prio-llm-router` does not add a separate provider type for LM Studio, Ollama, or other local runtimes.

Use `openai-compatible` for any local backend that exposes an OpenAI-style HTTP API.

That keeps the package small while still covering the common local setups:

- LM Studio with its OpenAI-compatible local server enabled
- Ollama through its OpenAI-compatible endpoint
- self-hosted gateways or proxies that expose `/v1` OpenAI-style routes

## Recommended Helper

If you want better autocomplete and less config noise, prefer:

```ts
import {
  createLlmRouter,
  createOpenAICompatibleConnection,
} from '@yadimon/prio-llm-router';
```

## LM Studio

Before using LM Studio, start its local server and enable the OpenAI-compatible API.

```ts
import {
  createLlmRouter,
  createOpenAICompatibleConnection,
} from '@yadimon/prio-llm-router';

const connection = createOpenAICompatibleConnection({
  name: 'lm-studio-local',
  baseURL: 'http://127.0.0.1:1234/v1',
  providerLabel: 'lm-studio',
  auth: {
    mode: 'single',
    apiKey: 'lm-studio',
  },
});

const router = createLlmRouter({
  providers: [connection.provider],
  models: [
    {
      name: 'local-qwen',
      provider: 'lm-studio-local',
      model: 'qwen2.5-7b-instruct',
      priority: 10,
    },
  ],
});
```

Notes:

- use a dummy non-empty API key if the local runtime ignores auth
- the `model` value must match the model name exposed by the local runtime
- `providerLabel` is optional but helps make logs and config easier to read

## Ollama

Ollama can be wired the same way if you expose an OpenAI-compatible endpoint:

```ts
import {
  createLlmRouter,
  createOpenAICompatibleConnection,
} from '@yadimon/prio-llm-router';

const connection = createOpenAICompatibleConnection({
  name: 'ollama-local',
  baseURL: 'http://127.0.0.1:11434/v1',
  providerLabel: 'ollama',
  auth: {
    mode: 'single',
    apiKey: 'ollama',
  },
});

const router = createLlmRouter({
  providers: [connection.provider],
  models: [
    {
      name: 'local-llama',
      provider: 'ollama-local',
      model: 'llama3.2',
      priority: 10,
    },
  ],
});
```

## Why There Is No Dedicated `lm-studio` Provider Type

The package keeps provider types narrow and stable.

A dedicated `lm-studio` type would mostly duplicate `openai-compatible` while adding another public concept to maintain.

If a local runtime speaks the OpenAI-compatible protocol cleanly, `openai-compatible` is the intended integration path.
