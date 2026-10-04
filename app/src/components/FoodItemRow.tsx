import type { DraftItem } from '@calorie/shared';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ConfidenceBadge } from '@/components/ConfidenceBadge';
import { GramsStepper } from '@/components/GramsStepper';
import { Text, useColors } from '@/components/Themed';

type Props = {
  item: DraftItem;
  onRename: (name: string) => void;
  onGramsChange: (grams: number) => void;
  onRemove: () => void;
};

/** One editable food in the review editor: name, grams stepper, nutrition, confidence, delete. */
export function FoodItemRow({ item, onRename, onGramsChange, onRemove }: Props) {
  const colors = useColors();
  const label = item.name || 'item';

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <View style={styles.header}>
        <TextInput
          accessibilityLabel="Food name"
          value={item.name}
          onChangeText={onRename}
          placeholder="Food name"
          placeholderTextColor={colors.muted}
          style={[styles.name, { color: colors.text }]}
        />
        <ConfidenceBadge confidence={item.confidence} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${label}`}
          hitSlop={10}
          onPress={onRemove}
        >
          <Text style={[styles.remove, { color: colors.danger }]}>✕</Text>
        </Pressable>
      </View>
      {item.portion_desc ? (
        <Text style={[styles.portion, { color: colors.muted }]}>{item.portion_desc}</Text>
      ) : null}
      <View style={styles.footer}>
        <GramsStepper grams={item.grams} onChange={onGramsChange} label={label} />
        <View style={styles.nutrition}>
          <Text style={styles.kcal}>{item.kcal} kcal</Text>
          <Text style={[styles.macros, { color: colors.muted }]}>
            P {item.protein_g} · C {item.carbs_g} · F {item.fat_g}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 12, gap: 6 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '600', paddingVertical: 4 },
  remove: { fontSize: 18, fontWeight: '700', paddingHorizontal: 4 },
  portion: { fontSize: 13 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 8,
  },
  nutrition: { alignItems: 'flex-end' },
  kcal: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  macros: { fontSize: 12, fontVariant: ['tabular-nums'] },
});
