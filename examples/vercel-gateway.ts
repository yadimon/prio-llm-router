import { createLlmRouter } from '../src/index.js';

const gatewayApiKey = process.env.AI_GATEWAY_API_KEY;

if (!gatewayApiKey) {
  throw new Error('Set AI_GATEWAY_API_KEY before running this example.');
}

const router = createLlmRouter({
  providers: [
    {
      name: 'vercel-main',
      type: 'vercel',
      auth: {
        mode: 'single',
        apiKey: gatewayApiKey,
      },
    },
  ],
  models: [
    {
      name: 'vercel-gpt-oss',
      provider: 'vercel-main',
      model: 'openai/gpt-oss-20b',
      priority: 10,
    },
  ],
});

const result = await router.generateText({
  prompt: 'Return one sentence describing this Vercel AI Gateway setup.',
});

console.log(result.text);
