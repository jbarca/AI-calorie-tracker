/** The `dataset.json` schema, shared by `run.ts` and `fetch.ts`. */
import { z } from 'zod';

/** Hosts `fetch.ts` may download from; keep in step with `--allow-net` in deno.json. */
export const SOURCE_HOSTS = [
  'storage.googleapis.com',
  'openfoodfacts-images.s3.eu-west-3.amazonaws.com',
  'raw.githubusercontent.com',
];

export const Dataset = z.array(
  z.object({
    /** File name under eval/photos/. */
    image: z
      .string()
      .min(1)
      .regex(/^[^/\\]+$/, 'image must be a plain file name, not a path'),
    /** Ground-truth kcal; use 0 for non-food photos. */
    true_kcal: z.number().nonnegative(),
    /** Defaults to true. Set false for photos that do not show food. */
    is_food: z.boolean().optional(),
    /** Groups rows in the per-category breakdown, e.g. `mixed-plate`, `packaged`, `drink`. */
    category: z.string().min(1).optional(),
    /** Public URL `fetch.ts` downloads the photo from. Absent for your own photos. */
    source: z
      .url()
      .refine((u) => SOURCE_HOSTS.includes(new URL(u).hostname), {
        message: `source host must be one of ${SOURCE_HOSTS.join(', ')}`,
      })
      .optional(),
    /** Licence and attribution of a `source` photo. */
    license: z.string().optional(),
    notes: z.string().optional(),
  }),
);
/** Rejects a dataset in which two entries use the same `image` name. */
export function duplicateImages(entries: readonly { image: string }[]): string[] {
  const seen = new Set<string>();
  const dupes = new Set<string>();
  for (const { image } of entries) {
    if (seen.has(image)) dupes.add(image);
    seen.add(image);
  }
  return [...dupes];
}

export type Entry = z.infer<typeof Dataset>[number];
