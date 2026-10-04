import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

import { supabase } from '@/lib/supabase';

type SessionState = {
  session: Session | null;
  /** True until the persisted session has been read from storage. */
  loading: boolean;
};

const SessionContext = createContext<SessionState>({ session: null, loading: true });

/** Tracks the Supabase session (restored from AsyncStorage, then via onAuthStateChange). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ session: null, loading: true });

  useEffect(() => {
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) setState({ session: data.session, loading: false });
      })
      .catch(() => {
        if (active) setState({ session: null, loading: false });
      });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setState({ session, loading: false });
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  return useContext(SessionContext);
}

/**
 * The signed-in user's id. Null for a moment after sign-out, while screens behind the auth
 * guard are still mounted, so callers must handle it rather than assume a session.
 */
export function useUserId(): string | null {
  return useSession().session?.user.id ?? null;
}
