import { describe, expect, it } from 'vitest';

import {
  RouterConfigurationError,
  createLlmConnection,
  createLlmSource,
} from '../src/index.js';

describe('source configuration validation', () => {
  const connection = createLlmConnection({
    name: 'google-main',
    type: 'google',
    auth: { mode: 'single', apiKey: 'test-key' },
  });

  it('rejects blank connection names before accepting a configuration', () => {
    expect(() =>
      createLlmConnection({
        name: '  ',
        type: 'google',
        auth: { mode: 'single', apiKey: 'test-key' },
      }),
    ).toThrow(RouterConfigurationError);
  });

  it.each([
    { name: '  ', model: 'test-model' },
    { name: 'test-source', model: '\t' },
  ])('rejects blank source identifiers: %j', (config) => {
    expect(() => createLlmSource(connection, config)).toThrow(
      RouterConfigurationError,
    );
  });
});
