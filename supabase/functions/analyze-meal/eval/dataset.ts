/** The `dataset.json` schema, shared by `run.ts` and `fetch.ts`. */
import { z } from 'zod';

export const Dataset = z.array(
  z.object({
    /** File name under eval/photos/. */
    image: z.string().min(1),
    /** Ground-truth kcal; use 0 for non-food photos. */
    true_kcal: z.number().nonnegative(),
    /** Defaults to true. Set false for photos that do not show food. */
    is_food: z.boolean().optional(),
    /** Groups rows in the per-category breakdown, e.g. `mixed-plate`, `packaged`, `drink`. */
    category: z.string().min(1).optional(),
    /** Public URL `fetch.ts` downloads the photo from. Absent for your own photos. */
    source: z.url().optional(),
    /** Licence and attribution of a `source` photo. */
    license: z.string().optional(),
    notes: z.string().optional(),
  }),
);
export type Entry = z.infer<typeof Dataset>[number];
