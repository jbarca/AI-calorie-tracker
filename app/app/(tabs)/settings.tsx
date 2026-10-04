import { parseKcalGoal } from '@calorie/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { DeleteAccountDialog } from '@/components/DeleteAccountDialog';
import { Text, useColors } from '@/components/Themed';
import { useProfile, useUpdateKcalGoal } from '@/hooks/useProfile';
import { deleteAccount, DeleteAccountError } from '@/lib/api';
import { signOut } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/SessionProvider';

export default function SettingsScreen() {
  const colors = useColors();
  const { session } = useSession();

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <GoalSection />

      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <Text style={styles.cardTitle}>Account</Text>
        <Text style={{ color: colors.muted }}>{session?.user.email ?? 'Signed in'}</Text>
        <Button
          title="Sign out"
          variant="secondary"
          onPress={() =>
            void signOut().catch(() => Alert.alert('Could not sign out', 'Try again.'))
          }
        />
        <DeleteAccountSection />
      </View>
    </ScrollView>
  );
}

function DeleteAccountSection() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setPending(true);
    setError(null);
    try {
      await deleteAccount();
    } catch (err) {
      setPending(false);
      setError(
        err instanceof DeleteAccountError
          ? err.message
          : 'Your account was not deleted. Try again.',
      );
      return;
    }
    // The account is gone. Sign out through the usual path (the auth guard then leaves the
    // app); if the server call fails because the user no longer exists, drop the local session.
    try {
      await signOut();
    } catch {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    }
    queryClient.clear();
  };

  return (
    <>
      <Button
        title="Delete account"
        variant="danger"
        onPress={() => {
          setError(null);
          setOpen(true);
        }}
      />
      <DeleteAccountDialog
        visible={open}
        pending={pending}
        error={error}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}

function GoalSection() {
  const colors = useColors();
  const profile = useProfile();
  const update = useUpdateKcalGoal();
  const saved = profile.data?.daily_kcal_goal;
  // null = the field shows the saved goal; a string = the user is typing.
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? (saved !== undefined ? String(saved) : '');
  const parsed = parseKcalGoal(value);
  const dirty = draft !== null && parsed.ok && parsed.value !== saved;

  const save = () => {
    if (!parsed.ok) return;
    update.mutate(parsed.value, {
      onSuccess: () => setDraft(null),
      onError: () => Alert.alert('Could not save goal', 'Check your connection and try again.'),
    });
  };

  return (
    <View style={[styles.card, { backgroundColor: colors.card }]}>
      <Text style={styles.cardTitle}>Daily calorie goal</Text>
      <View style={styles.goalRow}>
        <TextInput
          accessibilityLabel="Daily calorie goal in kcal"
          value={value}
          onChangeText={setDraft}
          keyboardType="number-pad"
          maxLength={5}
          editable={!profile.isLoading}
          placeholder={profile.isLoading ? 'Loading…' : '2000'}
          placeholderTextColor={colors.muted}
          style={[styles.input, { color: colors.text, borderColor: colors.border }]}
        />
        <Text style={{ color: colors.muted }}>kcal</Text>
      </View>
      {draft !== null && !parsed.ok ? (
        <Text style={{ color: colors.danger }}>{parsed.error}</Text>
      ) : null}
      {profile.error ? (
        <Text style={{ color: colors.danger }}>Could not load your goal.</Text>
      ) : null}
      <Button title="Save goal" onPress={save} disabled={!dirty} loading={update.isPending} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 16 },
  card: { borderRadius: 12, padding: 16, gap: 12 },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    height: 44,
    paddingHorizontal: 12,
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
});
