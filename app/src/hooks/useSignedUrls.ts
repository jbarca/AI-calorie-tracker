import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { createSignedUrls } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/** Signed URLs (valid for 1 h, refreshed after 50 min) for private meal photos, keyed by path. */
export function useSignedUrls(paths: readonly (string | null | undefined)[]) {
  const unique = useMemo(() => [...new Set(paths.filter((p): p is string => !!p))].sort(), [paths]);
  const query = useQuery({
    queryKey: queryKeys.signedUrls(unique),
    queryFn: () => createSignedUrls(unique),
    enabled: unique.length > 0,
    staleTime: 50 * 60 * 1000,
  });
  return query.data ?? {};
}
