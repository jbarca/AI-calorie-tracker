import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

// During static (server) rendering `getServerSnapshot` is used, so the server value is
// returned; once hydrated on the client the client value is returned.
export function useClientOnlyValue<S, C>(server: S, client: C): S | C {
  const isClient = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return isClient ? client : server;
}
