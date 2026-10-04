import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Text, useColors } from '@/components/Themed';

type Action = { title: string; onPress: () => void };

type Props = {
  title: string;
  message: string;
  primary?: Action;
  secondary?: Action;
};

/** An inline error card with up to two actions (e.g. Retry / Retake). */
export function ErrorNotice({ title, message, primary, secondary }: Props) {
  const colors = useColors();
  return (
    <View accessibilityRole="alert" style={[styles.card, { backgroundColor: colors.card }]}>
      <Text style={[styles.title, { color: colors.danger }]}>{title}</Text>
      <Text style={styles.message}>{message}</Text>
      {primary || secondary ? (
        <View style={styles.actions}>
          {primary ? (
            <Button title={primary.title} onPress={primary.onPress} style={styles.action} />
          ) : null}
          {secondary ? (
            <Button
              title={secondary.title}
              onPress={secondary.onPress}
              variant="secondary"
              style={styles.action}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 16, gap: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  message: { fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  action: { flex: 1 },
});
