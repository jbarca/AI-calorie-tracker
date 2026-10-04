import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { MealItemRow } from '@calorie/shared';
import { FunctionsHttpError } from '@supabase/supabase-js';

import { analyzeMeal, saveMeal } from '@/lib/api';

type Call = { table: string; op: string; args: unknown[] };

const mocks = {
  calls: [] as Call[],
  /** `${table}.${op}` → error to return for that operation. */
  errors: {} as Record<string, unknown>,
  invoke: jest.fn<(name: string, opts: unknown) => Promise<{ data: unknown; error: unknown }>>(),
  uploads: 0,
};

jest.mock('@/lib/supabase', () => {
  const builder = (table: string) => {
    let op = '';
    const chain: Record<string, unknown> = {};
    const result = () => {
      const error = mocks.errors[`${table}.${op}`] ?? null;
      const data = op === 'insert' && table === 'meals' ? { id: 'new-meal' } : { id: 'scan-1' };
      return { data: error ? null : data, error };
    };
    const record = (name: string, args: unknown[]) => {
      if (['insert', 'update', 'upsert', 'delete'].includes(name)) op = name;
      mocks.calls.push({ table, op: name, args });
      return chain;
    };
    for (const name of ['insert', 'update', 'upsert', 'delete', 'select', 'eq', 'in']) {
      chain[name] = (...args: unknown[]) => record(name, args);
    }
    chain.single = () => Promise.resolve(result());
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return chain;
  };
  return {
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: { user: { id: 'u1' } } } }) },
      from: (table: string) => builder(table),
      storage: {
        from: () => ({
          upload: () => {
            mocks.uploads++;
            return Promise.resolve({ error: mocks.errors['storage.upload'] ?? null });
          },
        }),
      },
      functions: { invoke: (...args: [string, unknown]) => mocks.invoke(...args) },
    },
  };
});

const item = {
  id: undefined,
  name: 'rice',
  portion_desc: null,
  grams: 100,
  kcal: 130,
  protein_g: 2.7,
  carbs_g: 28,
  fat_g: 0.3,
  confidence: 'high',
  user_edited: false,
} as unknown as MealItemRow;

const photo = { uri: 'file:///x.jpg', base64: 'AAAA', width: 1, height: 1 } as never;

beforeEach(() => {
  mocks.calls = [];
  mocks.errors = {};
  mocks.uploads = 0;
  mocks.invoke.mockReset();
});

describe('saveMeal', () => {
  const base = {
    scanId: 's1',
    mealType: 'lunch' as const,
    items: [item],
    removedItemIds: [] as string[],
  };

  it('deletes a newly created meal when its items fail to save, so a retry cannot duplicate it', async () => {
    mocks.errors['meal_items.insert'] = new Error('items failed');
    await expect(saveMeal({ ...base, mealId: null })).rejects.toThrow('items failed');
    const deletes = mocks.calls.filter((c) => c.table === 'meals' && c.op === 'delete');
    expect(deletes).toHaveLength(1);
    expect(mocks.calls).toContainEqual({ table: 'meals', op: 'eq', args: ['id', 'new-meal'] });
  });

  it('never deletes an existing meal when editing fails', async () => {
    mocks.errors['meal_items.insert'] = new Error('items failed');
    await expect(saveMeal({ ...base, mealId: 'm1' })).rejects.toThrow('items failed');
    expect(mocks.calls.filter((c) => c.table === 'meals' && c.op === 'delete')).toEqual([]);
  });

  it('deletes removed items only after the others were written', async () => {
    const id = await saveMeal({ ...base, mealId: 'm1', removedItemIds: ['gone'] });
    expect(id).toBe('m1');
    const ops = mocks.calls.filter((c) => c.table === 'meal_items').map((c) => c.op);
    expect(ops.indexOf('insert')).toBeLessThan(ops.indexOf('delete'));
  });
});

describe('analyzeMeal resume', () => {
  it('re-uploads on retry after image_not_found', async () => {
    const response = new Response(JSON.stringify({ error: 'image_not_found' }), { status: 404 });
    mocks.invoke.mockResolvedValueOnce({ data: null, error: new FunctionsHttpError(response) });
    let thrown: unknown;
    try {
      await analyzeMeal(photo, undefined, { scanId: 'scan-1', imagePath: 'u1/scan-1.jpg' });
    } catch (err) {
      thrown = err;
    }
    const pending = (thrown as { pending: { scanId: string; imagePath: string | null } }).pending;
    expect(pending).toEqual({ scanId: 'scan-1', imagePath: null });

    mocks.invoke.mockResolvedValueOnce({ data: null, error: new Error('stop here') });
    await analyzeMeal(photo, undefined, pending).catch(() => undefined);
    expect(mocks.uploads).toBe(1);
  });
});
