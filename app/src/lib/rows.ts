import { Confidence, MealAnalysis, MEAL_TYPES } from '@calorie/shared';
import { z } from 'zod';

/**
 * Zod schemas for the rows the app reads (there are no generated Supabase types). PostgREST
 * returns `numeric` columns as JSON numbers, but coerce defensively in case they arrive as text.
 */

const num = z.coerce.number();

export const MealItemRecord = z.object({
  id: z.string(),
  name: z.string(),
  portion_desc: z.string().nullable(),
  grams: num.nullable(),
  kcal: num,
  protein_g: num.nullable(),
  carbs_g: num.nullable(),
  fat_g: num.nullable(),
  confidence: Confidence.nullable(),
  user_edited: z.boolean(),
});
export type MealItemRecord = z.infer<typeof MealItemRecord>;

export const MEAL_SELECT =
  'id, scan_id, eaten_at, meal_type, notes, meal_items(id, name, portion_desc, grams, kcal, protein_g, carbs_g, fat_g, confidence, user_edited), scans(image_path)';

export const MealRecord = z.object({
  id: z.string(),
  scan_id: z.string().nullable(),
  eaten_at: z.string(),
  meal_type: z.enum(MEAL_TYPES).nullable(),
  notes: z.string().nullable(),
  meal_items: z.array(MealItemRecord),
  scans: z.object({ image_path: z.string().nullable() }).nullable(),
});
export type MealRecord = z.infer<typeof MealRecord>;

export const ScanRecord = z.object({
  id: z.string(),
  image_path: z.string().nullable(),
  status: z.string(),
  raw_result: z.unknown(),
});

export type ScanDetails = {
  id: string;
  imagePath: string | null;
  status: string;
  /** The AI analysis stored in raw_result, when the scan completed. */
  analysis: MealAnalysis | null;
};

export function toScanDetails(row: z.infer<typeof ScanRecord>): ScanDetails {
  const raw = z.object({ analysis: z.unknown() }).safeParse(row.raw_result);
  const analysis = raw.success ? MealAnalysis.safeParse(raw.data.analysis) : null;
  return {
    id: row.id,
    imagePath: row.image_path,
    status: row.status,
    analysis: analysis?.success ? analysis.data : null,
  };
}

export const ProfileRecord = z.object({
  id: z.string(),
  daily_kcal_goal: num,
});
export type ProfileRecord = z.infer<typeof ProfileRecord>;

export const AnalyzeResponse = z.object({ scan_id: z.string(), analysis: MealAnalysis });
export type AnalyzeResponse = z.infer<typeof AnalyzeResponse>;
