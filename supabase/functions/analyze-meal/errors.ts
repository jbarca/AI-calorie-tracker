import Anthropic from '@anthropic-ai/sdk';

export interface MappedError {
  status: number;
  code: string;
  message: string;
}

/**
 * Maps an error thrown by the Anthropic SDK to the HTTP response this function returns.
 * Uses the SDK's typed error classes, most specific first (APIConnectionTimeoutError
 * extends APIConnectionError, and every class extends APIError). Returns null for anything
 * that is not an Anthropic API error, which the caller treats as an internal error.
 */
export function mapAnthropicError(err: unknown): MappedError | null {
  if (err instanceof Anthropic.RateLimitError) {
    return {
      status: 429,
      code: 'upstream_rate_limited',
      message: 'The AI service is busy. Try again shortly.',
    };
  } else if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return { status: 503, code: 'upstream_timeout', message: 'The AI service timed out.' };
  } else if (err instanceof Anthropic.APIConnectionError) {
    return {
      status: 503,
      code: 'upstream_unavailable',
      message: 'Could not reach the AI service.',
    };
  } else if (err instanceof Anthropic.APIError) {
    return { status: 502, code: 'upstream_error', message: 'The AI service returned an error.' };
  }
  return null;
}

/** A JSON-safe description of an Anthropic error, stored in scans.raw_result for the audit trail. */
export function describeAnthropicError(err: unknown): Record<string, unknown> {
  if (err instanceof Anthropic.APIError) {
    return {
      class: err.constructor.name,
      error_type: err.type ?? null,
      status: err.status ?? null,
      request_id: err.requestID ?? null,
      message: err.message,
    };
  }
  return { class: 'unknown', message: err instanceof Error ? err.message : String(err) };
}
