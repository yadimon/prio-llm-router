import { RouterConfigurationError } from './errors.js';
import type {
  LlmConnection,
  LlmSource,
  LlmSourceConfig,
  ProviderConfig,
} from './types.js';

export function createLlmConnection<TProvider extends ProviderConfig>(
  provider: TProvider,
): LlmConnection<TProvider> {
  assertConnectionProviderName(provider);

  return {
    provider,
  };
}

export function createLlmSource<TProvider extends ProviderConfig>(
  connection: LlmConnection<TProvider>,
  config: LlmSourceConfig<TProvider>,
): LlmSource<TProvider> {
  assertSourceConfig(config);

  const normalizedConfig =
    config.access === 'free'
      ? config
      : ({
          ...config,
          access: 'standard',
        } satisfies LlmSourceConfig<TProvider>);

  return {
    connection,
    config: normalizedConfig,
  };
}

function assertConnectionProviderName(provider: ProviderConfig): void {
  if (!provider.name.trim()) {
    throw new RouterConfigurationError(
      'Connection provider names must be non-empty.',
    );
  }
}

function assertSourceConfig(config: LlmSourceConfig): void {
  if (!config.name.trim()) {
    throw new RouterConfigurationError('Source names must be non-empty.');
  }

  if (!config.model.trim()) {
    throw new RouterConfigurationError('Source models must be non-empty.');
  }
}
