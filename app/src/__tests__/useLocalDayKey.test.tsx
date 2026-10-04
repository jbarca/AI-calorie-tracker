import { describe, expect, it, jest } from '@jest/globals';
import { localDayKey } from '@calorie/shared';
import { act, renderHook } from '@testing-library/react-native';

import { useLocalDayKey } from '@/hooks/useLocalDay';

describe('useLocalDayKey', () => {
  it("returns today's local day and rolls over at midnight", async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 4, 23, 59, 0) });
    try {
      const { result } = await renderHook(() => useLocalDayKey());
      expect(result.current).toBe(localDayKey(new Date(2026, 9, 4)));
      await act(() => jest.advanceTimersByTimeAsync(2 * 60 * 1000));
      expect(result.current).toBe('2026-10-05');
    } finally {
      jest.useRealTimers();
    }
  });
});
