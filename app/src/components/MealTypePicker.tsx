import { MEAL_TYPES, type MealType } from '@calorie/shared';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text, useColors } from '@/components/Themed';

export const MEAL_TYPE_LABELS: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/** Segmented control for the meal type. */
export function MealTypePicker({
  value,
  onChange,
}: {
  value: MealType;
  onChange: (value: MealType) => void;
}) {
  const colors = useColors();
  return (
    <View accessibilityRole="radiogroup" style={[styles.row, { backgroundColor: colors.card }]}>
      {MEAL_TYPES.map((type) => {
        const selected = type === value;
        return (
          <Pressable
            key={type}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => onChange(type)}
            style={[styles.option, selected && { backgroundColor: colors.accent }]}
          >
            <Text style={[styles.label, selected && styles.selectedLabel]}>
              {MEAL_TYPE_LABELS[type]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', borderRadius: 10, padding: 3 },
  option: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  label: { fontSize: 14, fontWeight: '500' },
  selectedLabel: { color: '#fff', fontWeight: '700' },
});
