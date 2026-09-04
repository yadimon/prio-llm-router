import {
  AllModelsFailedError,
  AttemptTimeoutError,
  RouterConfigurationError,
  serializeError,
} from './errors.js';
import { createDefaultTextGenerationExecutor } from './provider-factory.js';
import type {
  AttemptRecord,
  ExecuteStreamTextTargetResult,
  LlmSource,
  ModelConfig,
  ModelInputConfig,
  PendingAttempt,
  PrioLlmRouterOptions,
  ProviderConfig,
  ResolvedModelTarget,
  RouterGenerateTextRequest,
  RouterGenerateTextResult,
  RouterStreamTextRequest,
  RouterStreamTextResult,
  TextGenerationExecutor,
} from './types.js';

interface IndexedModel extends ModelConfig {
  readonly __index: number;
}

interface NormalizedRouterConfig {
  providers: ProviderConfig[];
  models: ModelConfig[];
  defaultChain?: string[];
  defaultAttemptTimeoutMs?: number;
}

interface PrefixedModelReference {
  prefix: string;
  modelId: string;
}

export class PrioLlmRouter {
  private readonly providersByName = new Map<string, ProviderConfig>();
  private readonly providersByPrefix = new Map<string, ProviderConfig>();
  private readonly modelsByName = new Map<string, IndexedModel>();
  private readonly defaultChain: string[] | undefined;
  private readonly defaultAttemptTimeoutMs: number | undefined;
  private readonly executor: TextGenerationExecutor;
  private readonly hooks: PrioLlmRouterOptions['hooks'] | undefined;

  constructor(options: PrioLlmRouterOptions) {
    const normalized = resolveRouterConfig(options);

    if (normalized.providers.length === 0) {
      throw new RouterConfigurationError(
        'At least one provider configuration is required.',
      );
    }

    if (normalized.models.length === 0) {
      throw new RouterConfigurationError(
        'At least one model configuration is required.',
      );
    }

    this.defaultChain = normalized.defaultChain;
    this.defaultAttemptTimeoutMs = normalized.defaultAttemptTimeoutMs;
    this.hooks = createRouterHooks(options.hooks, options.debug === true);
    this.executor = options.executor ?? (
      options.defaultProviderMaxRetries === undefined
        ? createDefaultTextGenerationExecutor()
        : createDefaultTextGenerationExecutor({
            defaultProviderMaxRetries: options.defaultProviderMaxRetries,
          })
    );

    for (const provider of normalized.providers) {
      this.assertUniqueName(
        this.providersByName,
        provider.name,
        'provider configuration',
      );
      this.validateProvider(provider);
      this.providersByName.set(provider.name, provider);

      if (provider.prefix) {
        this.assertUniqueProviderPrefix(provider.prefix);
        this.providersByPrefix.set(provider.prefix, provider);
      }
    }

    normalized.models.forEach((model, index) => {
      this.assertUniqueName(this.modelsByName, model.name, 'model configuration');

      if (!this.providersByName.has(model.provider)) {
        throw new RouterConfigurationError(
          `Model "${model.name}" references unknown provider "${model.provider}".`,
        );
      }

      this.modelsByName.set(model.name, {
        ...model,
        __index: index,
      });
    });

    if (this.defaultChain) {
      this.resolveNamedChain(this.defaultChain);
    }
  }

  listProviders(): ProviderConfig[] {
    return [...this.providersByName.values()];
  }

  listModels(): ResolvedModelTarget[] {
    return [...this.modelsByName.values()]
      .sort(compareModels)
      .map((model) => this.toResolvedTarget(model));
  }

  async generateText(
    request: RouterGenerateTextRequest,
  ): Promise<RouterGenerateTextResult> {
    const chain = this.resolveExecutionChain(request.chain);
    const attempts: AttemptRecord[] = [];
    let lastError: unknown;

    for (const [index, model] of chain.entries()) {
      const provider = this.providersByName.get(model.provider);

      if (!provider) {
        throw new RouterConfigurationError(
          `Provider "${model.provider}" was not found for target "${model.name}".`,
        );
      }

      const pendingAttempt: PendingAttempt = {
        attemptIndex: index,
        targetName: model.name,
        providerName: provider.name,
        providerType: provider.type,
        model: model.model,
        startedAt: new Date(),
      };

      if (model.tier !== undefined) {
        pendingAttempt.tier = model.tier;
      }

      this.hooks?.onAttemptStart?.(pendingAttempt);
      const { controller, cleanup, parentAborted } = createLinkedAbortController(
        request.abortSignal,
      );

      try {
        const result = await this.executeAttemptWithTimeout({
          execute: () =>
            this.executor.execute({
              provider,
              model,
              request: {
                ...request,
                abortSignal: controller.signal,
              },
            }),
          timeoutMs: request.attemptTimeoutMs ?? this.defaultAttemptTimeoutMs,
          abortController: controller,
        });
        cleanup();

        const finishedAt = new Date();
        const attemptRecord: AttemptRecord = {
          ...pendingAttempt,
          finishedAt,
          durationMs: finishedAt.getTime() - pendingAttempt.startedAt.getTime(),
          success: true,
        };

        attempts.push(attemptRecord);
        this.hooks?.onAttemptSuccess?.(attemptRecord);

        const response: RouterGenerateTextResult = {
          text: result.text,
          target: this.toResolvedTarget(model),
          attempts,
          finishReason: result.finishReason,
          raw: result.raw,
        };

        if (result.usage) {
          response.usage = result.usage;
        }

        if (result.warnings) {
          response.warnings = result.warnings;
        }

        return response;
      } catch (error) {
        cleanup();

        if (parentAborted()) {
          throw error;
        }

        const finishedAt = new Date();
        const attemptRecord: AttemptRecord = {
          ...pendingAttempt,
          finishedAt,
          durationMs: finishedAt.getTime() - pendingAttempt.startedAt.getTime(),
          success: false,
          error: serializeError(error),
        };

        attempts.push(attemptRecord);
        this.hooks?.onAttemptFailure?.(attemptRecord);
        lastError = error;
      }
    }

    throw new AllModelsFailedError(attempts, lastError);
  }

  async streamText(
    request: RouterStreamTextRequest,
  ): Promise<RouterStreamTextResult> {
    const chain = this.resolveExecutionChain(request.chain);
    const attempts: AttemptRecord[] = [];
    let lastError: unknown;

    for (const [index, model] of chain.entries()) {
      const provider = this.providersByName.get(model.provider);

      if (!provider) {
        throw new RouterConfigurationError(
          `Provider "${model.provider}" was not found for target "${model.name}".`,
        );
      }

      const pendingAttempt = createPendingAttempt(index, provider, model);
      this.hooks?.onAttemptStart?.(pendingAttempt);

      const { controller, cleanup, parentAborted } = createLinkedAbortController(
        request.abortSignal,
      );

      try {
        const streamResult = await this.executor.stream({
          provider,
          model,
          request: {
            ...request,
            abortSignal: controller.signal,
          },
        });

        observeStreamMetadataRejections(streamResult);

        const iterator = streamResult.textStream[Symbol.asyncIterator]();
        const firstChunk = await this.waitForFirstChunk({
          iterator,
          timeoutMs:
            request.firstChunkTimeoutMs ??
            request.attemptTimeoutMs ??
            this.defaultAttemptTimeoutMs,
          abortController: controller,
        });

        if (firstChunk.done) {
          throw createEmptyFirstChunkError(model.name);
        }

        return this.createStreamingResult({
          pendingAttempt,
          attempts,
          model,
          iterator,
          streamResult,
          firstChunk: firstChunk.value,
          cleanupAbortLink: cleanup,
        });
      } catch (error) {
        cleanup();

        if (parentAborted()) {
          throw error;
        }

        const attemptRecord = createFailedAttemptRecord(pendingAttempt, error);
        attempts.push(attemptRecord);
        this.hooks?.onAttemptFailure?.(attemptRecord);
        lastError = error;
      }
    }

    throw new AllModelsFailedError(attempts, lastError);
  }

  private createStreamingResult(options: {
    pendingAttempt: PendingAttempt;
    attempts: AttemptRecord[];
    model: IndexedModel;
    iterator: AsyncIterator<string>;
    streamResult: ExecuteStreamTextTargetResult;
    firstChunk: string;
    cleanupAbortLink: () => void;
  }): RouterStreamTextResult {
    const {
      pendingAttempt,
      attempts,
      model,
      iterator,
      streamResult,
      firstChunk,
      cleanupAbortLink,
    } = options;

    let started = false;
    const textParts = [firstChunk];

    let resolveFinal!: (value: RouterGenerateTextResult) => void;
    let rejectFinal!: (reason?: unknown) => void;
    let finalized = false;
    const final = new Promise<RouterGenerateTextResult>((resolve, reject) => {
      resolveFinal = resolve;
      rejectFinal = reject;
    });

    // Consumers may abandon the stream without awaiting `final` (for example by
    // breaking out of `for await`). Keep the rejection observed internally so
    // that callers who do await it still see the error, while callers who do
    // not are never hit with an unhandled rejection.
    void final.catch(() => undefined);

    const finalizeSuccess = async (): Promise<void> => {
      if (finalized) {
        return;
      }
      finalized = true;

      try {
        const finishedAt = new Date();
        const attemptRecord: AttemptRecord = {
          ...pendingAttempt,
          finishedAt,
          durationMs: finishedAt.getTime() - pendingAttempt.startedAt.getTime(),
          success: true,
        };

        attempts.push(attemptRecord);
        this.hooks?.onAttemptSuccess?.(attemptRecord);

        const result: RouterGenerateTextResult = {
          text: textParts.join(''),
          target: this.toResolvedTarget(model),
          attempts: [...attempts],
          finishReason: await streamResult.finishReason,
          raw: streamResult.raw,
        };

        const usage = await streamResult.usage;
        if (usage) {
          result.usage = usage;
        }

        const warnings = await streamResult.warnings;
        if (warnings) {
          result.warnings = warnings;
        }

        cleanupAbortLink();
        resolveFinal(result);
      } catch (error) {
        // `finalized` is already set, so `finalizeFailure` would short-circuit.
        // Settle `final` and release the parent abort link here instead of
        // leaving the promise pending forever.
        cleanupAbortLink();
        rejectFinal(error);
        throw error;
      }
    };

    const finalizeFailure = (error: unknown): void => {
      if (finalized) {
        return;
      }
      finalized = true;

      const attemptRecord = createFailedAttemptRecord(pendingAttempt, error);
      attempts.push(attemptRecord);

      try {
        this.hooks?.onAttemptFailure?.(attemptRecord);
      } finally {
        // A throwing hook must not leave `final` pending forever or leak the
        // parent abort link. The hook error still propagates to the caller,
        // while `final` keeps reporting the original stream failure.
        cleanupAbortLink();
        rejectFinal(error);
      }
    };

    const wrappedStream: AsyncIterable<string> = {
      [Symbol.asyncIterator]: () => {
        if (started) {
          throw new RouterConfigurationError(
            'This stream can only be consumed once.',
          );
        }

        started = true;

        return createRouterTextStreamIterator({
          firstChunk,
          iterator,
          onChunk: (chunk) => {
            textParts.push(chunk);
          },
          onSuccess: finalizeSuccess,
          onFailure: finalizeFailure,
        });
      },
    };

    return {
      target: this.toResolvedTarget(model),
      selectedAttempt: pendingAttempt,
      attempts: [...attempts],
      textStream: wrappedStream,
      final,
      consumeStream: async () => {
        if (!started) {
          for await (const _ of wrappedStream) {
            void _;
          }
        }

        return final;
      },
    };
  }

  private async waitForFirstChunk(options: {
    iterator: AsyncIterator<string>;
    timeoutMs: number | undefined;
    abortController: AbortController;
  }): Promise<IteratorResult<string>> {
    const { iterator, timeoutMs, abortController } = options;
    const nextPromise = iterator.next();

    if (timeoutMs === undefined) {
      return nextPromise;
    }

    const timeoutError = new AttemptTimeoutError(timeoutMs);

    const timeout = delay(timeoutMs);

    try {
      const timedRace = await Promise.race([
        nextPromise.then(
          (value) => ({ kind: 'value' as const, value }),
          (error: unknown) => ({ kind: 'error' as const, error }),
        ),
        timeout.promise.then(() => ({ kind: 'timeout' as const })),
      ]);

      if (timedRace.kind === 'value') {
        return timedRace.value;
      }

      if (timedRace.kind === 'timeout') {
        abortController.abort(timeoutError);
        void nextPromise.catch(() => undefined);
        throw timeoutError;
      }

      throw timedRace.error;
    } finally {
      timeout.cancel();
    }
  }

  private async executeAttemptWithTimeout<TResult>(options: {
    execute: () => Promise<TResult>;
    timeoutMs: number | undefined;
    abortController: AbortController;
  }): Promise<TResult> {
    const { execute, timeoutMs, abortController } = options;
    const executionPromise = execute();

    if (timeoutMs === undefined) {
      return executionPromise;
    }

    const timeoutError = new AttemptTimeoutError(timeoutMs);

    const timeout = delay(timeoutMs);

    try {
      const timedRace = await Promise.race([
        executionPromise.then(
          (value) => ({ kind: 'value' as const, value }),
          (error: unknown) => ({ kind: 'error' as const, error }),
        ),
        timeout.promise.then(() => ({ kind: 'timeout' as const })),
      ]);

      if (timedRace.kind === 'value') {
        return timedRace.value;
      }

      if (timedRace.kind === 'timeout') {
        abortController.abort(timeoutError);
        void executionPromise.catch(() => undefined);
        throw timeoutError;
      }

      throw timedRace.error;
    } finally {
      timeout.cancel();
    }
  }

  private resolveExecutionChain(chain?: string[]): IndexedModel[] {
    if (chain?.length) {
      return this.resolveNamedChain(chain);
    }

    if (this.defaultChain?.length) {
      return this.resolveNamedChain(this.defaultChain);
    }

    const implicitChain = [...this.modelsByName.values()]
      .filter((model) => this.isModelEnabled(model))
      .sort(compareModels);

    if (implicitChain.length === 0) {
      throw new RouterConfigurationError(
        'No enabled model targets are available for execution.',
      );
    }

    return implicitChain;
  }

  private resolveNamedChain(chain: string[]): IndexedModel[] {
    const resolved: IndexedModel[] = [];
    const seen = new Set<string>();

    for (const targetName of chain) {
      if (seen.has(targetName)) {
        continue;
      }

      seen.add(targetName);
      const model =
        this.modelsByName.get(targetName) ??
        this.resolvePrefixedChainTarget(targetName);

      if (!model) {
        throw new RouterConfigurationError(
          `Model target "${targetName}" is not configured.`,
        );
      }

      if (!this.isModelEnabled(model)) {
        throw new RouterConfigurationError(
          `Model target "${targetName}" is disabled or its provider is disabled.`,
        );
      }

      resolved.push(model);
    }

    if (resolved.length === 0) {
      throw new RouterConfigurationError(
        'The resolved execution chain is empty.',
      );
    }

    return resolved;
  }

  private resolvePrefixedChainTarget(targetName: string): IndexedModel | undefined {
    const reference = parsePrefixedModelReference(targetName);

    if (!reference) {
      return undefined;
    }

    const provider = this.providersByPrefix.get(reference.prefix);
    if (!provider) {
      return undefined;
    }

    if (!reference.modelId) {
      throw new RouterConfigurationError(
        `Prefixed model target "${targetName}" must include a non-empty model id.`,
      );
    }

    return {
      name: targetName,
      provider: provider.name,
      model: reference.modelId,
      __index: Number.MAX_SAFE_INTEGER,
    };
  }

  private isModelEnabled(model: ModelConfig): boolean {
    if (model.enabled === false) {
      return false;
    }

    const provider = this.providersByName.get(model.provider);
    return provider?.enabled !== false;
  }

  private toResolvedTarget(model: ModelConfig): ResolvedModelTarget {
    const provider = this.providersByName.get(model.provider);

    if (!provider) {
      throw new RouterConfigurationError(
        `Model "${model.name}" references missing provider "${model.provider}".`,
      );
    }

    const resolvedTarget: ResolvedModelTarget = {
      name: model.name,
      providerName: provider.name,
      providerType: provider.type,
      model: model.model,
    };

    if (model.priority !== undefined) {
      resolvedTarget.priority = model.priority;
    }

    if (model.tier !== undefined) {
      resolvedTarget.tier = model.tier;
    }

    if (model.metadata !== undefined) {
      resolvedTarget.metadata = model.metadata;
    }

    return resolvedTarget;
  }

  private validateProvider(provider: ProviderConfig): void {
    if (!provider.name.trim()) {
      throw new RouterConfigurationError(
        'Provider configuration names must be non-empty.',
      );
    }

    if (provider.prefix !== undefined && !provider.prefix.trim()) {
      throw new RouterConfigurationError(
        `Provider "${provider.name}" prefixes must be non-empty when configured.`,
      );
    }

    if (!provider.auth.apiKey.trim() && provider.type !== 'openai-compatible') {
      throw new RouterConfigurationError(
        `Provider "${provider.name}" requires a non-empty API key.`,
      );
    }
  }

  private assertUniqueName(
    registry: Map<string, unknown>,
    name: string,
    label: string,
  ): void {
    if (!name.trim()) {
      throw new RouterConfigurationError(`${label} names must be non-empty.`);
    }

    if (registry.has(name)) {
      throw new RouterConfigurationError(
        `Duplicate ${label} name "${name}" detected.`,
      );
    }
  }

  private assertUniqueProviderPrefix(prefix: string): void {
    if (this.providersByPrefix.has(prefix)) {
      throw new RouterConfigurationError(
        `Duplicate provider prefix "${prefix}" detected.`,
      );
    }
  }
}

export function createLlmRouter(
  options: PrioLlmRouterOptions,
): PrioLlmRouter {
  return new PrioLlmRouter(options);
}

function resolveRouterConfig(
  options: PrioLlmRouterOptions,
): NormalizedRouterConfig {
  if ('sources' in options) {
    return compileSources(
      options.sources,
      options.defaultChain,
      options.defaultAttemptTimeoutMs,
    );
  }

  const normalizedProviders = normalizeProviders(options.providers);
  const normalized: NormalizedRouterConfig = {
    providers: normalizedProviders,
    models: compileModelInputs(normalizedProviders, options.models),
  };

  if (options.defaultChain !== undefined) {
    normalized.defaultChain = options.defaultChain;
  }

  if (options.defaultAttemptTimeoutMs !== undefined) {
    normalized.defaultAttemptTimeoutMs = options.defaultAttemptTimeoutMs;
  }

  return normalized;
}

function normalizeProviders(providers: ProviderConfig[]): ProviderConfig[] {
  return providers.map((provider) => {
    if (provider.prefix === undefined) {
      return provider;
    }

    return {
      ...provider,
      prefix: provider.prefix.trim(),
    };
  });
}

function compileModelInputs(
  providers: ProviderConfig[],
  models: ModelInputConfig[],
): ModelConfig[] {
  const providersByPrefix = new Map<string, ProviderConfig>();

  for (const provider of providers) {
    if (!provider.prefix) {
      continue;
    }

    if (providersByPrefix.has(provider.prefix)) {
      throw new RouterConfigurationError(
        `Duplicate provider prefix "${provider.prefix}" detected.`,
      );
    }

    providersByPrefix.set(provider.prefix, provider);
  }

  return models.map((model) => compileModelInput(model, providersByPrefix));
}

function compileModelInput(
  model: ModelInputConfig,
  providersByPrefix: Map<string, ProviderConfig>,
): ModelConfig {
  if ('provider' in model && model.provider !== undefined) {
    return model;
  }

  const reference = parsePrefixedModelReference(model.model);
  if (!reference) {
    throw new RouterConfigurationError(
      `Model "${model.name}" must either define a provider or use a prefixed model id like "or:google/gemma-4-31b-it:free".`,
    );
  }

  const provider = providersByPrefix.get(reference.prefix);
  if (!provider) {
    throw new RouterConfigurationError(
      `Model "${model.name}" references unknown provider prefix "${reference.prefix}".`,
    );
  }

  if (!reference.modelId) {
    throw new RouterConfigurationError(
      `Model "${model.name}" must include a non-empty model id after the "${reference.prefix}:" prefix.`,
    );
  }

  const compiledModel: ModelConfig = {
    name: model.name,
    provider: provider.name,
    model: reference.modelId,
  };

  if (model.enabled !== undefined) {
    compiledModel.enabled = model.enabled;
  }

  if (model.priority !== undefined) {
    compiledModel.priority = model.priority;
  }

  if (model.tier !== undefined) {
    compiledModel.tier = model.tier;
  }

  if (model.metadata !== undefined) {
    compiledModel.metadata = model.metadata;
  }

  return compiledModel;
}

function compareModels(left: IndexedModel, right: IndexedModel): number {
  const leftPriority = left.priority ?? Number.MAX_SAFE_INTEGER;
  const rightPriority = right.priority ?? Number.MAX_SAFE_INTEGER;

  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }

  return left.__index - right.__index;
}

function parsePrefixedModelReference(
  value: string,
): PrefixedModelReference | undefined {
  const separatorIndex = value.indexOf(':');

  if (separatorIndex <= 0) {
    return undefined;
  }

  return {
    prefix: value.slice(0, separatorIndex).trim(),
    modelId: value.slice(separatorIndex + 1).trim(),
  };
}

function compileSources(
  sources: LlmSource[],
  defaultChain?: string[],
  defaultAttemptTimeoutMs?: number,
): NormalizedRouterConfig {
  const providersByName = new Map<string, ProviderConfig>();
  const models: ModelConfig[] = [];

  for (const source of sources) {
    const provider = source.connection.provider;
    const providerName = provider.name.trim();
    const modelId = source.config.model.trim();
    const access = source.config.access ?? 'standard';

    if (!providerName) {
      throw new RouterConfigurationError(
        'Connection provider names must be non-empty.',
      );
    }

    if (!source.config.name.trim()) {
      throw new RouterConfigurationError('Source names must be non-empty.');
    }

    if (!modelId) {
      throw new RouterConfigurationError('Source models must be non-empty.');
    }

    const existingProvider = providersByName.get(providerName);
    if (existingProvider) {
      assertMatchingSourceProvider(existingProvider, provider);
    } else {
      providersByName.set(providerName, provider);
    }

    if (access === 'free') {
      assertGuaranteedFreeSource(provider, source.config.model);
    }

    if (access === 'free' && source.config.tier === 'paid') {
      throw new RouterConfigurationError(
        `Free source "${source.config.name}" cannot be marked as paid.`,
      );
    }

    const compiledModel: ModelConfig = {
      name: source.config.name,
      provider: providerName,
      model: modelId,
    };

    if (source.config.enabled !== undefined) {
      compiledModel.enabled = source.config.enabled;
    }

    if (source.config.priority !== undefined) {
      compiledModel.priority = source.config.priority;
    }

    const tier = source.config.tier ?? (access === 'free' ? 'free' : undefined);
    if (tier !== undefined) {
      compiledModel.tier = tier;
    }

    if (source.config.metadata !== undefined) {
      compiledModel.metadata = source.config.metadata;
    }

    models.push(compiledModel);
  }

  const normalized: NormalizedRouterConfig = {
    providers: [...providersByName.values()],
    models,
  };

  if (defaultChain !== undefined) {
    normalized.defaultChain = defaultChain;
  }

  if (defaultAttemptTimeoutMs !== undefined) {
    normalized.defaultAttemptTimeoutMs = defaultAttemptTimeoutMs;
  }

  return normalized;
}

function assertMatchingSourceProvider(
  existingProvider: ProviderConfig,
  nextProvider: ProviderConfig,
): void {
  if (JSON.stringify(existingProvider) === JSON.stringify(nextProvider)) {
    return;
  }

  throw new RouterConfigurationError(
    `Connection provider "${existingProvider.name}" is configured more than once with different settings.`,
  );
}

function assertGuaranteedFreeSource(
  provider: ProviderConfig,
  model: string,
): void {
  if (provider.type !== 'openrouter') {
    throw new RouterConfigurationError(
      `Provider "${provider.name}" does not support strict free sources. Only OpenRouter with explicit ":free" model variants is supported today.`,
    );
  }

  const normalizedModel = model.trim();

  if (normalizedModel === 'openrouter/free') {
    return;
  }

  if (!normalizedModel.endsWith(':free')) {
    throw new RouterConfigurationError(
      `Free OpenRouter sources must use a ":free" model id or "openrouter/free". Received "${normalizedModel}".`,
    );
  }
}

function createPendingAttempt(
  attemptIndex: number,
  provider: ProviderConfig,
  model: ModelConfig,
): PendingAttempt {
  const pendingAttempt: PendingAttempt = {
    attemptIndex,
    targetName: model.name,
    providerName: provider.name,
    providerType: provider.type,
    model: model.model,
    startedAt: new Date(),
  };

  if (model.tier !== undefined) {
    pendingAttempt.tier = model.tier;
  }

  return pendingAttempt;
}

function createFailedAttemptRecord(
  pendingAttempt: PendingAttempt,
  error: unknown,
): AttemptRecord {
  const finishedAt = new Date();

  return {
    ...pendingAttempt,
    finishedAt,
    durationMs: finishedAt.getTime() - pendingAttempt.startedAt.getTime(),
    success: false,
    error: serializeError(error),
  };
}

function observeStreamMetadataRejections(
  streamResult: ExecuteStreamTextTargetResult,
): void {
  // An attempt can be abandoned long before its metadata is read: a first-chunk
  // timeout, an empty stream, or a finalization that exits early all leave
  // these promises unread. Executors are public API, so this guarantee has to
  // hold for any executor rather than only the built-in one. Attaching a no-op
  // handler does not consume the rejection - callers awaiting these promises
  // still observe the original error.
  void streamResult.finishReason.catch(() => undefined);
  void streamResult.usage.catch(() => undefined);
  void streamResult.warnings.catch(() => undefined);
}

/**
 * Run the failure hook, capturing rather than propagating a throw so the
 * caller can still cancel the underlying provider stream before surfacing it.
 */
function runFailureHook(
  onFailure: (error: unknown) => void,
  error: unknown,
): { thrown: unknown } | undefined {
  try {
    onFailure(error);
    return undefined;
  } catch (thrown) {
    return { thrown };
  }
}

function createRouterTextStreamIterator(options: {
  firstChunk: string;
  iterator: AsyncIterator<string>;
  onChunk: (chunk: string) => void;
  onSuccess: () => Promise<void>;
  onFailure: (error: unknown) => void;
}): AsyncIterator<string> {
  const { firstChunk, iterator, onChunk, onSuccess, onFailure } = options;
  let firstYielded = false;
  let finished = false;

  return {
    async next(): Promise<IteratorResult<string>> {
      if (finished) {
        return {
          done: true,
          value: undefined,
        };
      }

      if (!firstYielded) {
        firstYielded = true;
        return {
          done: false,
          value: firstChunk,
        };
      }

      try {
        const next = await iterator.next();

        if (next.done) {
          finished = true;
          await onSuccess();
          return {
            done: true,
            value: undefined,
          };
        }

        onChunk(next.value);
        return {
          done: false,
          value: next.value,
        };
      } catch (error) {
        finished = true;
        onFailure(error);
        throw error;
      }
    },
    async return(): Promise<IteratorResult<string>> {
      finished = true;

      const hookFailure = runFailureHook(onFailure, createStreamClosedEarlyError());

      try {
        // A throwing failure hook must not skip cancellation of the underlying
        // provider stream.
        if (typeof iterator.return === 'function') {
          await iterator.return();
        }
      } catch (cancelError) {
        // A failed cancellation must not mask why the stream was closed.
        if (!hookFailure) {
          throw cancelError;
        }
      }

      if (hookFailure) {
        throw hookFailure.thrown;
      }

      return {
        done: true,
        value: undefined,
      };
    },
    async throw(error?: unknown): Promise<IteratorResult<string>> {
      finished = true;

      // Same ordering guarantee as return(): a throwing hook must not skip
      // cancellation of the underlying provider stream.
      const hookFailure = runFailureHook(onFailure, error);
      const cancelled =
        typeof iterator.throw === 'function' ? iterator.throw(error) : undefined;

      if (hookFailure) {
        // Let cancellation settle, then surface the hook error, matching
        // return(). Its own rejection must not mask the hook failure.
        await Promise.resolve(cancelled).catch(() => undefined);
        throw hookFailure.thrown;
      }

      if (cancelled !== undefined) {
        return cancelled;
      }

      throw error;
    },
  };
}

function createLinkedAbortController(parentSignal?: AbortSignal): {
  controller: AbortController;
  cleanup: () => void;
  parentAborted: () => boolean;
} {
  const controller = new AbortController();
  let abortedByParent = false;

  const abortFromParent = (): void => {
    abortedByParent = true;
    controller.abort(parentSignal?.reason);
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  return {
    controller,
    cleanup: () => {
      parentSignal?.removeEventListener('abort', abortFromParent);
    },
    parentAborted: () => abortedByParent,
  };
}

function createEmptyFirstChunkError(targetName: string): Error {
  const error = new Error(
    `Stream for target "${targetName}" completed before the first text chunk.`,
  );
  error.name = 'EmptyStreamError';
  return error;
}

function createStreamClosedEarlyError(): Error {
  const error = new Error('The stream was closed before completion.');
  error.name = 'StreamClosedError';
  return error;
}

function delay(ms: number): { promise: Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });

  return {
    promise,
    cancel: () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    },
  };
}

function createRouterHooks(
  hooks: PrioLlmRouterOptions['hooks'] | undefined,
  debug: boolean,
): PrioLlmRouterOptions['hooks'] | undefined {
  if (!debug) {
    return hooks;
  }

  return {
    onAttemptStart: (attempt) => {
      console.log('[prio-llm-router] attempt:start', attempt);
      hooks?.onAttemptStart?.(attempt);
    },
    onAttemptSuccess: (attempt) => {
      console.log('[prio-llm-router] attempt:success', attempt);
      hooks?.onAttemptSuccess?.(attempt);
    },
    onAttemptFailure: (attempt) => {
      console.error('[prio-llm-router] attempt:failure', attempt);
      hooks?.onAttemptFailure?.(attempt);
    },
  };
}
