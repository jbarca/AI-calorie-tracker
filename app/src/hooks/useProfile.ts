import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchProfile, updateKcalGoal } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { useUserId } from '@/providers/SessionProvider';

export function useProfile() {
  const userId = useUserId();
  return useQuery({
    queryKey: queryKeys.profile(userId ?? ''),
    queryFn: () => fetchProfile(userId ?? ''),
    enabled: userId !== null,
  });
}

export function useUpdateKcalGoal() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (goal: number) => {
      if (!userId) throw new Error('Not signed in.');
      return updateKcalGoal(userId, goal);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId ?? '') }),
  });
}
