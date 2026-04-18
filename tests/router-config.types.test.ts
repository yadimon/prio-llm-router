import { describe, expect, it } from 'vitest';

import { createLlmRouter } from '../src/index.js';

const explicitRouter = createLlmRouter({
  providers: [
    {
      name: 'openrouter-main',
      prefix: 'or',
      type: 'openrouter',
      auth: { mode: 'single', apiKey: 'openrouter-key' },
    },
  ],
  models: [
    {
      name: 'explicit-target',
      provider: 'openrouter-main',
      model: 'moonshotai/kimi-k2:free',
    },
  ],
});

const prefixedRouter = createLlmRouter({
  providers: [
    {
      name: 'openrouter-main',
      prefix: 'or',
      type: 'openrouter',
      auth: { mode: 'single', apiKey: 'openrouter-key' },
    },
  ],
  models: [
    {
      name: 'prefixed-target',
      model: 'or:google/gemma-4-31b-it:free',
    },
  ],
});

describe('router config typing', () => {
  it('accepts explicit and prefixed model inputs', () => {
    expect(explicitRouter.listModels()).toHaveLength(1);
    expect(prefixedRouter.listModels()).toHaveLength(1);
  });
});
