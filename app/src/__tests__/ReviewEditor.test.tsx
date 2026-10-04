import { describe, expect, it, jest } from '@jest/globals';
import { draftFromAnalysisItem } from '@calorie/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import { ReviewEditor } from '@/components/ReviewEditor';
import { saveMeal } from '@/lib/api';

// The real module creates a Supabase client from env vars; only saveMeal is used here.
jest.mock('@/lib/api', () => ({ saveMeal: jest.fn(() => Promise.resolve('meal-1')) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const items = [
  draftFromAnalysisItem(
    {
      name: 'chicken breast',
      portion_desc: '1 fillet',
      estimated_grams: 150,
      kcal: 248,
      protein_g: 46.5,
      carbs_g: 0,
      fat_g: 5.4,
      confidence: 'high',
    },
    's-0',
  ),
  draftFromAnalysisItem(
    {
      name: 'white rice',
      portion_desc: '1 cup',
      estimated_grams: 158,
      kcal: 205,
      protein_g: 4.3,
      carbs_g: 44.5,
      fat_g: 0.4,
      confidence: 'medium',
    },
    's-1',
  ),
];

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('ReviewEditor', () => {
  it('rescales totals, then saves rows with user_edited flags', async () => {
    const onSaved = jest.fn();
    await render(
      <ReviewEditor
        initialItems={items}
        initialMealType="lunch"
        mealId={null}
        scanId="scan-1"
        photoUrl={undefined}
        notes="Assumed 1 tsp oil."
        onSaved={onSaved}
      />,
      { wrapper },
    );

    expect(screen.getByText('453 kcal')).toBeOnTheScreen();
    expect(screen.getByText(/Assumed 1 tsp oil/)).toBeOnTheScreen();

    // 158 g -> 168 g of rice: 205 * 168/158 = 218 kcal, total 466.
    await fireEvent.press(screen.getByLabelText('Increase white rice by 10 grams'));
    expect(screen.getByText('218 kcal')).toBeOnTheScreen();
    expect(screen.getByText('466 kcal')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Save to log'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const input = jest.mocked(saveMeal).mock.calls[0]?.[0];
    expect(input).toMatchObject({ mealId: null, scanId: 'scan-1', mealType: 'lunch' });
    expect(input?.removedItemIds).toEqual([]);
    expect(input?.items.map((i) => [i.name, i.grams, i.kcal, i.user_edited])).toEqual([
      ['chicken breast', 150, 248, false],
      ['white rice', 168, 218, true],
    ]);
  });

  it('blocks saving when every item was removed', async () => {
    await render(
      <ReviewEditor
        initialItems={items.slice(0, 1)}
        initialMealType="dinner"
        mealId={null}
        scanId="scan-1"
        photoUrl={undefined}
        notes={null}
        onSaved={jest.fn()}
      />,
      { wrapper },
    );
    await fireEvent.press(screen.getByLabelText('Remove chicken breast'));
    expect(screen.getByText('Save to log')).toBeDisabled();
  });
});
