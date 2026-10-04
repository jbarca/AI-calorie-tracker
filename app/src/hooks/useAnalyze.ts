import { friendlyAnalyzeError, type FriendlyError } from '@calorie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

import {
  analyzeMeal,
  analyzeText,
  AnalyzeError,
  type AnalyzeResult,
  type PendingScan,
} from '@/lib/api';
import type { PreparedPhoto } from '@/lib/image';
import { queryKeys } from '@/lib/queryKeys';
import type { ScanDetails } from '@/lib/rows';
import { signOut } from '@/lib/auth';

/**
 * Runs an analysis (photo or text), seeds the scan cache with the result and opens the review
 * screen. Keeps the partially-completed photo scan so "Retry" resumes it rather than creating
 * another scans row.
 */
export function useAnalyze() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const pending = useRef<PendingScan | null>(null);

  const run = useCallback(
    async (task: () => Promise<AnalyzeResult>, replace: boolean) => {
      setAnalyzing(true);
      setError(null);
      try {
        const result = await task();
        pending.current = null;
        const details: ScanDetails = {
          id: result.scanId,
          imagePath: result.imagePath,
          status: 'complete',
          analysis: result.analysis,
        };
        queryClient.setQueryData(queryKeys.scan(result.scanId), details);
        const href = { pathname: '/review/[scanId]' as const, params: { scanId: result.scanId } };
        if (replace) router.replace(href);
        else router.push(href);
        return true;
      } catch (err) {
        if (err instanceof AnalyzeError) {
          pending.current = err.pending;
          setError(err.friendly);
          if (err.friendly.signIn) void signOut().catch(() => undefined);
        } else {
          setError(friendlyAnalyzeError(null));
        }
        return false;
      } finally {
        setAnalyzing(false);
      }
    },
    [queryClient, router],
  );

  const analyzePhoto = useCallback(
    (photo: PreparedPhoto, hint: string) =>
      run(() => analyzeMeal(photo, hint, pending.current), false),
    [run],
  );

  const analyzeDescription = useCallback(
    (text: string) => run(() => analyzeText(text), true),
    [run],
  );

  /** Forget the current attempt (e.g. on retake). */
  const reset = useCallback(() => {
    pending.current = null;
    setError(null);
  }, []);

  return { analyzing, error, analyzePhoto, analyzeDescription, reset };
}
