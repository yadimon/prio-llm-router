import {
  createLlmRouter,
  createOpenAICompatibleConnection,
} from '../src/index.js';

// Start LM Studio's local server and enable its OpenAI-compatible API first.
const connection = createOpenAICompatibleConnection({
  name: 'lm-studio-local',
  baseURL: 'http://127.0.0.1:1234/v1',
  providerLabel: 'lm-studio',
  auth: {
    mode: 'single',
    apiKey: '',
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

const result = await router.generateText({
  prompt: 'Return one sentence describing this local LM Studio setup.',
});

console.log(result.text);
