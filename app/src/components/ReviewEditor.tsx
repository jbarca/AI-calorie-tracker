import {
  draftFromManualInput,
  draftReducer,
  sumMacros,
  toMealItemRow,
  validateDraft,
  type DraftItem,
  type MealType,
} from '@calorie/shared';
import { useReducer, useRef, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, View } from 'react-native';

import { AddItemForm } from '@/components/AddItemForm';
import { Button } from '@/components/Button';
import { FoodItemRow } from '@/components/FoodItemRow';
import { MacroBar } from '@/components/MacroBar';
import { MealTypePicker } from '@/components/MealTypePicker';
import { Text, useColors } from '@/components/Themed';
import { useSaveMeal } from '@/hooks/useMeals';

type Props = {
  initialItems: DraftItem[];
  initialMealType: MealType;
  /** Set when editing a saved meal. */
  mealId: string | null;
  scanId: string | null;
  photoUrl: string | undefined;
  /** The model's assumptions, e.g. "assumed 1 tbsp oil". */
  notes: string | null;
  onSaved: () => void;
};

/** The editable result: photo, items, meal type, totals and Save. */
export function ReviewEditor({
  initialItems,
  initialMealType,
  mealId,
  scanId,
  photoUrl,
  notes,
  onSaved,
}: Props) {
  const colors = useColors();
  const [items, dispatch] = useReducer(draftReducer, initialItems);
  const [mealType, setMealType] = useState(initialMealType);
  const [adding, setAdding] = useState(false);
  const nextKey = useRef(0);
  const save = useSaveMeal();
  const totals = sumMacros(items);
  const problem = validateDraft(items);

  const onSave = () => {
    if (problem) return;
    const keptIds = new Set(items.map((i) => i.dbId).filter(Boolean));
    save.mutate(
      {
        mealId,
        scanId,
        mealType,
        items: items.map(toMealItemRow),
        removedItemIds: initialItems
          .map((i) => i.dbId)
          .filter((id): id is string => !!id && !keptIds.has(id)),
      },
      {
        onSuccess: onSaved,
        onError: (err) =>
          Alert.alert('Could not save', err instanceof Error ? err.message : 'Try again.'),
      },
    );
  };

  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.photo} accessibilityLabel="Meal photo" />
      ) : null}

      <MealTypePicker value={mealType} onChange={setMealType} />

      <View style={[styles.summary, { backgroundColor: colors.card }]}>
        <Text style={styles.total}>{totals.kcal} kcal</Text>
        <MacroBar totals={totals} />
      </View>

      {notes ? (
        <Text style={[styles.notes, { color: colors.muted }]}>
          <Text style={styles.notesLabel}>AI notes: </Text>
          {notes}
        </Text>
      ) : null}

      {items.map((item) => (
        <FoodItemRow
          key={item.key}
          item={item}
          onRename={(name) => dispatch({ type: 'rename', key: item.key, name })}
          onGramsChange={(grams) => dispatch({ type: 'setGrams', key: item.key, grams })}
          onRemove={() => dispatch({ type: 'remove', key: item.key })}
        />
      ))}

      {adding ? (
        <AddItemForm
          onCancel={() => setAdding(false)}
          onAdd={(input) => {
            dispatch({
              type: 'add',
              item: draftFromManualInput(input, `new-${nextKey.current++}`),
            });
            setAdding(false);
          }}
        />
      ) : (
        <Button title="+ Add item" variant="secondary" onPress={() => setAdding(true)} />
      )}

      {problem && items.length > 0 ? (
        <Text style={[styles.problem, { color: colors.danger }]}>{problem}</Text>
      ) : null}
      <Button
        title={mealId ? 'Save changes' : 'Save to log'}
        onPress={onSave}
        disabled={!!problem}
        loading={save.isPending}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  photo: { width: '100%', aspectRatio: 4 / 3, borderRadius: 12 },
  summary: { borderRadius: 12, padding: 12, gap: 10 },
  total: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  notes: { fontSize: 13, lineHeight: 19 },
  notesLabel: { fontWeight: '700' },
  problem: { fontSize: 14, textAlign: 'center' },
});
