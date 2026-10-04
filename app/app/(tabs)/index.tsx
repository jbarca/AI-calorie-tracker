import { useRouter } from 'expo-router';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { CalorieRing } from '@/components/CalorieRing';
import { ErrorNotice } from '@/components/ErrorNotice';
import { MacroBar } from '@/components/MacroBar';
import { MealCard } from '@/components/MealCard';
import { Text, useColors } from '@/components/Themed';
import { useConfirmDeleteMeal } from '@/hooks/useConfirmDeleteMeal';
import { useToday } from '@/hooks/useMeals';
import { useSignedUrls } from '@/hooks/useSignedUrls';
import { mealEditorHref } from '@/lib/meals';

export default function TodayScreen() {
  const colors = useColors();
  const router = useRouter();
  const today = useToday();
  const confirmDelete = useConfirmDeleteMeal();
  const thumbnails = useSignedUrls(today.meals.map((m) => m.scans?.image_path));

  const header = (
    <View style={styles.header}>
      <CalorieRing consumed={today.totals.kcal} goal={today.goal} />
      <MacroBar totals={today.totals} />
      {today.error ? (
        <ErrorNotice
          title="Could not load today"
          message="Check your connection and try again."
          primary={{ title: 'Retry', onPress: () => void today.refetch() }}
        />
      ) : null}
      {today.meals.length > 0 ? <Text style={styles.sectionTitle}>Meals</Text> : null}
    </View>
  );

  const empty = today.isLoading ? (
    <ActivityIndicator style={styles.loading} />
  ) : today.error ? null : (
    <View style={styles.empty}>
      <Text style={[styles.emptyText, { color: colors.muted }]}>
        Nothing logged yet today. Scan a meal or describe it in words.
      </Text>
      <Button title="Scan a meal" onPress={() => router.navigate('/scan')} />
      <Button
        title="Describe a meal"
        variant="secondary"
        onPress={() => router.push('/add-text')}
      />
    </View>
  );

  return (
    <FlatList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      data={today.meals}
      keyExtractor={(m) => m.id}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      ItemSeparatorComponent={Separator}
      refreshControl={
        <RefreshControl refreshing={today.isRefetching} onRefresh={() => void today.refetch()} />
      }
      renderItem={({ item }) => (
        <MealCard
          meal={item}
          thumbnailUrl={item.scans?.image_path ? thumbnails[item.scans.image_path] : undefined}
          onPress={() => router.push(mealEditorHref(item))}
          onLongPress={() => confirmDelete(item.id)}
        />
      )}
    />
  );
}

function Separator() {
  return <View style={styles.separator} />;
}

const styles = StyleSheet.create({
  list: { padding: 16, paddingBottom: 32 },
  header: { alignItems: 'center', gap: 16, marginBottom: 12 },
  sectionTitle: { alignSelf: 'flex-start', fontSize: 18, fontWeight: '700' },
  separator: { height: 8 },
  loading: { marginTop: 24 },
  empty: { gap: 12, marginTop: 8 },
  emptyText: { fontSize: 15, textAlign: 'center' },
});
