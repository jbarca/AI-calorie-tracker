import type { Confidence } from '@calorie/shared';
import { StyleSheet, Text, View } from 'react-native';

const STYLES: Record<Confidence | 'manual', { label: string; bg: string; fg: string }> = {
  high: { label: 'High', bg: '#dcfce7', fg: '#166534' },
  medium: { label: 'Medium', bg: '#fef3c7', fg: '#92400e' },
  low: { label: 'Low', bg: '#fee2e2', fg: '#991b1b' },
  manual: { label: 'Manual', bg: '#e5e7eb', fg: '#374151' },
};

/** The model's confidence for an item; "Manual" for rows the user added. */
export function ConfidenceBadge({ confidence }: { confidence: Confidence | null }) {
  const s = STYLES[confidence ?? 'manual'];
  return (
    <View
      style={[styles.badge, { backgroundColor: s.bg }]}
      accessibilityLabel={confidence ? `${s.label} confidence` : 'Added manually'}
    >
      <Text style={[styles.text, { color: s.fg }]}>{s.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  text: { fontSize: 11, fontWeight: '700' },
});
