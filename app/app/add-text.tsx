import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, TextInput } from 'react-native';

import { Button } from '@/components/Button';
import { ErrorNotice } from '@/components/ErrorNotice';
import { Text, useColors } from '@/components/Themed';
import { useAnalyze } from '@/hooks/useAnalyze';

const MAX_LENGTH = 1000;

/** Manual entry: describe a meal in words; analyze-meal estimates it with no photo. */
export default function AddTextScreen() {
  const colors = useColors();
  const [text, setText] = useState('');
  const { analyzing, error, analyzeDescription } = useAnalyze();
  const canSubmit = text.trim().length > 0 && !analyzing;
  const submit = () => {
    if (canSubmit) void analyzeDescription(text);
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.fill, { backgroundColor: colors.background }]}
    >
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Text style={[styles.help, { color: colors.muted }]}>
          Describe what you ate, with amounts if you know them. You can adjust everything on the
          next screen.
        </Text>
        <TextInput
          accessibilityLabel="Meal description"
          value={text}
          onChangeText={setText}
          placeholder="e.g. two boiled eggs, a slice of wholegrain toast with butter, black coffee"
          placeholderTextColor={colors.muted}
          multiline
          maxLength={MAX_LENGTH}
          autoFocus
          editable={!analyzing}
          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        />
        {error ? (
          <ErrorNotice
            title={error.title}
            message={error.message}
            primary={error.retryable ? { title: 'Retry', onPress: submit } : undefined}
          />
        ) : null}
        <Button
          title="Estimate calories"
          onPress={submit}
          disabled={!canSubmit}
          loading={analyzing}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  container: { padding: 16, gap: 12 },
  help: { fontSize: 14, lineHeight: 20 },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    minHeight: 120,
    padding: 12,
    fontSize: 16,
    textAlignVertical: 'top',
  },
});
