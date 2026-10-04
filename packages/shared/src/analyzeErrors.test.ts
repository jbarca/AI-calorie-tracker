import { describe, expect, it } from 'vitest';

import { friendlyAnalyzeError } from './analyzeErrors.ts';

describe('friendlyAnalyzeError', () => {
  it('treats network failures as retryable', () => {
    expect(friendlyAnalyzeError(null)).toMatchObject({ title: 'No connection', retryable: true });
  });

  it.each([
    [401, 'unauthorized', { signIn: true, retryable: false }],
    [404, 'image_not_found', { retryable: true }],
    [404, 'scan_not_found', { retake: true, retryable: false }],
    [403, 'forbidden_path', { retake: true, retryable: false }],
    [409, 'analysis_in_progress', { retryable: true, retake: false }],
    [413, 'image_too_large', { retake: true, retryable: false }],
    [415, 'unsupported_image_type', { retake: true }],
    [422, 'refused', { retake: true, retryable: false }],
    [429, 'rate_limited', { retryable: false }],
    [429, 'upstream_rate_limited', { retryable: true }],
    [502, 'invalid_output', { retryable: true }],
    [503, 'upstream_timeout', { retryable: true }],
    [500, 'internal', { retryable: true }],
  ] as const)('%i %s', (status, code, expected) => {
    expect(friendlyAnalyzeError(status, code)).toMatchObject(expected);
  });

  it('asks the user to wait for 409 analysis_in_progress', () => {
    expect(friendlyAnalyzeError(409, 'analysis_in_progress')).toMatchObject({
      title: 'Still analysing',
      message: 'Still analysing this meal — please wait a moment.',
    });
  });

  it('falls back sensibly for statuses and codes it does not know', () => {
    expect(friendlyAnalyzeError(400, 'invalid_body')).toMatchObject({ retake: true });
    expect(friendlyAnalyzeError(404)).toMatchObject({ retake: true, retryable: false });
    expect(friendlyAnalyzeError(502, 'upstream_error')).toMatchObject({ retryable: true });
    expect(friendlyAnalyzeError(418)).toMatchObject({ retryable: true });
    expect(friendlyAnalyzeError(null)).toMatchObject({ title: 'No connection', retryable: true });
  });

  it('mentions the refusal for 422 refused', () => {
    expect(friendlyAnalyzeError(422, 'refused').message).toMatch(/declined/);
  });
});
