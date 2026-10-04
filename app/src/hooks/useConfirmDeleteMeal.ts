import { Alert } from 'react-native';

import { useDeleteMeal } from '@/hooks/useMeals';

/** Returns a function that asks for confirmation, then deletes the meal (items cascade). */
export function useConfirmDeleteMeal() {
  const deleteMeal = useDeleteMeal();
  return (mealId: string) =>
    Alert.alert('Delete meal?', 'This removes the meal and its items from your log.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          deleteMeal.mutate(mealId, {
            onError: () => Alert.alert('Could not delete', 'Check your connection and try again.'),
          }),
      },
    ]);
}
