/**
 * Maps `analyze-meal` Edge Function failures (HTTP status + `error` code from its JSON body)
 * to messages the app can show. See supabase/functions/analyze-meal/handler.ts for the codes.
 */

export interface FriendlyError {
  title: string;
  message: string;
  /** Retrying the same request may succeed (transient failure). */
  retryable: boolean;
  /** The photo itself is the problem; offer to retake instead of retrying. */
  retake: boolean;
  /** The session is gone; the user must sign in again. */
  signIn: boolean;
}

const base = { retryable: false, retake: false, signIn: false };

/**
 * @param status HTTP status, or null when the request never got a response (offline, DNS...).
 * @param code The `error` field of the function's JSON body, when there was one.
 */
export function friendlyAnalyzeError(status: number | null, code?: string | null): FriendlyError {
  if (status === null) {
    return {
      ...base,
      title: 'No connection',
      message: 'Could not reach the server. Check your connection and try again.',
      retryable: true,
    };
  }
  switch (status) {
    case 401:
      return {
        ...base,
        title: 'Signed out',
        message: 'Your session has expired. Sign in again to keep scanning.',
        signIn: true,
      };
    case 403:
    case 404:
      return {
        ...base,
        title: 'Photo not found',
        message: 'The photo did not finish uploading. Try again.',
        retryable: true,
      };
    case 413:
      return {
        ...base,
        title: 'Photo too large',
        message: 'That photo is too large to analyze. Retake it or pick a smaller one.',
        retake: true,
      };
    case 415:
      return {
        ...base,
        title: 'Unsupported photo',
        message: 'That image format is not supported. Use a JPEG, PNG or WebP photo.',
        retake: true,
      };
    case 422:
      return {
        ...base,
        title: 'Could not analyze',
        message:
          code === 'refused'
            ? 'The AI declined to analyze this photo. Try a clearer photo of just the meal.'
            : 'This photo could not be analyzed. Try another one.',
        retake: true,
      };
    case 429:
      return code === 'rate_limited'
        ? {
            ...base,
            title: 'Scan limit reached',
            message: "You've hit the hourly scan limit. Try again in a little while.",
          }
        : {
            ...base,
            title: 'AI is busy',
            message: 'The AI service is busy right now. Try again in a moment.',
            retryable: true,
          };
    case 502:
      return {
        ...base,
        title: 'Analysis failed',
        message: 'The AI returned an unusable result. Try again.',
        retryable: true,
      };
    case 503:
      return {
        ...base,
        title: 'AI unavailable',
        message: 'The AI service could not be reached. Try again shortly.',
        retryable: true,
      };
    case 400:
      return {
        ...base,
        title: 'Could not analyze',
        message: 'The request was invalid. Retake the photo and try again.',
        retake: true,
      };
    default:
      return {
        ...base,
        title: 'Something went wrong',
        message: 'An unexpected error occurred. Try again.',
        retryable: true,
      };
  }
}
