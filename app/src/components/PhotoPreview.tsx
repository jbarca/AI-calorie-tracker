import { Image, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Text, useColors } from '@/components/Themed';

type Props = {
  uri: string;
  hint: string;
  onHintChange: (hint: string) => void;
  analyzing: boolean;
  error: { title: string; message: string; canRetry: boolean } | null;
  onAnalyze: () => void;
  onRetake: () => void;
};

/** The captured photo, an optional hint for the AI, and Analyze / Retake actions. */
export function PhotoPreview({
  uri,
  hint,
  onHintChange,
  analyzing,
  error,
  onAnalyze,
  onRetake,
}: Props) {
  const colors = useColors();
  return (
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Image source={{ uri }} style={styles.photo} accessibilityLabel="Meal photo" />
      <TextInput
        accessibilityLabel="Hint for the AI (optional)"
        value={hint}
        onChangeText={onHintChange}
        placeholder='Optional hint, e.g. "large latte with oat milk"'
        placeholderTextColor={colors.muted}
        maxLength={500}
        editable={!analyzing}
        style={[styles.input, { color: colors.text, borderColor: colors.border }]}
      />
      {error ? (
        <ErrorNotice
          title={error.title}
          message={error.message}
          primary={error.canRetry ? { title: 'Retry', onPress: onAnalyze } : undefined}
          secondary={{ title: 'Retake', onPress: onRetake }}
        />
      ) : (
        <View style={styles.actions}>
          <Button
            title="Retake"
            variant="secondary"
            onPress={onRetake}
            disabled={analyzing}
            style={styles.action}
          />
          <Button title="Analyze" onPress={onAnalyze} loading={analyzing} style={styles.action} />
        </View>
      )}
      {analyzing ? (
        <Text style={[styles.status, { color: colors.muted }]}>
          Analyzing your meal… this usually takes a few seconds.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  photo: { width: '100%', aspectRatio: 3 / 4, borderRadius: 12 },
  input: { borderWidth: 1, borderRadius: 12, minHeight: 44, paddingHorizontal: 12, fontSize: 15 },
  actions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1 },
  status: { textAlign: 'center', fontSize: 14 },
});
