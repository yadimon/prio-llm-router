import { RouterConfigurationError } from './errors.js';
import type {
  LlmConnection,
  LlmSource,
  LlmSourceConfig,
  OpenAICompatibleProviderConfig,
  OpenAICompatibleConnectionInput,
  OpenRouterConnectionInput,
  OpenRouterFreeSourceInput,
  OpenRouterProviderConfig,
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

export function createOpenRouterConnection(
  provider: OpenRouterConnectionInput,
): LlmConnection<OpenRouterProviderConfig> {
  return createLlmConnection({
    ...provider,
    type: 'openrouter',
  });
}

export function createOpenAICompatibleConnection(
  provider: OpenAICompatibleConnectionInput,
): LlmConnection<OpenAICompatibleProviderConfig> {
  return createLlmConnection({
    ...provider,
    type: 'openai-compatible',
  });
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

export function createOpenRouterFreeSource(
  connection: LlmConnection<OpenRouterProviderConfig>,
  config: OpenRouterFreeSourceInput,
): LlmSource<OpenRouterProviderConfig> {
  return createLlmSource(connection, {
    ...config,
    access: 'free',
  });
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
