import type { DayRange } from '@calorie/shared';

export const queryKeys = {
  profile: (userId: string) => ['profile', userId] as const,
  /** Prefix shared by every meals list query; invalidate it after any meal write. */
  meals: ['meals'] as const,
  mealsInRange: (range: DayRange) =>
    ['meals', range.start.toISOString(), range.end.toISOString()] as const,
  meal: (mealId: string) => ['meal', mealId] as const,
  scan: (scanId: string) => ['scan', scanId] as const,
  signedUrls: (paths: readonly string[]) => ['signed-urls', ...paths] as const,
};
