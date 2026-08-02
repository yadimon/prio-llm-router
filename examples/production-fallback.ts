import {
  AllModelsFailedError,
  createLlmRouter,
} from '../src/index.js';

const openRouterApiKey = process.env.OPENROUTER_API_KEY;
const openAiApiKey = process.env.OPENAI_API_KEY;

if (!openRouterApiKey || !openAiApiKey) {
  throw new Error(
    'Set OPENROUTER_API_KEY and OPENAI_API_KEY before running this example.',
  );
}

const router = createLlmRouter({
  providers: [
    {
      name: 'openrouter',
      type: 'openrouter',
      auth: { mode: 'single', apiKey: openRouterApiKey },
      appName: 'prio-llm-router-example',
      appUrl: 'https://example.com/prio-llm-router',
    },
    {
      name: 'openai',
      type: 'openai',
      auth: { mode: 'single', apiKey: openAiApiKey },
    },
  ],
  models: [
    {
      name: 'free-first',
      provider: 'openrouter',
      model: 'openrouter/free',
      priority: 10,
      tier: 'free',
    },
    // Reaching this target sends a billable request to the OpenAI account.
    {
      name: 'paid-backup',
      provider: 'openai',
      model: 'gpt-4.1-mini',
      priority: 100,
      tier: 'paid',
    },
  ],
  defaultAttemptTimeoutMs: 12_000,
  defaultProviderMaxRetries: 0,
  hooks: {
    onAttemptFailure(attempt) {
      console.warn(
        `failed ${attempt.targetName} after ${attempt.durationMs}ms: ${attempt.error?.message ?? 'unknown error'}`,
      );
    },
  },
});

try {
  const result = await router.generateText({
    prompt: 'Describe this fallback policy in one sentence.',
    abortSignal: AbortSignal.timeout(25_000),
  });

  console.log('selected target:', result.target.name);
  console.log('attempts:', result.attempts);
  console.log(result.text);
} catch (error) {
  if (error instanceof AllModelsFailedError) {
    console.error('Every target failed:', error.attempts);
  }

  throw error;
}
