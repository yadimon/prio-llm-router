import {
  createLlmConnection,
  createLlmRouter,
  createLlmSource,
} from '../src/index.js';

const openRouterApiKey = process.env.OPENROUTER_API_KEY;
const openAiApiKey = process.env.OPENAI_API_KEY;

if (!openRouterApiKey || !openAiApiKey) {
  throw new Error(
    'Set OPENROUTER_API_KEY and OPENAI_API_KEY before running this example.',
  );
}

const openRouterConnection = createLlmConnection({
  name: 'openrouter-main',
  type: 'openrouter',
  auth: {
    mode: 'single',
    apiKey: openRouterApiKey,
  },
  appName: 'prio-llm-router-example',
  appUrl: 'https://example.com/prio-llm-router',
});

const openAiConnection = createLlmConnection({
  name: 'openai-main',
  type: 'openai',
  auth: {
    mode: 'single',
    apiKey: openAiApiKey,
  },
});

const router = createLlmRouter({
  sources: [
    createLlmSource(openRouterConnection, {
      name: 'openrouter-free',
      model: 'moonshotai/kimi-k2:free',
      access: 'free',
      priority: 10,
    }),
    createLlmSource(openAiConnection, {
      name: 'openai-paid-fallback',
      model: 'gpt-4.1-mini',
      priority: 100,
      tier: 'paid',
    }),
  ],
});

const result = await router.generateText({
  prompt: 'Explain in two short bullets why a free-first priority router is useful.',
});

console.log('selected target:', result.target.name);
console.log(result.text);
