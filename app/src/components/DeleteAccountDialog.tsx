import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { Text, useColors } from '@/components/Themed';

/** The word the user must type before the delete button enables. */
export const DELETE_CONFIRMATION = 'DELETE';

type Props = {
  visible: boolean;
  /** True while the delete request is in flight. */
  pending: boolean;
  /** A message from the last failed attempt, shown inline. */
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Type-to-confirm dialog for permanently deleting the account. */
export function DeleteAccountDialog({ visible, ...props }: Props) {
  const cancel = () => {
    if (!props.pending) props.onCancel();
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={cancel}>
      {/* Mounted only while open, so the typed text starts empty each time. */}
      {visible ? <DialogBody {...props} onCancel={cancel} /> : null}
    </Modal>
  );
}

function DialogBody({ pending, error, onConfirm, onCancel }: Omit<Props, 'visible'>) {
  const colors = useColors();
  const [typed, setTyped] = useState('');
  const confirmed = typed.trim() === DELETE_CONFIRMATION;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.backdrop}
    >
      <View
        accessibilityViewIsModal
        style={[styles.dialog, { backgroundColor: colors.card, borderColor: colors.border }]}
      >
        <Text accessibilityRole="header" style={styles.title}>
          Delete account?
        </Text>
        <Text>
          This permanently deletes your account, every meal you have logged and all your meal
          photos. It cannot be undone.
        </Text>
        <Text style={{ color: colors.muted }}>Type {DELETE_CONFIRMATION} to confirm.</Text>
        <TextInput
          accessibilityLabel={`Type ${DELETE_CONFIRMATION} to confirm`}
          value={typed}
          onChangeText={setTyped}
          editable={!pending}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          placeholder={DELETE_CONFIRMATION}
          placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        />
        {error ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger }}>
            {error}
          </Text>
        ) : null}
        <Button
          title="Delete my account"
          variant="danger"
          onPress={onConfirm}
          disabled={!confirmed}
          loading={pending}
        />
        <Button title="Cancel" variant="secondary" onPress={onCancel} disabled={pending} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  dialog: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 16, gap: 12 },
  title: { fontSize: 18, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    height: 44,
    paddingHorizontal: 12,
    fontSize: 16,
  },
});
