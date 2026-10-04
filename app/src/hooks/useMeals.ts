import {
  lastLocalDaysRange,
  localDayRange,
  parseLocalDayKey,
  sumMacros,
  type DayRange,
} from '@calorie/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useLocalDayKey } from '@/hooks/useLocalDay';
import { useProfile } from '@/hooks/useProfile';
import { deleteMeal, fetchMeal, fetchMealsInRange, saveMeal } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { mealTotals } from '@/lib/meals';

export const DEFAULT_KCAL_GOAL = 2000;

/** Meals eaten in a local-time range (newest first). */
export function useMeals(range: DayRange) {
  return useQuery({
    queryKey: queryKeys.mealsInRange(range),
    queryFn: () => fetchMealsInRange(range),
  });
}

/** Meals for the last `days` local days, including today. */
export function useRecentMeals(days: number) {
  const day = useLocalDayKey();
  const range = useMemo(() => lastLocalDaysRange(parseLocalDayKey(day), days), [day, days]);
  return { ...useMeals(range), today: day };
}

/**
 * Today's meals and totals, using the device's local-day boundaries (not the UTC
 * `daily_totals` view), plus the user's calorie goal.
 */
export function useToday() {
  const day = useLocalDayKey();
  const range = useMemo(() => localDayRange(parseLocalDayKey(day)), [day]);
  const meals = useMeals(range);
  const profile = useProfile();
  const totals = useMemo(() => sumMacros((meals.data ?? []).map(mealTotals)), [meals.data]);

  return {
    meals: meals.data ?? [],
    totals,
    goal: profile.data?.daily_kcal_goal ?? DEFAULT_KCAL_GOAL,
    isLoading: meals.isLoading,
    error: meals.error ?? profile.error,
    isRefetching: meals.isRefetching,
    refetch: () => Promise.all([meals.refetch(), profile.refetch()]),
  };
}

export function useMeal(mealId: string | null) {
  return useQuery({
    queryKey: queryKeys.meal(mealId ?? ''),
    queryFn: () => fetchMeal(mealId ?? ''),
    enabled: mealId !== null,
  });
}

export function useDeleteMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteMeal,
    onSuccess: (_data, mealId) => {
      queryClient.removeQueries({ queryKey: queryKeys.meal(mealId) });
      return queryClient.invalidateQueries({ queryKey: queryKeys.meals });
    },
  });
}

export function useSaveMeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: saveMeal,
    onSuccess: (mealId) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.meals }),
        queryClient.invalidateQueries({ queryKey: queryKeys.meal(mealId) }),
      ]),
  });
}
