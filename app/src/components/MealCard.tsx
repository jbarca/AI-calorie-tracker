import { Image, Pressable, StyleSheet, View } from 'react-native';

import { MEAL_TYPE_LABELS } from '@/components/MealTypePicker';
import { Text, useColors } from '@/components/Themed';
import { mealTotals } from '@/lib/meals';
import type { MealRecord } from '@/lib/rows';

type Props = {
  meal: MealRecord;
  thumbnailUrl: string | undefined;
  onPress: () => void;
  onLongPress: () => void;
};

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** A logged meal: photo thumbnail, type and time, item names and total kcal. */
export function MealCard({ meal, thumbnailUrl, onPress, onLongPress }: Props) {
  const colors = useColors();
  const totals = mealTotals(meal);
  const title = meal.meal_type ? MEAL_TYPE_LABELS[meal.meal_type] : 'Meal';
  const time = timeFormat.format(new Date(meal.eaten_at));
  const names = meal.meal_items.map((i) => i.name).join(', ') || 'No items';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} at ${time}, ${totals.kcal} kcal`}
      accessibilityHint="Opens the meal editor. Long press to delete."
      onPress={onPress}
      onLongPress={onLongPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors.card, opacity: pressed ? 0.8 : 1 },
      ]}
    >
      {thumbnailUrl ? (
        <Image
          source={{ uri: thumbnailUrl }}
          style={styles.thumb}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.thumb, { backgroundColor: colors.track }]} />
      )}
      <View style={styles.body}>
        <Text style={styles.title}>
          {title} <Text style={[styles.time, { color: colors.muted }]}>· {time}</Text>
        </Text>
        <Text numberOfLines={1} style={[styles.names, { color: colors.muted }]}>
          {names}
        </Text>
      </View>
      <Text style={styles.kcal}>{totals.kcal}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 12 },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  body: { flex: 1, gap: 2 },
  title: { fontSize: 16, fontWeight: '600' },
  time: { fontSize: 14, fontWeight: '400' },
  names: { fontSize: 13 },
  kcal: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
});
