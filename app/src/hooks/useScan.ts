import { useQuery } from '@tanstack/react-query';

import { fetchScan } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';

/**
 * A scan and its stored analysis. The Scan screen seeds this cache with the function's response
 * before navigating, so the review screen normally renders without a fetch; otherwise (deep link,
 * app restart, editing an old meal) it is loaded from `scans.raw_result`.
 */
export function useScan(scanId: string | null) {
  return useQuery({
    queryKey: queryKeys.scan(scanId ?? ''),
    queryFn: () => fetchScan(scanId ?? ''),
    enabled: scanId !== null,
    staleTime: Infinity,
  });
}
