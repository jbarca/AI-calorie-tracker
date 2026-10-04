import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { Text, useColors } from '@/components/Themed';

type Props = {
  grams: number;
  onChange: (grams: number) => void;
  step?: number;
  label: string;
};

/** − [grams] + control; the number can also be typed. */
export function GramsStepper({ grams, onChange, step = 10, label }: Props) {
  const colors = useColors();
  const [text, setText] = useState(String(grams));
  const [shown, setShown] = useState(grams);

  // Keep the field in sync when the value changes from outside (the +/- buttons).
  if (shown !== grams) {
    setShown(grams);
    setText(String(grams));
  }

  const parse = (value: string): number | null => {
    if (value.trim() === '') return null;
    const parsed = Number(value.replace(',', '.'));
    return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null;
  };

  // Typed values are applied as they change, not only on blur: with keyboardShouldPersistTaps the
  // Save button can be tapped without the field ever losing focus.
  const handleChangeText = (value: string) => {
    setText(value);
    const parsed = parse(value);
    if (parsed !== null) onChange(parsed);
  };

  // On blur, an empty or invalid entry reverts to the last applied value.
  const commit = () => {
    const parsed = parse(text);
    if (parsed !== null) onChange(parsed);
    else setText(String(grams));
  };

  const button = (sign: -1 | 1) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${sign < 0 ? 'Decrease' : 'Increase'} ${label} by ${step} grams`}
      hitSlop={8}
      onPress={() => onChange(Math.max(0, grams + sign * step))}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: colors.card, opacity: pressed ? 0.6 : 1 },
      ]}
    >
      <Text style={styles.buttonText}>{sign < 0 ? '−' : '+'}</Text>
    </Pressable>
  );

  return (
    <View style={styles.row}>
      {button(-1)}
      <TextInput
        accessibilityLabel={`${label} grams`}
        value={text}
        onChangeText={handleChangeText}
        onEndEditing={commit}
        onSubmitEditing={commit}
        keyboardType="number-pad"
        selectTextOnFocus
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
      />
      <Text style={{ color: colors.muted }}>g</Text>
      {button(1)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  button: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 20, fontWeight: '600' },
  input: {
    minWidth: 56,
    height: 36,
    borderWidth: 1,
    borderRadius: 8,
    textAlign: 'center',
    fontSize: 16,
    fontVariant: ['tabular-nums'],
  },
});
