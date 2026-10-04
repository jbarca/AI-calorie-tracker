import * as AppleAuthentication from 'expo-apple-authentication';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Lets the auth popup close itself on web; a no-op on native.
WebBrowser.maybeCompleteAuthSession();

/**
 * Where Supabase sends the user back after a magic link or OAuth sign-in:
 * `aicalorietracker://sign-in` in builds, `exp://.../--/sign-in` in Expo Go. Both are in
 * `additional_redirect_urls` in supabase/config.toml.
 */
export function authRedirectUrl(): string {
  return Linking.createURL('sign-in');
}

/** Reads params from both the query string and the #fragment of a redirect URL. */
function redirectParams(url: string): URLSearchParams {
  const params = new URLSearchParams();
  const queryStart = url.indexOf('?');
  const hashStart = url.indexOf('#');
  if (queryStart >= 0) {
    const query = url.slice(queryStart + 1, hashStart > queryStart ? hashStart : undefined);
    new URLSearchParams(query).forEach((v, k) => params.set(k, v));
  }
  if (hashStart >= 0) {
    new URLSearchParams(url.slice(hashStart + 1)).forEach((v, k) => params.set(k, v));
  }
  return params;
}

const handledUrls = new Set<string>();

/**
 * Completes a sign-in from a deep link (magic link or OAuth redirect). Handles the PKCE
 * `?code=` form and the implicit `#access_token=` form. Returns false when the URL carries no
 * auth payload; throws with Supabase's message when the link is invalid or expired.
 */
export async function createSessionFromUrl(url: string): Promise<boolean> {
  const params = redirectParams(url);
  const errorDescription = params.get('error_description') ?? params.get('error');
  const code = params.get('code');
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!errorDescription && !code && !accessToken) return false;

  // The same URL can arrive twice (Linking listener + auth-session result).
  if (handledUrls.has(url)) return true;
  handledUrls.add(url);

  if (errorDescription) throw new Error(errorDescription);
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw error;
    return true;
  }
  if (accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw error;
    return true;
  }
  return false;
}

/** Emails a magic link that also contains a 6-digit code (for `verifyEmailCode`). */
export async function sendMagicLink(email: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    email: email.trim(),
    options: { emailRedirectTo: authRedirectUrl(), shouldCreateUser: true },
  });
  if (error) throw error;
}

export async function verifyEmailCode(email: string, code: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim(),
    token: code.trim(),
    type: 'email',
  });
  if (error) throw error;
}

export const appleSignInSupported = Platform.OS === 'ios';

/**
 * Native Sign in with Apple (iOS only), exchanged for a Supabase session via the identity token.
 * Returns false if the user cancelled. Requires the Apple provider to be enabled in Supabase with
 * the app's bundle id as an authorized client id.
 */
export async function signInWithApple(): Promise<boolean> {
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) throw new Error('Apple did not return an identity token.');
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: credential.identityToken,
    });
    if (error) throw error;
    return true;
  } catch (err) {
    if (err instanceof Error && 'code' in err && err.code === 'ERR_REQUEST_CANCELED') return false;
    throw err;
  }
}

/**
 * Google sign-in through Supabase's hosted OAuth flow in an in-app browser session (works on
 * iOS and Android, no Google SDK). Returns false if the user closed the browser. Requires the
 * Google provider to be enabled in Supabase.
 */
export async function signInWithGoogle(): Promise<boolean> {
  const redirectTo = authRedirectUrl();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== 'success') return false;
  return createSessionFromUrl(result.url);
}

export async function signOut(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
