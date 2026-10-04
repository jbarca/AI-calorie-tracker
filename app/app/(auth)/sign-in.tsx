import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { Text, useColors } from '@/components/Themed';
import { useColorScheme } from '@/components/useColorScheme';
import {
  appleSignInSupported,
  sendMagicLink,
  signInWithApple,
  signInWithGoogle,
  verifyEmailCode,
} from '@/lib/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Busy = 'link' | 'code' | 'apple' | 'google' | null;

const errorMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'Something went wrong. Try again.';

export default function SignInScreen() {
  const colors = useColors();
  const scheme = useColorScheme();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);

  // On success the auth guard in app/_layout.tsx navigates into the app.
  const run = async (kind: Exclude<Busy, null>, action: () => Promise<unknown>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const sendLink = () =>
    run('link', async () => {
      await sendMagicLink(email);
      setSentTo(email.trim());
    });

  const inputStyle = [styles.input, { color: colors.text, borderColor: colors.border }];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.safe}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>AI Calorie Tracker</Text>
          <Text style={[styles.subtitle, { color: colors.muted }]}>
            Snap a meal, get calories and macros in seconds.
          </Text>

          {sentTo ? (
            <View style={styles.section}>
              <Text style={styles.body}>
                We sent a sign-in link to <Text style={styles.bold}>{sentTo}</Text>. Open it on this
                phone, or enter the 6-digit code from the email.
              </Text>
              <TextInput
                accessibilityLabel="6-digit code"
                value={code}
                onChangeText={setCode}
                placeholder="123456"
                placeholderTextColor={colors.muted}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={10}
                style={[inputStyle, styles.code]}
              />
              <Button
                title="Verify code"
                onPress={() => run('code', () => verifyEmailCode(sentTo, code))}
                disabled={code.trim().length < 6 || busy !== null}
                loading={busy === 'code'}
              />
              <Button
                title="Use a different email"
                variant="secondary"
                onPress={() => {
                  setSentTo(null);
                  setCode('');
                  setError(null);
                }}
              />
            </View>
          ) : (
            <View style={styles.section}>
              <TextInput
                accessibilityLabel="Email address"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                textContentType="emailAddress"
                autoComplete="email"
                onSubmitEditing={sendLink}
                style={inputStyle}
              />
              <Button
                title="Email me a sign-in link"
                onPress={sendLink}
                disabled={!EMAIL_RE.test(email.trim()) || busy !== null}
                loading={busy === 'link'}
              />
            </View>
          )}

          {error ? (
            <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
              {error}
            </Text>
          ) : null}

          <View style={styles.divider}>
            <View style={[styles.rule, { backgroundColor: colors.border }]} />
            <Text style={{ color: colors.muted }}>or</Text>
            <View style={[styles.rule, { backgroundColor: colors.border }]} />
          </View>

          <View style={styles.section}>
            {appleSignInSupported ? (
              <AppleAuthentication.AppleAuthenticationButton
                buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                buttonStyle={
                  scheme === 'dark'
                    ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                    : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                }
                cornerRadius={12}
                style={styles.apple}
                onPress={() => void run('apple', signInWithApple)}
              />
            ) : null}
            <Button
              title="Continue with Google"
              variant="secondary"
              onPress={() => void run('google', signInWithGoogle)}
              disabled={busy !== null}
              loading={busy === 'google'}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 20 },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center' },
  subtitle: { fontSize: 15, textAlign: 'center' },
  section: { gap: 12 },
  body: { fontSize: 15, lineHeight: 22 },
  bold: { fontWeight: '700' },
  input: { borderWidth: 1, borderRadius: 12, height: 48, paddingHorizontal: 14, fontSize: 16 },
  code: { fontSize: 22, letterSpacing: 6, textAlign: 'center' },
  error: { fontSize: 14, textAlign: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rule: { flex: 1, height: StyleSheet.hairlineWidth },
  apple: { height: 48 },
});
