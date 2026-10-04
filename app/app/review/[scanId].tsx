import {
  defaultMealType,
  draftFromAnalysisItem,
  draftFromSavedItem,
  type DraftItem,
  type MealType,
} from '@calorie/shared';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { ErrorNotice } from '@/components/ErrorNotice';
import { ReviewEditor } from '@/components/ReviewEditor';
import { useColors } from '@/components/Themed';
import { useMeal } from '@/hooks/useMeals';
import { useScan } from '@/hooks/useScan';
import { useSignedUrls } from '@/hooks/useSignedUrls';

/**
 * Review editor. Two modes:
 * - `/review/{scanId}`: a fresh analysis → new meal. The analysis comes from the query cache
 *   (seeded by the Scan screen) or, failing that, from `scans.raw_result`.
 * - `/review/{scanId|none}?mealId=...`: edit a saved meal and its items.
 */
export default function ReviewScreen() {
  const params = useLocalSearchParams<{ scanId: string; mealId?: string }>();
  const scanId = params.scanId && params.scanId !== 'none' ? params.scanId : null;
  const mealId = params.mealId || null;
  const router = useRouter();
  const colors = useColors();

  const scan = useScan(scanId);
  const meal = useMeal(mealId);
  const imagePath = meal.data?.scans?.image_path ?? scan.data?.imagePath ?? null;
  const photoUrl = useSignedUrls([imagePath])[imagePath ?? ''];

  const retake = () => router.dismissTo('/scan');
  const done = () => router.dismissTo('/');

  const loading = (scanId !== null && scan.isLoading) || (mealId !== null && meal.isLoading);
  const error = scan.error ?? meal.error;
  const analysis = scan.data?.analysis ?? null;

  let body: ReactNode;
  if (loading) {
    body = (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  } else if (error) {
    body = (
      <Notice
        title="Could not load"
        message="Check your connection and try again."
        primary={{
          title: 'Retry',
          onPress: () => void Promise.all([scan.refetch(), meal.refetch()]),
        }}
      />
    );
  } else if (mealId) {
    if (!meal.data) {
      body = <Notice title="Meal not found" message="It may have been deleted." />;
    } else {
      const items: DraftItem[] = meal.data.meal_items.map(draftFromSavedItem);
      body = (
        <ReviewEditor
          initialItems={items}
          initialMealType={meal.data.meal_type ?? defaultMealType(new Date(meal.data.eaten_at))}
          mealId={meal.data.id}
          scanId={meal.data.scan_id}
          photoUrl={photoUrl}
          notes={analysis?.notes ?? null}
          onSaved={done}
        />
      );
    }
  } else if (!scan.data) {
    body = (
      <Notice
        title="Scan not found"
        message="This scan could not be found."
        primary={{ title: 'Back to camera', onPress: retake }}
      />
    );
  } else if (!analysis) {
    body = (
      <Notice
        title="No analysis"
        message={
          scan.data.status === 'pending'
            ? 'This scan was never analyzed. Take the photo again.'
            : 'This scan could not be analyzed. Try another photo.'
        }
        primary={{ title: 'Retake', onPress: retake }}
      />
    );
  } else if (!analysis.is_food || analysis.items.length === 0) {
    body = (
      <Notice
        title="No food detected"
        message={analysis.notes || 'We could not find any food in this photo.'}
        primary={{ title: 'Retake', onPress: retake }}
      />
    );
  } else {
    const items = analysis.items.map((item, i) => draftFromAnalysisItem(item, `${scanId}-${i}`));
    const mealType: MealType = defaultMealType(new Date());
    body = (
      <ReviewEditor
        initialItems={items}
        initialMealType={mealType}
        mealId={null}
        scanId={scan.data.id}
        photoUrl={photoUrl}
        notes={analysis.notes || null}
        onSaved={done}
      />
    );
  }

  return (
    <View style={[styles.fill, { backgroundColor: colors.background }]}>
      <Stack.Screen options={{ title: mealId ? 'Edit meal' : 'Review meal' }} />
      {body}
    </View>
  );
}

function Notice(props: ComponentProps<typeof ErrorNotice>) {
  return (
    <View style={styles.notice}>
      <ErrorNotice {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  notice: { padding: 16 },
});
