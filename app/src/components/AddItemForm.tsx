import type { NewItemInput } from '@calorie/shared';
import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { Text, useColors } from '@/components/Themed';

type Field = 'name' | 'grams' | 'kcal' | 'protein_g' | 'carbs_g' | 'fat_g';

const NUMERIC: { key: Exclude<Field, 'name'>; label: string }[] = [
  { key: 'grams', label: 'Grams' },
  { key: 'kcal', label: 'kcal' },
  { key: 'protein_g', label: 'Protein g' },
  { key: 'carbs_g', label: 'Carbs g' },
  { key: 'fat_g', label: 'Fat g' },
];

const EMPTY: Record<Field, string> = {
  name: '',
  grams: '',
  kcal: '',
  protein_g: '',
  carbs_g: '',
  fat_g: '',
};

const toNumber = (s: string) => {
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

/** Inline form for a food the model missed. Name and kcal are required; macros default to 0. */
export function AddItemForm({
  onAdd,
  onCancel,
}: {
  onAdd: (item: NewItemInput) => void;
  onCancel: () => void;
}) {
  const colors = useColors();
  const [values, setValues] = useState(EMPTY);
  const set = (key: Field) => (text: string) => setValues((v) => ({ ...v, [key]: text }));
  const canAdd = values.name.trim() !== '' && values.kcal.trim() !== '';
  const inputStyle = [styles.input, { color: colors.text, borderColor: colors.border }];

  const submit = () => {
    onAdd({
      name: values.name,
      grams: toNumber(values.grams),
      kcal: toNumber(values.kcal),
      protein_g: toNumber(values.protein_g),
      carbs_g: toNumber(values.carbs_g),
      fat_g: toNumber(values.fat_g),
    });
    setValues(EMPTY);
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <Text style={styles.title}>Add item</Text>
      <TextInput
        accessibilityLabel="Food name"
        placeholder="Food name"
        placeholderTextColor={colors.muted}
        value={values.name}
        onChangeText={set('name')}
        style={inputStyle}
      />
      <View style={styles.grid}>
        {NUMERIC.map((f) => (
          <TextInput
            key={f.key}
            accessibilityLabel={f.label}
            placeholder={f.label}
            placeholderTextColor={colors.muted}
            value={values[f.key]}
            onChangeText={set(f.key)}
            keyboardType="decimal-pad"
            style={[inputStyle, styles.cell]}
          />
        ))}
      </View>
      <View style={styles.actions}>
        <Button title="Cancel" variant="secondary" onPress={onCancel} style={styles.action} />
        <Button title="Add" onPress={submit} disabled={!canAdd} style={styles.action} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 12, padding: 12, gap: 8 },
  title: { fontSize: 16, fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, height: 40, fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  cell: { flexBasis: '30%', flexGrow: 1 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
});
