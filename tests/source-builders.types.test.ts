import { describe, expect, it } from 'vitest';

import { createLlmConnection, createLlmSource } from '../src/index.js';

const openRouterConnection = createLlmConnection({
  name: 'openrouter-main',
  type: 'openrouter',
  auth: { mode: 'single', apiKey: 'openrouter-key' },
});

const googleConnection = createLlmConnection({
  name: 'google-main',
  type: 'google',
  auth: { mode: 'single', apiKey: 'google-key' },
});

const strictFreeSource = createLlmSource(openRouterConnection, {
  name: 'kimi-free',
  model: 'moonshotai/kimi-k2:free',
  access: 'free',
});

createLlmSource(googleConnection, {
  name: 'gemini-free',
  model: 'gemini-2.5-flash-lite',
  // @ts-expect-error only OpenRouter connections support strict free sources
  access: 'free',
});

// @ts-expect-error strict free OpenRouter sources must use explicit :free model ids
createLlmSource(openRouterConnection, {
  name: 'invalid-openrouter-free',
  model: 'openrouter/free',
  access: 'free',
});

describe('createLlmSource typing', () => {
  it('keeps strict free source configs typed for OpenRouter only', () => {
    expect(strictFreeSource.config.access).toBe('free');
    expect(strictFreeSource.config.model).toBe('moonshotai/kimi-k2:free');
  });
});
