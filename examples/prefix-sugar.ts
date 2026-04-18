import { createLlmRouter } from '../src/index.js';

const openRouterApiKey = process.env.OPENROUTER_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;

if (!openRouterApiKey || !groqApiKey) {
  throw new Error(
    'Set OPENROUTER_API_KEY and GROQ_API_KEY before running this example.',
  );
}

const router = createLlmRouter({
  providers: [
    {
      name: 'openrouter-main',
      prefix: 'or',
      type: 'openrouter',
      auth: {
        mode: 'single',
        apiKey: openRouterApiKey,
      },
      appName: 'prio-llm-router-prefix-example',
      appUrl: 'https://example.com/prio-llm-router',
    },
    {
      name: 'groq-main',
      prefix: 'gq',
      type: 'groq',
      auth: {
        mode: 'single',
        apiKey: groqApiKey,
      },
    },
  ],
  models: [
    {
      name: 'gemma-free',
      model: 'or:google/gemma-4-31b-it:free',
      priority: 10,
      tier: 'free',
    },
    {
      name: 'llama-fast',
      model: 'gq:llama-3.3-70b-versatile',
      priority: 20,
      tier: 'paid',
    },
  ],
});

const result = await router.generateText({
  prompt: 'Explain provider-prefix model sugar in two short bullets.',
  chain: ['or:google/gemma-4-31b-it:free', 'llama-fast'],
});

console.log('selected target:', result.target.name);
console.log('provider:', result.target.providerName);
console.log('model:', result.target.model);
console.log(result.text);
