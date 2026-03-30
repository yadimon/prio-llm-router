import type { AttemptRecord, SerializedError } from './types.js';

export class PrioLlmRouterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class RouterConfigurationError extends PrioLlmRouterError {}

export class AttemptTimeoutError extends PrioLlmRouterError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Model attempt timed out after ${timeoutMs}ms`);
    this.timeoutMs = timeoutMs;
  }
}

export class AllModelsFailedError extends PrioLlmRouterError {
  readonly attempts: AttemptRecord[];

  constructor(attempts: AttemptRecord[], cause?: unknown) {
    super(buildFailureMessage(attempts), { cause });
    this.attempts = attempts;
  }
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    const maybeError = error as Error & {
      code?: string;
      statusCode?: number;
      status?: number;
    };

    const serialized: SerializedError = {
      name: error.name,
      message: error.message,
    };

    if (maybeError.code !== undefined) {
      serialized.code = maybeError.code;
    }

    const statusCode = maybeError.statusCode ?? maybeError.status;
    if (statusCode !== undefined) {
      serialized.statusCode = statusCode;
    }

    return serialized;
  }

  if (typeof error === 'string') {
    return {
      name: 'Error',
      message: error,
    };
  }

  return {
    name: 'UnknownError',
    message: 'Unknown router error',
  };
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === 'AbortError' || error.name === 'TimeoutError';
}

function buildFailureMessage(attempts: AttemptRecord[]): string {
  const summary = attempts
    .map((attempt) => {
      const errorMessage = attempt.error?.message ?? 'Unknown error';
      return `${attempt.targetName} (${attempt.providerName}/${attempt.model}): ${errorMessage}`;
    })
    .join('; ');

  return summary
    ? `All configured model attempts failed. ${summary}`
    : 'All configured model attempts failed.';
}
