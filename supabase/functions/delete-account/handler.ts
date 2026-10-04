import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const BUCKET = 'meal-photos';
/** Objects listed (and removed) per Storage call. */
export const PAGE_SIZE = 100;
/** Cap on Storage list calls per request, so a remove that silently does nothing can't loop forever. */
export const MAX_LIST_CALLS = 1000;

// Copied from analyze-meal/handler.ts; a later step may move these into _shared.
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

/** The client must send exactly `{ confirm: "DELETE" }`, so a stray call can't delete an account. */
export const RequestBody = z.strictObject({ confirm: z.literal('DELETE') });

export interface HandlerDeps {
  /** supabase-js client acting as the caller (their JWT); used only to resolve the user. */
  createUserClient(authHeader: string): SupabaseClient;
  /**
   * Service-role client (bypasses RLS). Removes the caller's `meal-photos/{user_id}/` objects,
   * which don't cascade from auth.users, then deletes the auth user (rows cascade).
   */
  createAdminClient(): SupabaseClient;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
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

class StorageStepError extends Error {}

/**
 * Removes every object under `folder` (recursing into sub-folders). Always re-lists from offset 0,
 * because removing a page shifts the rest forward. Returns the number of objects removed.
 */
async function emptyFolder(
  admin: SupabaseClient,
  folder: string,
  budget: { listCalls: number },
): Promise<number> {
  let removed = 0;
  for (;;) {
    if (budget.listCalls >= MAX_LIST_CALLS) {
      throw new StorageStepError(`gave up after ${MAX_LIST_CALLS} list calls`);
    }
    budget.listCalls++;
    const { data, error } = await admin.storage
      .from(BUCKET)
      .list(folder, { limit: PAGE_SIZE, offset: 0 });
    if (error) throw new StorageStepError(`list failed: ${error.message}`);
    if (!data || data.length === 0) return removed;

    const files: string[] = [];
    for (const entry of data) {
      const path = `${folder}/${entry.name}`;
      // Storage reports sub-folders (path prefixes) as entries with a null id.
      if (!entry.id) removed += await emptyFolder(admin, path, budget);
      else files.push(path);
    }
    if (files.length > 0) {
      const { error: removeError } = await admin.storage.from(BUCKET).remove(files);
      if (removeError) throw new StorageStepError(`remove failed: ${removeError.message}`);
      removed += files.length;
    }
  }
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: CORS_HEADERS });
    }
    if (req.method !== 'POST') {
      return errorResponse(405, 'method_not_allowed', 'Use POST.');
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

    // --- Body ----------------------------------------------------------------------------------
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse(400, 'invalid_body', 'Body must be JSON.');
    }
    if (!RequestBody.safeParse(rawBody).success) {
      return errorResponse(400, 'invalid_body', 'Expected { confirm: "DELETE" }.');
    }

    const admin = deps.createAdminClient();
    const log = (outcome: string, extra: Record<string, unknown> = {}) =>
      console.log(JSON.stringify({ event: 'delete_account', user_id: user.id, outcome, ...extra }));

    // --- Photos first: if this fails the user still exists, so a retry is safe ------------------
    let photosRemoved: number;
    try {
      photosRemoved = await emptyFolder(admin, user.id, { listCalls: 0 });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log('storage_failed', { reason });
      return errorResponse(500, 'storage_failed', 'Could not delete your photos. Try again.');
    }

    // --- Then the auth user; profiles, scans, meals, ... cascade -------------------------------
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      log('delete_user_failed', { photos_removed: photosRemoved, reason: deleteError.message });
      return errorResponse(500, 'delete_failed', 'Could not delete your account. Try again.');
    }

    log('deleted', { photos_removed: photosRemoved });
    return json(200, { deleted: true });
  };
}
