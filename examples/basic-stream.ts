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
});

const stream = await router.streamText({
  prompt: 'Write a concise explanation of first-chunk fallback for chat UIs.',
  chain: ['trinity-free', 'groq-oss', 'gpt-4.1-mini'],
  firstChunkTimeoutMs: 2500,
});

console.log('selected target:', stream.target.name);

for await (const chunk of stream.textStream) {
  process.stdout.write(chunk);
}

process.stdout.write('\n');

const final = await stream.final;
console.log('finish reason:', final.finishReason);
console.log('attempt count:', final.attempts.length);
