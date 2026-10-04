import type { SupabaseClient } from '@supabase/supabase-js';
import { encodeBase64 } from '@std/encoding/base64';
import { z } from 'zod';
import { MealAnalysis } from '@calorie/shared';
import {
  analyzeWithClaude,
  type AnalyzeInput,
  type AnalyzeOutcome,
  type Effort,
  type MessagesClient,
} from './claude.ts';
import { describeAnthropicError, mapAnthropicError } from './errors.ts';
import { detectImageType, MAX_IMAGE_BYTES } from './image.ts';

export const BUCKET = 'meal-photos';

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((s) => (s ? s : undefined));

/** `{ scan_id, hint? }` analyses an uploaded photo; `{ text }` is the manual-entry path. */
const ScanBody = z.strictObject({ scan_id: z.uuid(), hint: optionalText(500) });
const TextBody = z.strictObject({ text: z.string().trim().min(1).max(1000) });
export const RequestBody = z.union([ScanBody, TextBody]);

export interface HandlerConfig {
  /**
   * Max analysis attempts (model calls, retries included) per user per rolling hour
   * (SCAN_RATE_LIMIT_PER_HOUR). Enforced by the claim_analysis RPC.
   */
  rateLimitPerHour: number;
  /** output_config.effort (ANALYZE_EFFORT). */
  effort: Effort;
}

export interface HandlerDeps {
  anthropic: MessagesClient;
  /**
   * supabase-js client acting as the caller (their JWT in the Authorization header), so RLS
   * applies. Used to resolve the user, load the scan (proving ownership) and create text-entry
   * scans.
   */
  createUserClient(authHeader: string): SupabaseClient;
  /**
   * Service-role client (bypasses RLS). Used to claim an analysis attempt (claim_analysis RPC:
   * rate limit + in-flight dedupe), download the photo from Storage, and record status /
   * raw_result / model, which users cannot write (see supabase/migrations/
   * 20261005000000_harden_scans.sql and 20261006000000_scan_attempts.sql). Every call on it is
   * scoped to the caller's user_id.
   */
  createAdminClient(): SupabaseClient;
  config: HandlerConfig;
}

function json(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return json(status, { error: code, message, ...extra });
}

type ScanStatus = 'complete' | 'failed' | 'refused';

/**
 * How long a 'processing' claim blocks duplicates before it may be reclaimed. Above the worst-case
 * Claude call (two 60 s attempts in index.ts) and below a stuck scan being noticeable, so a
 * function killed mid-call frees its scan quickly. Keep the model timeout under the Edge Function
 * wall-clock limit (150 s on the free plan).
 */
export const CLAIM_STALE_AFTER = '3 minutes';

/** Results of public.claim_analysis() (supabase/migrations/20261006000000_scan_attempts.sql). */
const CLAIM_RESULTS = ['claimed', 'busy', 'rate_limited', 'complete', 'not_found'] as const;
type ClaimResult = (typeof CLAIM_RESULTS)[number];

function isClaimResult(value: unknown): value is ClaimResult {
  return typeof value === 'string' && (CLAIM_RESULTS as readonly string[]).includes(value);
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: CORS_HEADERS });
    }
    if (req.method !== 'POST') {
      return errorResponse(405, 'method_not_allowed', 'Use POST.', {});
    }

    // --- Auth: resolve the caller from their JWT -------------------------------------------
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = /^Bearer\s+(\S+)$/i.exec(authHeader)?.[1];
    if (!token) {
      return errorResponse(401, 'unauthorized', 'Missing bearer token.');
    }
    const db = deps.createUserClient(authHeader);
    const { data: userData, error: authError } = await db.auth.getUser(token);
    const user = userData?.user;
    if (authError || !user) {
      return errorResponse(401, 'unauthorized', 'Invalid or expired token.');
    }
    const admin = deps.createAdminClient();

    // --- Body ----------------------------------------------------------------------------------
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse(400, 'invalid_body', 'Body must be JSON.');
    }
    const body = RequestBody.safeParse(rawBody);
    if (!body.success) {
      return errorResponse(400, 'invalid_body', 'Expected { scan_id, hint? } or { text }.', {
        issues: body.error.issues,
      });
    }

    // --- Scan mode: load the row through RLS (proves ownership) --------------------------------
    let scanId: string;
    let imagePath: string | null = null;
    let textInput: AnalyzeInput | null = null;
    if ('scan_id' in body.data) {
      const { data: scan, error } = await db
        .from('scans')
        .select('id, image_path, status, raw_result')
        .eq('id', body.data.scan_id)
        .maybeSingle();
      if (error) {
        console.error('scan lookup failed', error);
        return errorResponse(500, 'internal', 'Could not load the scan.');
      }
      if (!scan) {
        return errorResponse(404, 'scan_not_found', 'Scan not found.');
      }
      scanId = scan.id;

      // Idempotent retry: a completed scan returns its stored result without a new AI call.
      if (scan.status === 'complete') {
        const stored = MealAnalysis.safeParse(scan.raw_result?.analysis);
        if (stored.success) {
          return json(200, { scan_id: scanId, analysis: stored.data });
        }
      }

      imagePath = scan.image_path;
      if (!imagePath) {
        return errorResponse(400, 'no_image', 'This scan has no photo; use { text } instead.');
      }
      // The photo is downloaded with the service role (bypassing Storage RLS), and image_path is
      // user-writable, so confine it to the caller's own folder.
      if (!imagePath.startsWith(`${user.id}/`) || imagePath.split('/').includes('..')) {
        return errorResponse(403, 'forbidden_path', 'Scan photo is outside your folder.');
      }
    } else {
      // Text-only entries still get a scans row: it is the audit trail, and the claim below needs
      // it. The database forces status = 'pending' and created_at = now() on client inserts.
      const { data: created, error } = await db
        .from('scans')
        .insert({ user_id: user.id, image_path: null })
        .select('id')
        .single();
      if (error || !created) {
        console.error('scan insert failed', error);
        return errorResponse(500, 'internal', 'Could not record the entry.');
      }
      scanId = created.id;
      textInput = { kind: 'text', text: body.data.text };
    }

    // --- Build the model input (before the claim) ----------------------------------------------
    // A missing, oversize or unsupported photo is rejected here, before an attempt is counted: it
    // never reaches the model, so retrying it must not eat into the hourly limit. These rejections
    // leave the scan as it was (not written 'failed'), so they cannot clobber a concurrent
    // attempt's status; the client can re-upload and retry.
    let input: AnalyzeInput;
    try {
      if (textInput) {
        input = textInput;
      } else {
        const { data: blob, error } = await admin.storage.from(BUCKET).download(imagePath!);
        if (error || !blob) {
          console.error('photo download failed', error);
          return errorResponse(404, 'image_not_found', 'The scan photo could not be found.', {
            scan_id: scanId,
          });
        }
        if (blob.size > MAX_IMAGE_BYTES) {
          return errorResponse(413, 'image_too_large', 'Photo is larger than 5 MB.', {
            scan_id: scanId,
          });
        }
        const bytes = new Uint8Array(await blob.arrayBuffer());
        const mediaType = detectImageType(bytes, imagePath!);
        if (mediaType === 'image/heic') {
          return errorResponse(
            415,
            'unsupported_image_type',
            'HEIC photos are not supported. Convert to JPEG before uploading.',
            { scan_id: scanId },
          );
        }
        if (!mediaType) {
          return errorResponse(415, 'unsupported_image_type', 'Photo must be JPEG, PNG or WebP.', {
            scan_id: scanId,
          });
        }
        const hint = 'hint' in body.data ? body.data.hint : undefined;
        input = { kind: 'image', mediaType, base64: encodeBase64(bytes), hint };
      }
    } catch (err) {
      console.error('unexpected error loading the photo', err);
      return errorResponse(500, 'internal', 'Unexpected error.', { scan_id: scanId });
    }

    // Users may only update image_path, so results are recorded with the service role, scoped to
    // the caller's own row. Never throws: a failed write is logged, and the stale-claim timeout in
    // claim_analysis() is the backstop for a scan left in 'processing'.
    let finalised = false;
    const saveScan = async (status: ScanStatus, rawResult: unknown, model: string | null) => {
      finalised = true;
      try {
        const { error } = await admin
          .from('scans')
          .update({ status, raw_result: rawResult, model })
          .eq('id', scanId)
          .eq('user_id', user.id);
        // The analysis is still returned: the user should not lose a result they already paid for.
        if (error) console.error('scan update failed', { scanId, error });
      } catch (err) {
        console.error('scan update threw', { scanId, err });
      }
    };

    // --- Claim one analysis attempt (rate limit + in-flight dedupe) ----------------------------
    // claim_analysis() runs in one transaction, serialised per user: it refuses a scan another
    // request is already analysing, counts this user's attempts (retries included) in the last
    // hour, and otherwise records an attempt and marks the scan 'processing'. See
    // supabase/migrations/20261006000000_scan_attempts.sql. Service role only.
    const { data: claim, error: claimError } = await admin.rpc('claim_analysis', {
      p_user: user.id,
      p_scan: scanId,
      p_limit: deps.config.rateLimitPerHour,
      // Longer than the worst-case Claude call (two 60 s attempts in index.ts), so a slow
      // request is never treated as stale and reclaimed by a duplicate.
      p_stale: CLAIM_STALE_AFTER,
    });
    if (claimError || !isClaimResult(claim)) {
      console.error('claim_analysis failed', claimError ?? { claim });
      // A text scan created above would otherwise stay 'pending' forever.
      if (textInput) await saveScan('failed', { error: 'claim_failed' }, null);
      return errorResponse(500, 'internal', 'Could not check the rate limit.');
    }
    switch (claim) {
      case 'claimed':
        break;
      case 'rate_limited':
        if (textInput) await saveScan('failed', { error: 'rate_limited' }, null);
        return errorResponse(
          429,
          'rate_limited',
          `Limit of ${deps.config.rateLimitPerHour} analyses per hour reached. Try again later.`,
        );
      case 'busy':
        return errorResponse(
          409,
          'analysis_in_progress',
          'This scan is already being analysed. Try again in a moment.',
          { scan_id: scanId },
        );
      case 'not_found':
        return errorResponse(404, 'scan_not_found', 'Scan not found.');
      case 'complete': {
        // Another request finished this scan after we loaded it: return its stored result.
        const { data: done } = await admin
          .from('scans')
          .select('raw_result')
          .eq('id', scanId)
          .eq('user_id', user.id)
          .maybeSingle();
        const stored = MealAnalysis.safeParse(done?.raw_result?.analysis);
        if (stored.success) {
          return json(200, { scan_id: scanId, analysis: stored.data });
        }
        console.error('complete scan has no readable analysis', { scanId });
        return errorResponse(500, 'internal', 'Could not load the stored result.');
      }
    }

    // --- Claimed: every path from here must write a final status -------------------------------
    // Failures after the model call record their own status; anything else (an unexpected
    // exception, or a path that forgot to) is caught by the finally block and recorded as failed.
    const analyse = async (): Promise<Response> => {
      // --- Call Claude ----------------------------------------------------------------------
      let outcome: AnalyzeOutcome;
      try {
        outcome = await analyzeWithClaude(deps.anthropic, input, { effort: deps.config.effort });
      } catch (err) {
        await saveScan('failed', { error: describeAnthropicError(err) }, null);
        const mapped = mapAnthropicError(err);
        if (mapped) {
          console.error('anthropic error', describeAnthropicError(err));
          return errorResponse(mapped.status, mapped.code, mapped.message, { scan_id: scanId });
        }
        console.error('unexpected error calling Claude', err);
        return errorResponse(500, 'internal', 'Unexpected error.', { scan_id: scanId });
      }

      const { message, model } = outcome;
      console.log(
        JSON.stringify({
          event: 'analyze_meal',
          scan_id: scanId,
          outcome: outcome.kind,
          model,
          stop_reason: message.stop_reason,
          usage: message.usage,
        }),
      );

      switch (outcome.kind) {
        case 'ok':
          await saveScan('complete', { response: message, analysis: outcome.analysis }, model);
          return json(200, { scan_id: scanId, analysis: outcome.analysis });
        case 'refused':
          await saveScan('refused', { response: message, error: 'refusal' }, model);
          return errorResponse(422, 'refused', 'The AI declined to analyze this request.', {
            scan_id: scanId,
            category: outcome.category,
          });
        case 'truncated':
          await saveScan('failed', { response: message, error: 'max_tokens' }, model);
          return errorResponse(502, 'output_truncated', 'The AI response was cut off.', {
            scan_id: scanId,
          });
        case 'invalid_output':
          await saveScan('failed', { response: message, error: outcome.error }, model);
          return errorResponse(502, 'invalid_output', 'The AI returned an unreadable result.', {
            scan_id: scanId,
          });
      }
    };

    try {
      return await analyse();
    } catch (err) {
      console.error('unexpected error during analysis', err);
      return errorResponse(500, 'internal', 'Unexpected error.', { scan_id: scanId });
    } finally {
      if (!finalised) await saveScan('failed', { error: 'internal' }, null);
    }
  };
}
