import { groupByLocalDay, lastLocalDayKeys, parseLocalDayKey, sumMacros } from '@calorie/shared';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  SectionList,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { ErrorNotice } from '@/components/ErrorNotice';
import { MealCard } from '@/components/MealCard';
import { Text, useColors } from '@/components/Themed';
import { WeekBarChart } from '@/components/WeekBarChart';
import { useConfirmDeleteMeal } from '@/hooks/useConfirmDeleteMeal';
import { DEFAULT_KCAL_GOAL, useRecentMeals } from '@/hooks/useMeals';
import { useProfile } from '@/hooks/useProfile';
import { useSignedUrls } from '@/hooks/useSignedUrls';
import { mealEditorHref, mealTotals } from '@/lib/meals';

const HISTORY_DAYS = 30;
const PADDING = 16;

const dayFormat = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'short',
  day: 'numeric',
});

/** The last 30 local days, newest first, with a 7-day kcal chart. */
export default function HistoryScreen() {
  const colors = useColors();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const meals = useRecentMeals(HISTORY_DAYS);
  const profile = useProfile();
  const confirmDelete = useConfirmDeleteMeal();
  const goal = profile.data?.daily_kcal_goal ?? DEFAULT_KCAL_GOAL;
  const data = meals.data;
  const thumbnails = useSignedUrls((data ?? []).map((m) => m.scans?.image_path));

  const sections = useMemo(
    () =>
      groupByLocalDay(data ?? [], (m) => new Date(m.eaten_at)).map(({ day, records }) => ({
        day,
        kcal: sumMacros(records.map(mealTotals)).kcal,
        data: records,
      })),
    [data],
  );

  const week = useMemo(() => {
    const byDay = new Map(sections.map((s) => [s.day, s.kcal]));
    return lastLocalDayKeys(parseLocalDayKey(meals.today), 7).map((day) => ({
      day,
      kcal: byDay.get(day) ?? 0,
    }));
  }, [sections, meals.today]);

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>Last 7 days</Text>
      <WeekBarChart days={week} goal={goal} width={width - PADDING * 2} />
      {meals.error ? (
        <ErrorNotice
          title="Could not load history"
          message="Check your connection and try again."
          primary={{ title: 'Retry', onPress: () => void meals.refetch() }}
        />
      ) : null}
    </View>
  );

  return (
    <SectionList
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.list}
      sections={sections}
      keyExtractor={(m) => m.id}
      ListHeaderComponent={header}
      ListEmptyComponent={
        meals.isLoading ? (
          <ActivityIndicator />
        ) : meals.error ? null : (
          <Text style={[styles.empty, { color: colors.muted }]}>
            No meals in the last {HISTORY_DAYS} days.
          </Text>
        )
      }
      stickySectionHeadersEnabled={false}
      renderSectionHeader={({ section }) => (
        <View style={styles.sectionHeader}>
          <Text style={styles.day}>{dayFormat.format(parseLocalDayKey(section.day))}</Text>
          <Text
            style={[styles.dayKcal, { color: section.kcal > goal ? colors.danger : colors.muted }]}
          >
            {section.kcal} / {goal} kcal
          </Text>
        </View>
      )}
      renderItem={({ item }) => (
        <View style={styles.item}>
          <MealCard
            meal={item}
            thumbnailUrl={item.scans?.image_path ? thumbnails[item.scans.image_path] : undefined}
            onPress={() => router.push(mealEditorHref(item))}
            onLongPress={() => confirmDelete(item.id)}
          />
        </View>
      )}
      refreshControl={
        <RefreshControl refreshing={meals.isRefetching} onRefresh={() => void meals.refetch()} />
      }
    />
  );
}

const styles = StyleSheet.create({
  list: { padding: PADDING, paddingBottom: 32 },
  header: { gap: 8, marginBottom: 8 },
  title: { fontSize: 18, fontWeight: '700' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginTop: 16,
    marginBottom: 8,
  },
  day: { fontSize: 16, fontWeight: '700' },
  dayKcal: { fontSize: 14, fontVariant: ['tabular-nums'] },
  item: { marginBottom: 8 },
  empty: { fontSize: 15, textAlign: 'center', marginTop: 16 },
});
