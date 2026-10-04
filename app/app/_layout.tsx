import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Linking from 'expo-linking';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import 'react-native-reanimated';

import { useColorScheme } from '@/components/useColorScheme';
import { createSessionFromUrl } from '@/lib/auth';
import { SessionProvider, useSession } from '@/providers/SessionProvider';

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Keep the splash screen up until the persisted session has been restored, so signed-in users
// never see the sign-in screen flash.
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [queryClient] = useState(() => new QueryClient());
  const clearCache = useCallback(() => queryClient.clear(), [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AuthLinkHandler />
          <RootNavigator onSignOut={clearCache} />
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}

/** Auth guard: signed-in users get the app, everyone else only the (auth) group. */
function RootNavigator({ onSignOut }: { onSignOut: () => void }) {
  const { session, loading } = useSession();
  const signedIn = !!session;

  useEffect(() => {
    if (!loading) SplashScreen.hide();
  }, [loading]);

  // Drop cached data from the previous user when the session ends.
  useEffect(() => {
    if (!loading && !signedIn) onSignOut();
  }, [loading, signedIn, onSignOut]);

  return (
    <Stack>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="review/[scanId]" options={{ title: 'Review meal' }} />
        <Stack.Screen
          name="add-text"
          options={{ title: 'Add food by text', presentation: 'modal' }}
        />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

/**
 * Completes magic-link sign-ins: the email link opens `aicalorietracker://sign-in?code=...`
 * (cold start or while running) and the code is exchanged for a session here. The auth guard
 * then moves the user into the app.
 */
function AuthLinkHandler() {
  const url = Linking.useURL();

  useEffect(() => {
    if (!url) return;
    createSessionFromUrl(url).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : 'The sign-in link is invalid.';
      Alert.alert('Sign-in link failed', `${message} Request a new link or use the code.`);
    });
  }, [url]);

  return null;
}
