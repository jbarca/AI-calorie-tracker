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
  /** Max analyses per user per rolling hour (SCAN_RATE_LIMIT_PER_HOUR). */
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
   * Service-role client (bypasses RLS). Used to download the photo from Storage, count recent
   * scans for the rate limit, and record status / raw_result / model, which users cannot write
   * (see supabase/migrations/20261005000000_harden_scans.sql). Every scans query on it is scoped
   * to the caller's user_id.
   */
  createAdminClient(): SupabaseClient;
  config: HandlerConfig;
  now?: () => Date;
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

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => new Date());

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
      scanId = ''; // assigned after the rate-limit check, when the row is created
    }

    // --- Rate limit: analyses in the last hour, not counting this scan -------------------------
    // Counted with the service role so that nothing the user can do through RLS (or a future
    // policy change) hides rows from the count. Users cannot delete scans or change created_at.
    const since = new Date(now().getTime() - 60 * 60 * 1000).toISOString();
    let countQuery = admin
      .from('scans')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .gte('created_at', since);
    if (scanId) countQuery = countQuery.neq('id', scanId);
    const { count, error: countError } = await countQuery;
    if (countError) {
      console.error('rate-limit count failed', countError);
      return errorResponse(500, 'internal', 'Could not check the rate limit.');
    }
    if ((count ?? 0) >= deps.config.rateLimitPerHour) {
      return errorResponse(
        429,
        'rate_limited',
        `Limit of ${deps.config.rateLimitPerHour} analyses per hour reached. Try again later.`,
      );
    }

    // --- Build the model input --------------------------------------------------------------
    let input: AnalyzeInput;
    if ('scan_id' in body.data) {
      const { data: blob, error } = await admin.storage.from(BUCKET).download(imagePath!);
      if (error || !blob) {
        console.error('photo download failed', error);
        return errorResponse(404, 'image_not_found', 'The scan photo could not be found.');
      }
      if (blob.size > MAX_IMAGE_BYTES) {
        return errorResponse(413, 'image_too_large', 'Photo is larger than 5 MB.');
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const mediaType = detectImageType(bytes, imagePath!);
      if (mediaType === 'image/heic') {
        return errorResponse(
          415,
          'unsupported_image_type',
          'HEIC photos are not supported. Convert to JPEG before uploading.',
        );
      }
      if (!mediaType) {
        return errorResponse(415, 'unsupported_image_type', 'Photo must be JPEG, PNG or WebP.');
      }
      input = { kind: 'image', mediaType, base64: encodeBase64(bytes), hint: body.data.hint };
    } else {
      // Text-only entries still get a scans row: it is the audit trail and the rate-limit counter.
      // The database forces status = 'pending' and created_at = now() on client inserts.
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
      input = { kind: 'text', text: body.data.text };
    }

    // Users may only update image_path, so results are recorded with the service role, scoped to
    // the caller's own row.
    const saveScan = async (status: ScanStatus, rawResult: unknown, model: string | null) => {
      const { error } = await admin
        .from('scans')
        .update({ status, raw_result: rawResult, model })
        .eq('id', scanId)
        .eq('user_id', user.id);
      // The analysis is still returned: the user should not lose a result they already paid for.
      if (error) console.error('scan update failed', { scanId, error });
    };

    // --- Call Claude ------------------------------------------------------------------------
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
}
