import { describe, expect, it } from 'vitest';

import type { MealItem } from './analysis.ts';
import {
  defaultMealType,
  draftFromAnalysisItem,
  draftFromManualInput,
  draftFromSavedItem,
  draftReducer,
  isUserEdited,
  parseKcalGoal,
  perGramFrom,
  scaleToGrams,
  sumMacros,
  toMealItemRow,
  validateDraft,
  withGrams,
} from './nutrition.ts';

const rice: MealItem = {
  name: 'white rice',
  portion_desc: '1 cup cooked',
  estimated_grams: 158,
  kcal: 205,
  protein_g: 4.3,
  carbs_g: 44.5,
  fat_g: 0.4,
  confidence: 'medium',
};

describe('perGramFrom / scaleToGrams', () => {
  it('derives per-gram values and rescales proportionally', () => {
    const per = perGramFrom({ ...rice, grams: rice.estimated_grams });
    expect(per).not.toBeNull();
    expect(scaleToGrams(per!, 316)).toEqual({ kcal: 410, protein_g: 8.6, carbs_g: 89, fat_g: 0.8 });
    expect(scaleToGrams(per!, 79)).toEqual({
      kcal: 103,
      protein_g: 2.2,
      carbs_g: 22.3,
      fat_g: 0.2,
    });
  });

  it('returns null for zero or negative grams', () => {
    expect(perGramFrom({ grams: 0, kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1 })).toBeNull();
    expect(perGramFrom({ grams: -5, kcal: 100, protein_g: 1, carbs_g: 1, fat_g: 1 })).toBeNull();
  });

  it('clamps negative grams to zero', () => {
    expect(scaleToGrams({ kcal: 2, protein_g: 1, carbs_g: 1, fat_g: 1 }, -10).kcal).toBe(0);
  });
});

describe('withGrams', () => {
  it('rescales from the original per-gram values without drift', () => {
    let item = draftFromAnalysisItem(rice, 'a');
    for (let i = 0; i < 25; i++) item = withGrams(item, item.grams + 7);
    for (let i = 0; i < 25; i++) item = withGrams(item, item.grams - 7);
    expect(item.grams).toBe(158);
    expect(item.kcal).toBe(205);
    expect(item.carbs_g).toBe(44.5);
  });

  it('can go to zero and back', () => {
    const item = draftFromAnalysisItem(rice, 'a');
    const zero = withGrams(item, 0);
    expect(zero.kcal).toBe(0);
    expect(withGrams(zero, 158).kcal).toBe(205);
  });

  it('keeps absolute values when there is no per-gram basis', () => {
    const item = draftFromManualInput(
      { name: 'sauce', grams: 0, kcal: 50, protein_g: 0, carbs_g: 5, fat_g: 3 },
      'm',
    );
    expect(item.perGram).toBeNull();
    const changed = withGrams(item, 20);
    expect(changed.grams).toBe(20);
    expect(changed.kcal).toBe(50);
  });
});

describe('isUserEdited / toMealItemRow', () => {
  it('flags only rows that changed', () => {
    const item = draftFromAnalysisItem(rice, 'a');
    expect(isUserEdited(item)).toBe(false);
    expect(isUserEdited({ ...item, name: '  white rice ' })).toBe(false);
    expect(isUserEdited({ ...item, name: 'brown rice' })).toBe(true);
    expect(isUserEdited(withGrams(item, 200))).toBe(true);
    expect(isUserEdited(withGrams(withGrams(item, 200), 158))).toBe(false);
  });

  it('treats manual rows and previously edited rows as edited', () => {
    const manual = draftFromManualInput(
      { name: 'apple', grams: 150, kcal: 78, protein_g: 0.4, carbs_g: 21, fat_g: 0.3 },
      'm',
    );
    expect(isUserEdited(manual)).toBe(true);
    const saved = draftFromSavedItem({
      id: 'x',
      name: 'apple',
      portion_desc: null,
      grams: 150,
      kcal: 78,
      protein_g: null,
      carbs_g: 21,
      fat_g: 0.3,
      confidence: 'high',
      user_edited: true,
    });
    expect(isUserEdited(saved)).toBe(true);
    expect(saved.protein_g).toBe(0);
  });

  it('builds DB rows with ids only for saved items', () => {
    const fresh = toMealItemRow(draftFromAnalysisItem(rice, 'a'));
    expect(fresh).not.toHaveProperty('id');
    expect(fresh).toMatchObject({
      grams: 158,
      kcal: 205,
      confidence: 'medium',
      user_edited: false,
    });
    const saved = toMealItemRow(
      draftFromSavedItem({
        id: 'abc',
        name: 'rice',
        portion_desc: '',
        grams: 100,
        kcal: 130,
        protein_g: 2.7,
        carbs_g: 28,
        fat_g: 0.3,
        confidence: null,
        user_edited: false,
      }),
    );
    expect(saved.id).toBe('abc');
    expect(saved.portion_desc).toBeNull();
  });
});

describe('draftReducer', () => {
  it('renames, rescales, removes and adds', () => {
    let items = draftReducer([], {
      type: 'reset',
      items: [draftFromAnalysisItem(rice, 'a'), draftFromAnalysisItem(rice, 'b')],
    });
    items = draftReducer(items, { type: 'rename', key: 'a', name: 'jasmine rice' });
    items = draftReducer(items, { type: 'setGrams', key: 'b', grams: 79 });
    expect(items.map((i) => [i.name, i.kcal])).toEqual([
      ['jasmine rice', 205],
      ['white rice', 103],
    ]);
    items = draftReducer(items, { type: 'remove', key: 'a' });
    items = draftReducer(items, {
      type: 'add',
      item: draftFromManualInput(
        { name: 'egg', grams: 50, kcal: 72, protein_g: 6.3, carbs_g: 0.4, fat_g: 4.8 },
        'c',
      ),
    });
    expect(items.map((i) => i.key)).toEqual(['b', 'c']);
  });
});

describe('sumMacros', () => {
  it('sums and rounds, treating missing values as zero', () => {
    expect(
      sumMacros([
        { kcal: 100.4, protein_g: 1.04, carbs_g: 2, fat_g: 3 },
        { kcal: 50.4, protein_g: 1.04 },
      ]),
    ).toEqual({ kcal: 151, protein_g: 2.1, carbs_g: 2, fat_g: 3 });
    expect(sumMacros([])).toEqual({ kcal: 0, protein_g: 0, carbs_g: 0, fat_g: 0 });
  });
});

describe('defaultMealType', () => {
  const at = (h: number, m = 0) => new Date(2026, 9, 4, h, m);
  it.each([
    [3, 'snack'],
    [4, 'breakfast'],
    [10, 'breakfast'],
    [11, 'lunch'],
    [14, 'lunch'],
    [15, 'snack'],
    [17, 'dinner'],
    [21, 'dinner'],
    [22, 'snack'],
  ] as const)('%i:00 -> %s', (hour, expected) => {
    expect(defaultMealType(at(hour))).toBe(expected);
  });
});

describe('validateDraft', () => {
  it('requires at least one named item', () => {
    expect(validateDraft([])).toMatch(/at least one/);
    const item = draftFromAnalysisItem(rice, 'a');
    expect(validateDraft([{ ...item, name: ' ' }])).toMatch(/name/);
    expect(validateDraft([item])).toBeNull();
  });
});

describe('parseKcalGoal', () => {
  it('accepts whole numbers in range', () => {
    expect(parseKcalGoal(' 2000 ')).toEqual({ ok: true, value: 2000 });
    expect(parseKcalGoal('1')).toEqual({ ok: true, value: 1 });
    expect(parseKcalGoal('20000')).toEqual({ ok: true, value: 20000 });
  });
  it.each(['0', '20001', '', 'abc', '12.5', '-100'])('rejects %j', (input) => {
    expect(parseKcalGoal(input).ok).toBe(false);
  });
});
