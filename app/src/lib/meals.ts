import { sumMacros, type Macros } from '@calorie/shared';

import type { MealRecord } from '@/lib/rows';

/** kcal and macro totals for one saved meal. */
export function mealTotals(meal: MealRecord): Macros {
  return sumMacros(
    meal.meal_items.map((i) => ({
      kcal: i.kcal,
      protein_g: i.protein_g ?? 0,
      carbs_g: i.carbs_g ?? 0,
      fat_g: i.fat_g ?? 0,
    })),
  );
}

/** Route to the review editor for a saved meal. */
export function mealEditorHref(meal: Pick<MealRecord, 'id' | 'scan_id'>) {
  return {
    pathname: '/review/[scanId]' as const,
    params: { scanId: meal.scan_id ?? 'none', mealId: meal.id },
  };
}
