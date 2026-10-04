import type { SupabaseClient } from '@supabase/supabase-js';
import { assert, assertEquals } from '@std/assert';
import { BUCKET, createHandler, MAX_LIST_CALLS, PAGE_SIZE } from './handler.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_USER_ID = '99999999-9999-4999-8999-999999999999';

type StorageError = { message: string } | null;

/**
 * A fake of the small part of supabase-js the handler uses: auth.getUser, a meal-photos bucket
 * held as a set of object paths, and auth.admin.deleteUser. Calls are recorded for assertions.
 */
class FakeSupabase {
  user: { id: string } | null = { id: USER_ID };
  objects = new Set<string>();
  listError: StorageError = null;
  removeError: StorageError = null;
  /** When true, remove() reports success but deletes nothing (exercises the loop cap). */
  removeIsNoop = false;
  deleteUserError: StorageError = null;

  buckets: string[] = [];
  listCalls: { folder: string; limit: number; offset: number }[] = [];
  removeCalls: string[][] = [];
  deletedUsers: string[] = [];
  getUserTokens: string[] = [];

  addPhotos(userId: string, count: number, folder = '') {
    for (let i = 0; i < count; i++) {
      this.objects.add(`${userId}/${folder}${String(i).padStart(4, '0')}.jpg`);
    }
  }

  auth = {
    getUser: (token: string) => {
      this.getUserTokens.push(token);
      return Promise.resolve(
        this.user
          ? { data: { user: this.user }, error: null }
          : { data: { user: null }, error: new Error('invalid jwt') },
      );
    },
    admin: {
      deleteUser: (id: string) => {
        this.deletedUsers.push(id);
        return Promise.resolve({ data: { user: null }, error: this.deleteUserError });
      },
    },
  };

  storage = {
    from: (bucket: string) => {
      this.buckets.push(bucket);
      return {
        list: (folder: string, opts: { limit: number; offset: number }) => {
          this.listCalls.push({ folder, ...opts });
          if (this.listError) return Promise.resolve({ data: null, error: this.listError });
          // Direct children of `folder`, like Storage: files have an id, sub-folders don't.
          const children = new Map<string, string | null>();
          for (const path of this.objects) {
            if (!path.startsWith(`${folder}/`)) continue;
            const rest = path.slice(folder.length + 1);
            const slash = rest.indexOf('/');
            if (slash === -1) children.set(rest, `id-${path}`);
            else children.set(rest.slice(0, slash), null);
          }
          const data = [...children.entries()]
            .sort(([a], [b]) => a.localeCompare(b))
            .slice(opts.offset, opts.offset + opts.limit)
            .map(([name, id]) => ({ name, id }));
          return Promise.resolve({ data, error: null });
        },
        remove: (paths: string[]) => {
          this.removeCalls.push(paths);
          if (this.removeError) return Promise.resolve({ data: null, error: this.removeError });
          if (!this.removeIsNoop) for (const p of paths) this.objects.delete(p);
          return Promise.resolve({ data: [], error: null });
        },
      };
    },
  };

  client(): SupabaseClient {
    return { auth: this.auth, storage: this.storage } as unknown as SupabaseClient;
  }
}

function setup() {
  const fake = new FakeSupabase();
  const authHeaders: string[] = [];
  let adminClients = 0;
  const handler = createHandler({
    createUserClient: (authHeader) => {
      authHeaders.push(authHeader);
      return fake.client();
    },
    createAdminClient: () => {
      adminClients++;
      return fake.client();
    },
  });
  return { fake, handler, authHeaders, adminClients: () => adminClients };
}

function request(
  body: unknown = { confirm: 'DELETE' },
  init: { method?: string; auth?: string | null } = {},
): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const auth = init.auth === undefined ? 'Bearer test-jwt' : init.auth;
  if (auth !== null) headers.set('Authorization', auth);
  const method = init.method ?? 'POST';
  return new Request('http://localhost/delete-account', {
    method,
    headers,
    body: method === 'GET' || method === 'OPTIONS' ? undefined : JSON.stringify(body),
  });
}

/** Runs `fn` with console.log/error silenced, returning the logged lines. */
async function captureLogs<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const { log, error } = console;
  console.log = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  console.error = (...args: unknown[]) => void lines.push(args.map(String).join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = log;
    console.error = error;
  }
}

Deno.test('OPTIONS returns the CORS preflight', async () => {
  const { handler, fake } = setup();
  const res = await handler(request(undefined, { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  await res.body?.cancel();
  assertEquals(fake.getUserTokens, []);
});

Deno.test('non-POST methods get 405', async () => {
  const { handler, fake } = setup();
  const res = await handler(request(undefined, { method: 'GET' }));
  assertEquals(res.status, 405);
  assertEquals((await res.json()).error, 'method_not_allowed');
  assertEquals(fake.deletedUsers, []);
});

Deno.test('a missing bearer token gets 401', async () => {
  const { handler, fake } = setup();
  const res = await handler(request(undefined, { auth: null }));
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, 'unauthorized');
  assertEquals(fake.getUserTokens, []);
  assertEquals(fake.deletedUsers, []);
});

Deno.test('an invalid token gets 401 and deletes nothing', async () => {
  const { handler, fake, adminClients } = setup();
  fake.user = null;
  fake.addPhotos(USER_ID, 3);
  const res = await handler(request());
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, 'unauthorized');
  assertEquals(fake.getUserTokens, ['test-jwt']);
  assertEquals(adminClients(), 0);
  assertEquals(fake.objects.size, 3);
  assertEquals(fake.deletedUsers, []);
});

Deno.test('the body must be exactly { confirm: "DELETE" }', async () => {
  const bodies: unknown[] = [
    {},
    { confirm: 'delete' },
    { confirm: 'DELETE ' },
    { confirm: true },
    { confirm: 'DELETE', extra: 1 },
    ['DELETE'],
    null,
  ];
  for (const body of bodies) {
    const { handler, fake } = setup();
    fake.addPhotos(USER_ID, 2);
    const res = await handler(request(body));
    assertEquals(res.status, 400, `body ${JSON.stringify(body)}`);
    assertEquals((await res.json()).error, 'invalid_body');
    assertEquals(fake.listCalls, []);
    assertEquals(fake.deletedUsers, []);
  }

  const { handler } = setup();
  const res = await handler(
    new Request('http://localhost/delete-account', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-jwt' },
      body: 'not json',
    }),
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'invalid_body');
});

Deno.test('removes every photo across pages, then deletes the user', async () => {
  const { handler, fake, authHeaders } = setup();
  fake.addPhotos(USER_ID, 250);
  fake.addPhotos(OTHER_USER_ID, 5);

  const { result: res, lines } = await captureLogs(() => handler(request()));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: true });
  assertEquals(authHeaders, ['Bearer test-jwt']);

  // 100 + 100 + 50, then an empty list ends the loop. Every list re-reads from offset 0.
  assertEquals(
    fake.removeCalls.map((paths) => paths.length),
    [PAGE_SIZE, PAGE_SIZE, 50],
  );
  assertEquals(fake.listCalls.length, 4);
  assert(fake.listCalls.every((c) => c.folder === USER_ID && c.offset === 0));
  assert(fake.listCalls.every((c) => c.limit === PAGE_SIZE));
  assert(fake.removeCalls.flat().every((p) => p.startsWith(`${USER_ID}/`)));
  assert(fake.buckets.every((b) => b === BUCKET));

  // Only the caller's folder is touched.
  assertEquals(
    [...fake.objects].filter((p) => p.startsWith(`${USER_ID}/`)),
    [],
  );
  assertEquals(fake.objects.size, 5);
  assertEquals(fake.deletedUsers, [USER_ID]);

  // The log carries the user id and counts, nothing else.
  assertEquals(lines.length, 1);
  assertEquals(JSON.parse(lines[0]), {
    event: 'delete_account',
    user_id: USER_ID,
    outcome: 'deleted',
    photos_removed: 250,
  });
});

Deno.test('also empties sub-folders under the user folder', async () => {
  const { handler, fake } = setup();
  fake.addPhotos(USER_ID, 3);
  fake.addPhotos(USER_ID, 120, 'old/');

  const { result: res } = await captureLogs(() => handler(request()));
  assertEquals(res.status, 200);
  assertEquals(fake.objects.size, 0);
  assert(fake.listCalls.some((c) => c.folder === `${USER_ID}/old`));
  assertEquals(fake.deletedUsers, [USER_ID]);
});

Deno.test('an empty photo folder still deletes the user', async () => {
  const { handler, fake } = setup();
  const { result: res } = await captureLogs(() => handler(request()));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { deleted: true });
  assertEquals(fake.listCalls.length, 1);
  assertEquals(fake.removeCalls, []);
  assertEquals(fake.deletedUsers, [USER_ID]);
});

Deno.test('a storage list error returns 500 and keeps the user', async () => {
  const { handler, fake } = setup();
  fake.addPhotos(USER_ID, 10);
  fake.listError = { message: 'storage unavailable' };
  const { result: res, lines } = await captureLogs(() => handler(request()));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, 'storage_failed');
  assertEquals(fake.deletedUsers, []);
  assertEquals(JSON.parse(lines[0]).outcome, 'storage_failed');
});

Deno.test('a storage remove error returns 500 and keeps the user', async () => {
  const { handler, fake } = setup();
  fake.addPhotos(USER_ID, 10);
  fake.removeError = { message: 'remove failed' };
  const { result: res } = await captureLogs(() => handler(request()));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, 'storage_failed');
  assertEquals(fake.removeCalls.length, 1);
  assertEquals(fake.objects.size, 10);
  assertEquals(fake.deletedUsers, []);
});

Deno.test('a remove that deletes nothing stops at the loop cap and keeps the user', async () => {
  const { handler, fake } = setup();
  fake.addPhotos(USER_ID, 1);
  fake.removeIsNoop = true;
  const { result: res } = await captureLogs(() => handler(request()));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, 'storage_failed');
  assertEquals(fake.listCalls.length, MAX_LIST_CALLS);
  assertEquals(fake.deletedUsers, []);
});

Deno.test('a deleteUser error returns 500', async () => {
  const { handler, fake } = setup();
  fake.addPhotos(USER_ID, 2);
  fake.deleteUserError = { message: 'database error' };
  const { result: res, lines } = await captureLogs(() => handler(request()));
  assertEquals(res.status, 500);
  assertEquals((await res.json()).error, 'delete_failed');
  assertEquals(fake.deletedUsers, [USER_ID]);
  assertEquals(JSON.parse(lines[0]).outcome, 'delete_user_failed');
});
