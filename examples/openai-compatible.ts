import {
  createLlmRouter,
  createOpenAICompatibleConnection,
} from '../src/index.js';

const proxyApiKey = process.env.MY_PROXY_API_KEY;

if (!proxyApiKey) {
  throw new Error('Set MY_PROXY_API_KEY before running this example.');
}

const connection = createOpenAICompatibleConnection({
  name: 'proxy-main',
  baseURL: 'https://your-proxy.example.com/v1',
  providerLabel: 'my-proxy',
  auth: {
    mode: 'single',
    apiKey: proxyApiKey,
  },
  headers: {
    'x-app-id': 'prio-llm-router-example',
  },
});

const router = createLlmRouter({
  providers: [connection.provider],
  models: [
    {
      name: 'proxy-model',
      provider: 'proxy-main',
      model: 'your-model-id',
      priority: 10,
    },
  ],
});

const result = await router.generateText({
  prompt: 'Return one sentence describing this deployment setup.',
});

console.log(result.text);
