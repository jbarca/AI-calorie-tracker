import { parseKcalGoal } from '@calorie/shared';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { Text, useColors } from '@/components/Themed';
import { useProfile, useUpdateKcalGoal } from '@/hooks/useProfile';
import { deleteAccount } from '@/lib/api';
import { signOut } from '@/lib/auth';
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
        <Button title="Delete account" variant="danger" onPress={confirmDeleteAccount} />
      </View>
    </ScrollView>
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

function confirmDeleteAccount() {
  Alert.alert(
    'Delete account?',
    'This permanently deletes your account, meals and photos. This cannot be undone.',
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          // TODO(backend): `delete-account` Edge Function not built yet; see lib/api.ts.
          deleteAccount()
            .then(() => signOut())
            .catch(() =>
              Alert.alert(
                'Coming soon',
                'Account deletion is not available yet. Contact support to delete your account.',
              ),
            );
        },
      },
    ],
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
