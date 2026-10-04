import { describe, expect, it } from 'vitest';

import { MealAnalysis } from './analysis.ts';

const valid = {
  is_food: true,
  items: [
    {
      name: 'grilled chicken breast',
      portion_desc: '1 palm-sized fillet',
      estimated_grams: 150,
      kcal: 248,
      protein_g: 46.5,
      carbs_g: 0,
      fat_g: 5.4,
      confidence: 'high',
    },
    {
      name: 'white rice',
      portion_desc: '1 cup cooked',
      estimated_grams: 158,
      kcal: 205,
      protein_g: 4.3,
      carbs_g: 44.5,
      fat_g: 0.4,
      confidence: 'medium',
    },
  ],
  total_kcal: 453,
  notes: 'Assumed 1 tsp oil for grilling.',
};

describe('MealAnalysis', () => {
  it('parses a valid analysis', () => {
    const parsed = MealAnalysis.parse(valid);
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]?.confidence).toBe('high');
  });

  it('parses a non-food result with no items', () => {
    const result = MealAnalysis.safeParse({
      is_food: false,
      items: [],
      total_kcal: 0,
      notes: 'Image shows a keyboard.',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid analysis', () => {
    const result = MealAnalysis.safeParse({
      ...valid,
      items: [{ ...valid.items[0], confidence: 'very high', kcal: -10 }],
      total_kcal: '453',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toEqual(
        expect.arrayContaining(['items.0.kcal', 'items.0.confidence', 'total_kcal']),
      );
    }
  });
});
