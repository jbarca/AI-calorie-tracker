import type { Macros } from '@calorie/shared';
import { StyleSheet, View } from 'react-native';

import { Text, useColors } from '@/components/Themed';
import { MacroColors } from '@/constants/Colors';

const MACROS = [
  { key: 'protein_g', label: 'Protein', color: MacroColors.protein, kcalPerGram: 4 },
  { key: 'carbs_g', label: 'Carbs', color: MacroColors.carbs, kcalPerGram: 4 },
  { key: 'fat_g', label: 'Fat', color: MacroColors.fat, kcalPerGram: 9 },
] as const;

/** Stacked bar of where the calories came from (protein/carbs/fat), with gram labels. */
export function MacroBar({ totals }: { totals: Macros }) {
  const colors = useColors();
  const energy = MACROS.map((m) => totals[m.key] * m.kcalPerGram);
  const sum = energy.reduce((a, b) => a + b, 0);

  return (
    <View style={styles.container}>
      <View style={[styles.track, { backgroundColor: colors.track }]}>
        {sum > 0
          ? MACROS.map((m, i) => (
              <View
                key={m.key}
                style={{ flex: energy[i] ?? 0, backgroundColor: m.color, marginLeft: i ? 2 : 0 }}
              />
            ))
          : null}
      </View>
      <View style={styles.legend}>
        {MACROS.map((m) => (
          <View key={m.key} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: m.color }]} />
            <Text style={styles.legendText}>
              {m.label} <Text style={styles.grams}>{Math.round(totals[m.key])} g</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8, alignSelf: 'stretch' },
  track: { height: 10, borderRadius: 5, overflow: 'hidden', flexDirection: 'row' },
  legend: { flexDirection: 'row', justifyContent: 'space-between' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 13 },
  grams: { fontWeight: '600', fontVariant: ['tabular-nums'] },
});
