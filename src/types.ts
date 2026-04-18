import type { ModelMessage } from 'ai';

export type ProviderType =
  | 'anthropic'
  | 'cohere'
  | 'deepseek'
  | 'google'
  | 'groq'
  | 'mistral'
  | 'openai'
  | 'openai-compatible'
  | 'openrouter'
  | 'perplexity'
  | 'togetherai'
  | 'vercel'
  | 'xai';

export type ModelTier = 'free' | 'paid';
export type SourceAccessMode = 'standard' | 'free';

export interface SingleApiKeyAuth {
  mode: 'single';
  apiKey: string;
}

export type ProviderAuth = SingleApiKeyAuth;

interface ProviderConfigBase<TType extends ProviderType> {
  name: string;
  prefix?: string;
  type: TType;
  auth: ProviderAuth;
  enabled?: boolean;
  baseURL?: string;
  headers?: Record<string, string>;
}

export type AnthropicProviderConfig = ProviderConfigBase<'anthropic'>;

export type CohereProviderConfig = ProviderConfigBase<'cohere'>;

export type DeepSeekProviderConfig = ProviderConfigBase<'deepseek'>;

export type GoogleProviderConfig = ProviderConfigBase<'google'>;

export type GroqProviderConfig = ProviderConfigBase<'groq'>;

export type MistralProviderConfig = ProviderConfigBase<'mistral'>;

export type OpenAIProviderConfig = ProviderConfigBase<'openai'>;

export interface OpenAICompatibleProviderConfig
  extends ProviderConfigBase<'openai-compatible'> {
  baseURL: string;
  providerLabel?: string;
  queryParams?: Record<string, string>;
}

export interface OpenRouterProviderConfig
  extends ProviderConfigBase<'openrouter'> {
  appName?: string;
  appUrl?: string;
}

export type PerplexityProviderConfig = ProviderConfigBase<'perplexity'>;

export type TogetherAIProviderConfig = ProviderConfigBase<'togetherai'>;

export type VercelProviderConfig = ProviderConfigBase<'vercel'>;

export type XaiProviderConfig = ProviderConfigBase<'xai'>;

export type ProviderConfig =
  | AnthropicProviderConfig
  | CohereProviderConfig
  | DeepSeekProviderConfig
  | GoogleProviderConfig
  | GroqProviderConfig
  | MistralProviderConfig
  | OpenAICompatibleProviderConfig
  | OpenAIProviderConfig
  | OpenRouterProviderConfig
  | PerplexityProviderConfig
  | TogetherAIProviderConfig
  | VercelProviderConfig
  | XaiProviderConfig;

export interface ModelConfig {
  name: string;
  provider: string;
  model: string;
  enabled?: boolean;
  priority?: number;
  tier?: ModelTier;
  metadata?: Record<string, unknown>;
}

export interface PrefixedModelConfig {
  name: string;
  model: string;
  provider?: never;
  enabled?: boolean;
  priority?: number;
  tier?: ModelTier;
  metadata?: Record<string, unknown>;
}

export type ModelInputConfig = ModelConfig | PrefixedModelConfig;

export interface LlmConnection<TProvider extends ProviderConfig = ProviderConfig> {
  provider: TProvider;
}

export type OpenRouterConnectionInput = Omit<OpenRouterProviderConfig, 'type'>;
export type OpenAICompatibleConnectionInput = Omit<
  OpenAICompatibleProviderConfig,
  'type'
>;

interface LlmSourceConfigBase {
  name: string;
  enabled?: boolean;
  priority?: number;
  metadata?: Record<string, unknown>;
}

interface StandardLlmSourceConfig extends LlmSourceConfigBase {
  model: string;
  access?: 'standard';
  tier?: ModelTier;
}

interface OpenRouterFreeLlmSourceConfig extends LlmSourceConfigBase {
  model: `${string}:free`;
  access: 'free';
  tier?: 'free';
}

export type OpenRouterFreeSourceInput = Omit<
  OpenRouterFreeLlmSourceConfig,
  'access'
>;

export type LlmSourceConfig<
  TProvider extends ProviderConfig = ProviderConfig,
> = TProvider extends OpenRouterProviderConfig
  ? StandardLlmSourceConfig | OpenRouterFreeLlmSourceConfig
  : StandardLlmSourceConfig;

export interface LlmSource<TProvider extends ProviderConfig = ProviderConfig> {
  connection: LlmConnection<TProvider>;
  config: LlmSourceConfig<TProvider>;
}

export type TextInput =
  | {
      prompt: string;
      messages?: never;
    }
  | {
      messages: ModelMessage[];
      prompt?: never;
    };

export interface GenerateTextRequestBase {
  system?: string;
  chain?: string[];
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  stopSequences?: string[];
  abortSignal?: AbortSignal;
  attemptTimeoutMs?: number;
  providerMaxRetries?: number;
}

export type RouterGenerateTextRequest = TextInput & GenerateTextRequestBase;
export type RouterStreamTextRequest = RouterGenerateTextRequest & {
  firstChunkTimeoutMs?: number;
};

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  statusCode?: number;
}

export interface PendingAttempt {
  attemptIndex: number;
  targetName: string;
  providerName: string;
  providerType: ProviderType;
  model: string;
  tier?: ModelTier;
  startedAt: Date;
}

export interface AttemptRecord extends PendingAttempt {
  finishedAt: Date;
  durationMs: number;
  success: boolean;
  error?: SerializedError;
}

export interface RouterHooks {
  onAttemptStart?: (attempt: PendingAttempt) => void;
  onAttemptFailure?: (attempt: AttemptRecord) => void;
  onAttemptSuccess?: (attempt: AttemptRecord) => void;
}

export interface ResolvedModelTarget {
  name: string;
  providerName: string;
  providerType: ProviderType;
  model: string;
  priority?: number;
  tier?: ModelTier;
  metadata?: Record<string, unknown>;
}

export interface ExecuteTextTargetInput {
  provider: ProviderConfig;
  model: ModelConfig;
  request: RouterGenerateTextRequest;
}

export interface ExecuteTextTargetResult {
  text: string;
  finishReason: string | null;
  usage?: TokenUsage;
  warnings?: unknown[];
  raw: unknown;
}

export interface ExecuteStreamTextTargetResult {
  textStream: AsyncIterable<string>;
  consumeStream?: () => Promise<void>;
  finishReason: Promise<string | null>;
  usage: Promise<TokenUsage | undefined>;
  warnings: Promise<unknown[] | undefined>;
  raw: unknown;
}

export interface TextGenerationExecutor {
  execute(input: ExecuteTextTargetInput): Promise<ExecuteTextTargetResult>;
  stream(input: ExecuteTextTargetInput): Promise<ExecuteStreamTextTargetResult>;
}

interface PrioLlmRouterCommonOptions {
  defaultChain?: string[];
  defaultAttemptTimeoutMs?: number;
  defaultProviderMaxRetries?: number;
  debug?: boolean;
  hooks?: RouterHooks;
  executor?: TextGenerationExecutor;
}

export interface PrioLlmRouterModelOptions extends PrioLlmRouterCommonOptions {
  providers: ProviderConfig[];
  models: ModelInputConfig[];
  sources?: never;
}

export interface PrioLlmRouterSourceOptions extends PrioLlmRouterCommonOptions {
  sources: LlmSource[];
  providers?: never;
  models?: never;
}

export type PrioLlmRouterOptions =
  | PrioLlmRouterModelOptions
  | PrioLlmRouterSourceOptions;

export interface RouterGenerateTextResult {
  text: string;
  target: ResolvedModelTarget;
  attempts: AttemptRecord[];
  finishReason: string | null;
  usage?: TokenUsage;
  warnings?: unknown[];
  raw: unknown;
}

export interface RouterStreamTextResult {
  target: ResolvedModelTarget;
  selectedAttempt: PendingAttempt;
  attempts: AttemptRecord[];
  textStream: AsyncIterable<string>;
  final: Promise<RouterGenerateTextResult>;
  consumeStream: () => Promise<RouterGenerateTextResult>;
}
