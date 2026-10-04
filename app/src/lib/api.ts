import {
  base64ToBytes,
  friendlyAnalyzeError,
  type DayRange,
  type FriendlyError,
  type MealAnalysis,
  type MealItemRow,
  type MealType,
} from '@calorie/shared';
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import { z } from 'zod';

import type { PreparedPhoto } from '@/lib/image';
import {
  AnalyzeResponse,
  MEAL_SELECT,
  MealRecord,
  ProfileRecord,
  ScanRecord,
  toScanDetails,
  type ScanDetails,
} from '@/lib/rows';
import { supabase } from '@/lib/supabase';

export const PHOTO_BUCKET = 'meal-photos';

// ---------------------------------------------------------------------------------------------
// Analyze
// ---------------------------------------------------------------------------------------------

/** Progress of a photo scan, so a retry resumes instead of creating another `scans` row. */
export type PendingScan = { scanId: string; imagePath: string | null };

export type AnalyzeResult = {
  scanId: string;
  analysis: MealAnalysis;
  imagePath: string | null;
};

export class AnalyzeError extends Error {
  constructor(
    readonly friendly: FriendlyError,
    /** Set when a photo scan row exists; pass it back to `analyzeMeal` to retry. */
    readonly pending: PendingScan | null,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(friendly.message);
    this.name = 'AnalyzeError';
  }
}

const ErrorBody = z.object({ error: z.string() });

/** Reads the HTTP status and `error` code out of a functions.invoke error. */
async function describeInvokeError(
  error: unknown,
): Promise<{ status: number | null; code: string | null }> {
  if (error instanceof FunctionsHttpError) {
    const response: unknown = error.context;
    if (response instanceof Response) {
      let code: string | null = null;
      try {
        const body = ErrorBody.safeParse(await response.json());
        if (body.success) code = body.data.error;
      } catch {
        // Not JSON (e.g. a gateway error page); the status is enough.
      }
      return { status: response.status, code };
    }
    return { status: 500, code: null };
  }
  if (error instanceof FunctionsRelayError) return { status: 503, code: 'relay_error' };
  if (error instanceof FunctionsFetchError) return { status: null, code: 'fetch_error' };
  return { status: null, code: null };
}

async function invokeAnalyze(
  body: { scan_id: string; hint?: string } | { text: string },
  pending: PendingScan | null,
): Promise<AnalyzeResponse> {
  const { data, error } = await supabase.functions.invoke<unknown>('analyze-meal', { body });
  if (error) {
    const { status, code } = await describeInvokeError(error);
    throw new AnalyzeError(friendlyAnalyzeError(status, code), pending, status, code);
  }
  const parsed = AnalyzeResponse.safeParse(data);
  if (!parsed.success) {
    throw new AnalyzeError(friendlyAnalyzeError(502, 'invalid_response'), pending, 502, null);
  }
  return parsed.data;
}

const uploadFailed = (pending: PendingScan | null) =>
  new AnalyzeError(
    {
      title: 'Upload failed',
      message: 'The photo could not be uploaded. Check your connection and try again.',
      retryable: true,
      retake: false,
      signIn: false,
    },
    pending,
    null,
    'upload_failed',
  );

async function currentUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) throw new AnalyzeError(friendlyAnalyzeError(401), null, 401, 'unauthorized');
  return userId;
}

/**
 * Photo flow: insert a `scans` row → upload to `meal-photos/{user_id}/{scan_id}.jpg` → set
 * `image_path` → invoke `analyze-meal`. Pass `resume` (from a thrown AnalyzeError's `pending`) to
 * retry without creating another scan. Only `image_path` is ever written to a scan row; the
 * function owns status, raw_result and model.
 */
export async function analyzeMeal(
  photo: PreparedPhoto,
  hint: string | undefined,
  resume?: PendingScan | null,
): Promise<AnalyzeResult> {
  const userId = await currentUserId();

  let pending: PendingScan | null = resume ?? null;
  if (!pending) {
    const { data, error } = await supabase
      .from('scans')
      .insert({ image_path: null })
      .select('id')
      .single();
    const row = z.object({ id: z.string() }).safeParse(data);
    if (error || !row.success) throw uploadFailed(null);
    pending = { scanId: row.data.id, imagePath: null };
  }

  if (!pending.imagePath) {
    const path = `${userId}/${pending.scanId}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, base64ToBytes(photo.base64), { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw uploadFailed(pending);

    const { error: updateError } = await supabase
      .from('scans')
      .update({ image_path: path })
      .eq('id', pending.scanId);
    if (updateError) throw uploadFailed(pending);
    pending = { ...pending, imagePath: path };
  }

  const trimmedHint = hint?.trim();
  let result: AnalyzeResponse;
  try {
    result = await invokeAnalyze(
      { scan_id: pending.scanId, ...(trimmedHint ? { hint: trimmedHint } : {}) },
      pending,
    );
  } catch (err) {
    // The stored photo is gone, so a retry must upload it again rather than reuse imagePath.
    if (err instanceof AnalyzeError && err.code === 'image_not_found') {
      throw new AnalyzeError(
        err.friendly,
        { scanId: pending.scanId, imagePath: null },
        err.status,
        err.code,
      );
    }
    throw err;
  }
  return { scanId: result.scan_id, analysis: result.analysis, imagePath: pending.imagePath };
}

/** Manual entry: the function creates the scan row itself. */
export async function analyzeText(text: string): Promise<AnalyzeResult> {
  const result = await invokeAnalyze({ text: text.trim() }, null);
  return { scanId: result.scan_id, analysis: result.analysis, imagePath: null };
}

export async function fetchScan(scanId: string): Promise<ScanDetails | null> {
  const { data, error } = await supabase
    .from('scans')
    .select('id, image_path, status, raw_result')
    .eq('id', scanId)
    .maybeSingle();
  if (error) throw error;
  return data ? toScanDetails(ScanRecord.parse(data)) : null;
}

// ---------------------------------------------------------------------------------------------
// Meals
// ---------------------------------------------------------------------------------------------

/** Meals with `eaten_at` in [range.start, range.end), newest first. */
export async function fetchMealsInRange(range: DayRange): Promise<MealRecord[]> {
  const { data, error } = await supabase
    .from('meals')
    .select(MEAL_SELECT)
    .gte('eaten_at', range.start.toISOString())
    .lt('eaten_at', range.end.toISOString())
    .order('eaten_at', { ascending: false });
  if (error) throw error;
  return z.array(MealRecord).parse(data);
}

export async function fetchMeal(mealId: string): Promise<MealRecord | null> {
  const { data, error } = await supabase
    .from('meals')
    .select(MEAL_SELECT)
    .eq('id', mealId)
    .maybeSingle();
  if (error) throw error;
  return data ? MealRecord.parse(data) : null;
}

export type SaveMealInput = {
  /** Set when editing an existing meal. */
  mealId: string | null;
  scanId: string | null;
  mealType: MealType;
  items: MealItemRow[];
  /** meal_items ids that were in the saved meal and have been deleted in the editor. */
  removedItemIds: string[];
};

/**
 * Inserts (or updates) a meal and its items. Not transactional: items are written before the
 * removed ones are deleted, so a mid-way failure can leave extra rows but never loses data.
 */
export async function saveMeal(input: SaveMealInput): Promise<string> {
  let mealId = input.mealId;
  if (mealId) {
    const { error } = await supabase
      .from('meals')
      .update({ meal_type: input.mealType })
      .eq('id', mealId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from('meals')
      .insert({ scan_id: input.scanId, meal_type: input.mealType })
      .select('id')
      .single();
    if (error) throw error;
    mealId = z.object({ id: z.string() }).parse(data).id;
  }

  const rows = input.items.map((item) => ({ ...item, meal_id: mealId }));
  const existing = rows.filter((r) => r.id);
  const added = rows.filter((r) => !r.id);
  if (existing.length) {
    const { error } = await supabase.from('meal_items').upsert(existing);
    if (error) throw error;
  }
  if (added.length) {
    const { error } = await supabase.from('meal_items').insert(added);
    if (error) throw error;
  }
  if (input.removedItemIds.length) {
    const { error } = await supabase.from('meal_items').delete().in('id', input.removedItemIds);
    if (error) throw error;
  }
  return mealId;
}

/** Deletes a meal; its meal_items cascade. The scan row and photo stay (audit trail). */
export async function deleteMeal(mealId: string): Promise<void> {
  const { error } = await supabase.from('meals').delete().eq('id', mealId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------------------------

const SIGNED_URL_TTL_SECONDS = 60 * 60;

/** Signed URLs for private `meal-photos` objects, keyed by path (missing paths are omitted). */
export async function createSignedUrls(paths: readonly string[]): Promise<Record<string, string>> {
  if (paths.length === 0) return {};
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls([...paths], SIGNED_URL_TTL_SECONDS);
  if (error) throw error;
  const urls: Record<string, string> = {};
  for (const entry of data) {
    if (entry.path && entry.signedUrl && !entry.error) urls[entry.path] = entry.signedUrl;
  }
  return urls;
}

// ---------------------------------------------------------------------------------------------
// Profile and account
// ---------------------------------------------------------------------------------------------

export async function fetchProfile(userId: string): Promise<ProfileRecord> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, daily_kcal_goal')
    .eq('id', userId)
    .single();
  if (error) throw error;
  return ProfileRecord.parse(data);
}

export async function updateKcalGoal(userId: string, goal: number): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({ daily_kcal_goal: goal })
    .eq('id', userId);
  if (error) throw error;
}

export class DeleteAccountError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'DeleteAccountError';
  }
}

const DeleteAccountResponse = z.object({ deleted: z.literal(true) });

/** User-facing message for a failed `delete-account` call. */
function deleteAccountMessage(status: number | null, code: string | null): string {
  if (code === 'fetch_error' || code === 'relay_error') {
    return 'Could not reach the server. Check your connection and try again.';
  }
  if (status === 401) return 'Your session has expired. Sign in again, then retry.';
  return 'Your account was not deleted. Try again in a moment.';
}

/**
 * Permanently deletes the signed-in user via the `delete-account` Edge Function: their photos,
 * then the auth user (profile, scans and meals cascade). Throws `DeleteAccountError` on failure;
 * the caller signs out on success.
 */
export async function deleteAccount(): Promise<void> {
  const { data, error } = await supabase.functions.invoke<unknown>('delete-account', {
    body: { confirm: 'DELETE' },
  });
  if (error) {
    const { status, code } = await describeInvokeError(error);
    throw new DeleteAccountError(deleteAccountMessage(status, code), status, code);
  }
  if (!DeleteAccountResponse.safeParse(data).success) {
    throw new DeleteAccountError(deleteAccountMessage(502, 'invalid_response'), 502, null);
  }
}
