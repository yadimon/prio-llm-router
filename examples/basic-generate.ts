import { createLlmRouter } from '../src/index.js';

const openRouterApiKey = process.env.OPENROUTER_API_KEY;
const groqApiKey = process.env.GROQ_API_KEY;
const openAiApiKey = process.env.OPENAI_API_KEY;

if (!openRouterApiKey || !groqApiKey || !openAiApiKey) {
  throw new Error(
    'Set OPENROUTER_API_KEY, GROQ_API_KEY, and OPENAI_API_KEY before running this example.',
  );
}

const router = createLlmRouter({
  providers: [
    {
      name: 'openrouter-main',
      type: 'openrouter',
      auth: {
        mode: 'single',
        apiKey: openRouterApiKey,
      },
      appName: 'prio-llm-router-example',
      appUrl: 'https://example.com/prio-llm-router',
    },
    {
      name: 'groq-main',
      type: 'groq',
      auth: {
        mode: 'single',
        apiKey: groqApiKey,
      },
    },
    {
      name: 'openai-main',
      type: 'openai',
      auth: {
        mode: 'single',
        apiKey: openAiApiKey,
      },
    },
  ],
  models: [
    {
      name: 'trinity-free',
      provider: 'openrouter-main',
      model: 'arcee-ai/trinity-large:free',
      priority: 10,
      tier: 'free',
    },
    {
      name: 'groq-oss',
      provider: 'groq-main',
      model: 'openai/gpt-oss-20b',
      priority: 20,
      tier: 'free',
    },
    {
      name: 'gpt-4.1-mini',
      provider: 'openai-main',
      model: 'gpt-4.1-mini',
      priority: 100,
      tier: 'paid',
    },
  ],
  hooks: {
    onAttemptStart(attempt) {
      console.log(
        `starting ${attempt.targetName} via ${attempt.providerName}/${attempt.model}`,
      );
    },
    onAttemptFailure(attempt) {
      console.log(
        `failed ${attempt.targetName}: ${attempt.error?.message ?? 'unknown error'}`,
      );
    },
    onAttemptSuccess(attempt) {
      console.log(`succeeded ${attempt.targetName} in ${attempt.durationMs}ms`);
    },
  },
});

const result = await router.generateText({
  prompt: 'Explain why priority-based LLM routing is useful in three short bullets.',
});

console.log('selected target:', result.target.name);
console.log(result.text);
