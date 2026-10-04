import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assert, assertEquals } from '@std/assert';
import { createHandler, type HandlerDeps } from './handler.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import { FakeAnthropic, fakeMessage, textMessage, VALID_ANALYSIS } from './test_helpers.ts';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const SCAN_ID = '22222222-2222-4222-8222-222222222222';
const TEXT_SCAN_ID = '33333333-3333-4333-8333-333333333333';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const HEIC = new Uint8Array([0, 0, 0, 0x18, ...new TextEncoder().encode('ftypheic'), 0, 0, 0, 0]);

type Row = Record<string, unknown>;
type ClientKind = 'user' | 'admin';
type Op = [string, unknown[]];

/**
 * A fake of the small part of supabase-js the handler uses. Each query resolves against
 * in-memory state; writes are recorded for assertions (and applied to the matching scan row).
 * `as('user')` / `as('admin')` return views that tag every query with the client it went through.
 *
 * `rpc('claim_analysis')` mirrors the SQL function: not_found / complete / busy (status
 * processing) / rate_limited (attempts >= p_limit) / claimed (records an attempt and marks the
 * scan processing). The real function is tested with pgTAP in supabase/tests.
 */
class FakeSupabase {
  user: { id: string } | null = { id: USER_ID };
  scan: Row | null = {
    id: SCAN_ID,
    user_id: USER_ID,
    image_path: `${USER_ID}/${SCAN_ID}.jpg`,
    status: 'pending',
    raw_result: null,
  };
  /** Created by a text-entry insert. */
  textScan: Row | null = null;
  /** Analysis attempts this user made in the last hour (the rate-limit counter). */
  attempts = 0;
  /** Forces the claim_analysis result instead of simulating it. */
  claimOverride: string | null = null;
  rpcError: Error | null = null;
  /** Makes scan result writes fail. */
  updateError: Error | null = null;
  photo: Uint8Array | null = JPEG;
  photoThrows = false;
  updates: Row[] = [];
  inserts: Row[] = [];
  downloads: string[] = [];
  rpcs: { client: ClientKind; fn: string; args: Row }[] = [];
  /** Order of side effects: 'claim', 'download', 'update:<status>'. */
  events: string[] = [];
  /** Every scans query, with the client it went through and its builder calls. */
  queries: { client: ClientKind; ops: Op[] }[] = [];

  auth = {
    getUser: (_token: string) =>
      Promise.resolve(
        this.user
          ? { data: { user: this.user }, error: null }
          : { data: { user: null }, error: new Error('invalid jwt') },
      ),
  };

  storage = {
    from: (_bucket: string) => ({
      download: (path: string) => {
        this.downloads.push(path);
        this.events.push('download');
        if (this.photoThrows) {
          return Promise.reject(new TypeError('network exploded'));
        }
        return Promise.resolve(
          this.photo
            ? { data: new Blob([this.photo as BlobPart]), error: null }
            : { data: null, error: new Error('not found') },
        );
      },
    }),
  };

  findScan(id: unknown): Row | null {
    return [this.scan, this.textScan].find((s) => s && s.id === id) ?? null;
  }

  rpc(client: ClientKind, fn: string, args: Row) {
    this.rpcs.push({ client, fn, args });
    this.events.push('claim');
    if (this.rpcError) {
      return Promise.resolve({ data: null, error: this.rpcError });
    }
    if (this.claimOverride) {
      return Promise.resolve({ data: this.claimOverride, error: null });
    }
    const row = this.findScan(args.p_scan);
    let result: string;
    if (!row || row.user_id !== args.p_user) result = 'not_found';
    else if (row.status === 'complete') result = 'complete';
    else if (row.status === 'processing') result = 'busy';
    else if (this.attempts >= (args.p_limit as number)) result = 'rate_limited';
    else {
      this.attempts++;
      row.status = 'processing';
      result = 'claimed';
    }
    return Promise.resolve({ data: result, error: null });
  }

  as(client: ClientKind): SupabaseClient {
    return {
      auth: this.auth,
      storage: this.storage,
      from: (_table: string) => new FakeQuery(this, client),
      rpc: (fn: string, args: Row) => this.rpc(client, fn, args),
    } as unknown as SupabaseClient;
  }

  /** Queries that used `op`, as `{ client, filters }` (filters = everything but select/insert/update). */
  queriesWith(op: string) {
    return this.queries
      .filter((q) => q.ops.some(([n]) => n === op))
      .map((q) => ({
        client: q.client,
        filters: q.ops.filter(
          ([n]) => !['select', 'insert', 'update', 'single', 'maybeSingle'].includes(n),
        ),
      }));
  }
}

class FakeQuery {
  private ops: Op[] = [];
  constructor(
    private db: FakeSupabase,
    private client: ClientKind,
  ) {}
  private op(name: string, args: unknown[]) {
    this.ops.push([name, args]);
    return this;
  }
  select(...a: unknown[]) {
    return this.op('select', a);
  }
  insert(...a: unknown[]) {
    return this.op('insert', a);
  }
  update(...a: unknown[]) {
    return this.op('update', a);
  }
  eq(...a: unknown[]) {
    return this.op('eq', a);
  }
  maybeSingle() {
    return Promise.resolve(this.op('maybeSingle', []).resolve());
  }
  single() {
    return Promise.resolve(this.op('single', []).resolve());
  }
  then<T>(onFulfilled: (v: unknown) => T, onRejected?: (e: unknown) => T) {
    return Promise.resolve(this.resolve()).then(onFulfilled, onRejected);
  }
  private resolve(): Row {
    this.db.queries.push({ client: this.client, ops: this.ops });
    const has = (name: string) => this.ops.find(([n]) => n === name);
    const idFilter = this.ops.find(([n, a]) => n === 'eq' && a[0] === 'id')?.[1][1];
    const update = has('update');
    if (update) {
      const values = update[1][0] as Row;
      this.db.updates.push(values);
      this.db.events.push(`update:${values.status}`);
      const row = this.db.findScan(idFilter);
      if (this.db.updateError) return { error: this.db.updateError };
      if (row) Object.assign(row, values);
      return { error: null };
    }
    const insert = has('insert');
    if (insert) {
      this.db.inserts.push(insert[1][0] as Row);
      this.db.textScan = {
        id: TEXT_SCAN_ID,
        status: 'pending',
        ...(insert[1][0] as Row),
      };
      return { data: { id: TEXT_SCAN_ID }, error: null };
    }
    return { data: this.db.findScan(idFilter), error: null };
  }
}

function setup(respond: ConstructorParameters<typeof FakeAnthropic>[0], db = new FakeSupabase()) {
  const anthropic = new FakeAnthropic(respond);
  const deps: HandlerDeps = {
    anthropic,
    createUserClient: () => db.as('user'),
    createAdminClient: () => db.as('admin'),
    config: { rateLimitPerHour: 30, effort: 'medium' },
  };
  return { handler: createHandler(deps), anthropic, db };
}

function post(body: unknown, auth: string | null = 'Bearer test-jwt'): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (auth) headers.set('Authorization', auth);
  return new Request('http://localhost/analyze-meal', {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const ok = () => textMessage(VALID_ANALYSIS);

Deno.test('OPTIONS returns CORS headers', async () => {
  const { handler } = setup(ok);
  const res = await handler(new Request('http://localhost', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
  await res.body?.cancel();
});

Deno.test('non-POST is 405', async () => {
  const { handler } = setup(ok);
  const res = await handler(new Request('http://localhost', { method: 'GET' }));
  assertEquals(res.status, 405);
  await res.body?.cancel();
});

Deno.test('missing bearer token is 401', async () => {
  const { handler, anthropic } = setup(ok);
  const res = await handler(post({ scan_id: SCAN_ID }, null));
  assertEquals(res.status, 401);
  assertEquals(anthropic.calls.length, 0);
  await res.body?.cancel();
});

Deno.test('unknown user is 401', async () => {
  const db = new FakeSupabase();
  db.user = null;
  const { handler } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 401);
  await res.body?.cancel();
});

Deno.test('invalid bodies are 400', async () => {
  const { handler, anthropic } = setup(ok);
  for (const body of [
    'not json',
    {},
    { scan_id: 'nope' },
    { scan_id: SCAN_ID, text: 'both' },
    { text: '   ' },
  ]) {
    const res = await handler(post(body));
    assertEquals(res.status, 400, JSON.stringify(body));
    await res.body?.cancel();
  }
  assertEquals(anthropic.calls.length, 0);
});

Deno.test('scan not visible through RLS is 404', async () => {
  const db = new FakeSupabase();
  db.scan = null;
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 404);
  assertEquals(anthropic.calls.length, 0);
  await res.body?.cancel();
});

Deno.test('scan success: downloads, calls Claude, saves complete + serving model', async () => {
  const db = new FakeSupabase();
  db.photo = PNG; // bytes win over the .jpg extension
  const { handler, anthropic } = setup(
    () => textMessage(VALID_ANALYSIS, { model: 'claude-opus-5-5' }),
    db,
  );
  const res = await handler(post({ scan_id: SCAN_ID, hint: 'with ketchup' }));

  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    scan_id: SCAN_ID,
    analysis: VALID_ANALYSIS,
  });
  assertEquals(db.downloads, [`${USER_ID}/${SCAN_ID}.jpg`]);

  const content = anthropic.calls[0]!.messages[0]!.content;
  assert(Array.isArray(content) && content[0]?.type === 'image');
  assert(content[0].source.type === 'base64');
  assertEquals(content[0].source.media_type, 'image/png');
  assertEquals(content[0].source.data, btoa(String.fromCharCode(...PNG)));
  assert(content[1]?.type === 'text' && content[1].text.includes('with ketchup'));

  assertEquals(db.updates.length, 1);
  assertEquals(db.updates[0]!.status, 'complete');
  // Results are written with the service role (users cannot update these columns), scoped to
  // the caller's own row.
  assertEquals(db.queriesWith('update'), [
    {
      client: 'admin',
      filters: [
        ['eq', ['id', SCAN_ID]],
        ['eq', ['user_id', USER_ID]],
      ],
    },
  ]);
  assertEquals(db.updates[0]!.model, 'claude-opus-5-5');
  assertEquals((db.updates[0]!.raw_result as Row).analysis, VALID_ANALYSIS);
});

Deno.test('fallback-served response records the fallback model', async () => {
  const { handler, db } = setup(() => textMessage(VALID_ANALYSIS, { model: 'claude-opus-5' }));
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 200);
  assertEquals(db.updates[0]!.model, 'claude-opus-5');
  await res.body?.cancel();
});

Deno.test('completed scan returns the stored analysis without calling Claude', async () => {
  const db = new FakeSupabase();
  db.scan = {
    ...db.scan!,
    status: 'complete',
    raw_result: { analysis: VALID_ANALYSIS },
  };
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).analysis, VALID_ANALYSIS);
  assertEquals(anthropic.calls.length, 0);
});

Deno.test(
  'claim: called with the service role, scoped to the caller, before any AI call',
  async () => {
    const db = new FakeSupabase();
    let statusAtClaude: unknown;
    const { handler } = setup(() => {
      statusAtClaude = db.scan!.status;
      return ok();
    }, db);
    const res = await handler(post({ scan_id: SCAN_ID }));
    assertEquals(res.status, 200);
    assertEquals(db.rpcs, [
      {
        client: 'admin',
        fn: 'claim_analysis',
        args: { p_user: USER_ID, p_scan: SCAN_ID, p_limit: 30, p_stale: '3 minutes' },
      },
    ]);
    assertEquals(db.events, ['download', 'claim', 'update:complete']);
    assertEquals(statusAtClaude, 'processing');
    assertEquals(db.attempts, 1);
    assertEquals(db.scan!.status, 'complete');
    await res.body?.cancel();
  },
);

Deno.test('rate limit: rate_limited claim is 429, with no AI call', async () => {
  const db = new FakeSupabase();
  db.attempts = 30;
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 429);
  assertEquals(await res.json(), {
    error: 'rate_limited',
    message: 'Limit of 30 analyses per hour reached. Try again later.',
  });
  assertEquals(anthropic.calls.length, 0);
  assertEquals(db.downloads.length, 1);
  // The scan was not claimed, so it is left as it was.
  assertEquals(db.updates, []);
  assertEquals(db.scan!.status, 'pending');
});

Deno.test('rate limit: under the limit proceeds', async () => {
  const db = new FakeSupabase();
  db.attempts = 29;
  const { handler } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 200);
  await res.body?.cancel();
});

Deno.test(
  'busy: a scan already being analysed is 409, with no AI call or status write',
  async () => {
    const db = new FakeSupabase();
    db.scan = { ...db.scan!, status: 'processing' };
    const { handler, anthropic } = setup(ok, db);
    const res = await handler(post({ scan_id: SCAN_ID }));
    assertEquals(res.status, 409);
    assertEquals((await res.json()).error, 'analysis_in_progress');
    assertEquals(anthropic.calls.length, 0);
    assertEquals(db.downloads.length, 1);
    // The other request owns the claim; this one must not overwrite its status.
    assertEquals(db.updates, []);
    assertEquals(db.scan!.status, 'processing');
    assertEquals(db.attempts, 0);
  },
);

Deno.test('busy: concurrent requests for one scan make a single AI call', async () => {
  const db = new FakeSupabase();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { handler, anthropic } = setup(async () => {
    await gate;
    return ok();
  }, db);
  const first = handler(post({ scan_id: SCAN_ID }));
  // Let the first request reach Claude (and so hold the claim) before the duplicates arrive.
  for (let spins = 0; anthropic.calls.length === 0; spins++) {
    assert(spins < 1000, 'first request never reached Claude');
    await new Promise((r) => setTimeout(r, 0));
  }
  const dupes = await Promise.all([
    handler(post({ scan_id: SCAN_ID })),
    handler(post({ scan_id: SCAN_ID })),
  ]);
  release();
  const res = await first;
  assertEquals(res.status, 200);
  assertEquals(
    dupes.map((r) => r.status),
    [409, 409],
  );
  assertEquals(anthropic.calls.length, 1);
  assertEquals(db.attempts, 1);
  await Promise.all([res, ...dupes].map((r) => r.body?.cancel()));
});

Deno.test('retry: a failed scan claims again, and the retry counts as an attempt', async () => {
  const db = new FakeSupabase();
  db.attempts = 28;
  let calls = 0;
  const { handler, anthropic } = setup(() => {
    calls++;
    if (calls === 1) throw new Anthropic.APIConnectionTimeoutError();
    return ok();
  }, db);

  const first = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(first.status, 503);
  assertEquals(db.scan!.status, 'failed');
  assertEquals(db.attempts, 29);
  await first.body?.cancel();

  const retry = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(retry.status, 200);
  assertEquals(db.attempts, 30);
  assertEquals(db.rpcs.length, 2);
  assertEquals(anthropic.calls.length, 2);
  await retry.body?.cancel();

  // The retries used up the hourly limit: the next new analysis is refused.
  db.scan = { ...db.scan!, status: 'failed' };
  const third = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(third.status, 429);
  assertEquals(anthropic.calls.length, 2);
  await third.body?.cancel();
});

Deno.test('claim: a scan completed by another request returns its stored analysis', async () => {
  const db = new FakeSupabase();
  // Pending when loaded, complete by the time we claim.
  db.scan = { ...db.scan!, raw_result: { analysis: VALID_ANALYSIS } };
  db.claimOverride = 'complete';
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 200);
  assertEquals(await res.json(), {
    scan_id: SCAN_ID,
    analysis: VALID_ANALYSIS,
  });
  assertEquals(anthropic.calls.length, 0);
  assertEquals(db.downloads.length, 1);
  assertEquals(db.updates, []);
  // Re-read with the service role, scoped to the caller.
  assertEquals(db.queriesWith('maybeSingle').at(-1), {
    client: 'admin',
    filters: [
      ['eq', ['id', SCAN_ID]],
      ['eq', ['user_id', USER_ID]],
    ],
  });
});

Deno.test('claim: not_found is 404', async () => {
  const db = new FakeSupabase();
  db.claimOverride = 'not_found';
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, 'scan_not_found');
  assertEquals(anthropic.calls.length, 0);
  assertEquals(db.downloads.length, 1);
});

Deno.test('claim: an rpc error is 500, with no AI call', async () => {
  for (const [rpcError, override] of [
    [new Error('db down'), null],
    [null, 'something-unexpected'],
  ] as const) {
    const db = new FakeSupabase();
    db.rpcError = rpcError;
    db.claimOverride = override;
    const { handler, anthropic } = setup(ok, db);
    const res = await handler(post({ scan_id: SCAN_ID }));
    assertEquals(res.status, 500);
    assertEquals((await res.json()).error, 'internal');
    assertEquals(anthropic.calls.length, 0);
    assertEquals(db.downloads.length, 1);
    assertEquals(db.updates, []);
  }
});

Deno.test('image path outside the caller folder is 403', async () => {
  const db = new FakeSupabase();
  db.scan = { ...db.scan!, image_path: `someone-else/${SCAN_ID}.jpg` };
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 403);
  assertEquals(db.downloads.length, 0);
  assertEquals(anthropic.calls.length, 0);
  await res.body?.cancel();
});

Deno.test('HEIC photo is 415', async () => {
  const db = new FakeSupabase();
  db.photo = HEIC;
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 415);
  assertEquals(anthropic.calls.length, 0);
  // Rejected before the claim: no attempt is counted and the scan is left untouched.
  assertEquals(db.rpcs, []);
  assertEquals(db.updates, []);
  assertEquals(db.scan!.status, 'pending');
  await res.body?.cancel();
});

Deno.test('missing photo in storage is 404', async () => {
  const db = new FakeSupabase();
  db.photo = null;
  const { handler } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 404);
  assertEquals((await res.json()).error, 'image_not_found');
  // Rejected before the claim: no attempt is counted and the scan is left untouched.
  assertEquals(db.events, ['download']);
  assertEquals(db.rpcs, []);
  assertEquals(db.updates, []);
  assertEquals(db.scan!.status, 'pending');
});

Deno.test(
  'unexpected exception while loading the photo is 500, with no claim or status write',
  async () => {
    const db = new FakeSupabase();
    db.photoThrows = true;
    const { handler, anthropic } = setup(ok, db);
    const res = await handler(post({ scan_id: SCAN_ID }));
    assertEquals(res.status, 500);
    assertEquals(await res.json(), {
      error: 'internal',
      message: 'Unexpected error.',
      scan_id: SCAN_ID,
    });
    assertEquals(anthropic.calls.length, 0);
    assertEquals(db.rpcs, []);
    assertEquals(db.updates, []);
    assertEquals(db.scan!.status, 'pending');
  },
);

Deno.test('non-SDK error from the AI call is 500 and marks the scan failed', async () => {
  const { handler, db } = setup(() => {
    throw new TypeError('boom');
  });
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 500);
  assertEquals(db.updates.length, 1);
  assertEquals(db.scan!.status, 'failed');
  await res.body?.cancel();
});

Deno.test('refusal is 422 and the scan is marked refused', async () => {
  const { handler, db } = setup(() => fakeMessage({ stop_reason: 'refusal' }));
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 422);
  assertEquals((await res.json()).error, 'refused');
  assertEquals(db.updates[0]!.status, 'refused');
  assertEquals(db.updates[0]!.model, 'claude-opus-5-5');
});

Deno.test('max_tokens is 502 and the scan is marked failed', async () => {
  const { handler, db } = setup(() => textMessage('{"is_food": tr', { stop_reason: 'max_tokens' }));
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error, 'output_truncated');
  assertEquals(db.updates[0]!.status, 'failed');
});

Deno.test('schema-invalid output is 502 and the scan is marked failed', async () => {
  const { handler, db } = setup(() => textMessage({ is_food: true }));
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 502);
  assertEquals((await res.json()).error, 'invalid_output');
  assertEquals(db.updates[0]!.status, 'failed');
});

Deno.test('SDK errors map to 429 / 503 / 502 and mark the scan failed', async () => {
  const h = new Headers();
  const cases: [Error, number][] = [
    [new Anthropic.RateLimitError(429, undefined, 'slow down', h), 429],
    [new Anthropic.APIConnectionTimeoutError(), 503],
    [new Anthropic.APIConnectionError({ message: 'reset' }), 503],
    [new Anthropic.InternalServerError(500, undefined, 'boom', h), 502],
  ];
  for (const [err, status] of cases) {
    const { handler, db } = setup(() => {
      throw err;
    });
    const res = await handler(post({ scan_id: SCAN_ID }));
    assertEquals(res.status, status, err.constructor.name);
    assertEquals((await res.json()).scan_id, SCAN_ID);
    assertEquals(db.updates[0]!.status, 'failed');
    assertEquals(db.updates[0]!.model, null);
  }
});

Deno.test('text-only entry creates a scan row and analyses the text', async () => {
  const { handler, anthropic, db } = setup(ok);
  const res = await handler(post({ text: 'two boiled eggs and a slice of toast' }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).scan_id, TEXT_SCAN_ID);
  // status / created_at are left to the database, which forces them on client inserts.
  assertEquals(db.inserts, [{ user_id: USER_ID, image_path: null }]);
  assertEquals(
    db.queriesWith('insert').map((q) => q.client),
    ['user'],
  );
  assertEquals(db.downloads.length, 0);
  // The new row is claimed (with the service role) before the AI call.
  assertEquals(db.rpcs, [
    {
      client: 'admin',
      fn: 'claim_analysis',
      args: { p_user: USER_ID, p_scan: TEXT_SCAN_ID, p_limit: 30, p_stale: '3 minutes' },
    },
  ]);
  assertEquals(db.events, ['claim', 'update:complete']);
  assertEquals(db.attempts, 1);
  const content = anthropic.calls[0]!.messages[0]!.content;
  assert(Array.isArray(content) && content.length === 1 && content[0]?.type === 'text');
  assert(content[0].text.includes('two boiled eggs'));
  assertEquals(db.updates[0]!.status, 'complete');
  assertEquals(db.queriesWith('update'), [
    {
      client: 'admin',
      filters: [
        ['eq', ['id', TEXT_SCAN_ID]],
        ['eq', ['user_id', USER_ID]],
      ],
    },
  ]);
});

Deno.test('rate limit: text entries are counted too', async () => {
  const db = new FakeSupabase();
  db.attempts = 30;
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ text: 'a banana' }));
  assertEquals(res.status, 429);
  assertEquals((await res.json()).error, 'rate_limited');
  assertEquals(anthropic.calls.length, 0);
  // The row is inserted, then the claim is refused; it is closed off rather than left pending.
  assertEquals(db.inserts.length, 1);
  assertEquals(db.rpcs[0]!.args.p_scan, TEXT_SCAN_ID);
  assertEquals(db.updates, [
    { status: 'failed', raw_result: { error: 'rate_limited' }, model: null },
  ]);
  assertEquals(db.textScan!.status, 'failed');
});

Deno.test('scan is loaded through the user client (RLS proves ownership)', async () => {
  const { handler, db } = setup(ok);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 200);
  const lookup = db.queries.find((q) => q.ops.some(([n]) => n === 'maybeSingle'));
  assertEquals(lookup?.client, 'user');
  await res.body?.cancel();
});

Deno.test('system prompt is long enough to be cacheable (512-token minimum)', () => {
  // ~4 characters per token for English prose; keep a comfortable margin.
  assert(SYSTEM_PROMPT.length > 3000, `system prompt is only ${SYSTEM_PROMPT.length} chars`);
});

Deno.test('photo over 5 MB is 413, before any claim', async () => {
  const db = new FakeSupabase();
  db.photo = new Uint8Array(5 * 1024 * 1024 + 1);
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 413);
  assertEquals((await res.json()).error, 'image_too_large');
  assertEquals(anthropic.calls.length, 0);
  assertEquals(db.rpcs, []);
  assertEquals(db.updates, []);
});

Deno.test('scan without a photo is 400 no_image', async () => {
  const db = new FakeSupabase();
  db.scan = { ...db.scan!, image_path: null };
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error, 'no_image');
  assertEquals(anthropic.calls.length, 0);
  assertEquals(db.rpcs, []);
});

Deno.test('image path with .. inside the caller folder is 403', async () => {
  const db = new FakeSupabase();
  db.scan = { ...db.scan!, image_path: `${USER_ID}/../someone-else/${SCAN_ID}.jpg` };
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 403);
  assertEquals(db.downloads.length, 0);
  assertEquals(anthropic.calls.length, 0);
  await res.body?.cancel();
});

Deno.test('claim rpc failure on a text entry closes the new scan as failed', async () => {
  const db = new FakeSupabase();
  db.rpcError = new Error('db down');
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ text: 'a banana' }));
  assertEquals(res.status, 500);
  assertEquals(anthropic.calls.length, 0);
  assertEquals(db.updates, [
    { status: 'failed', raw_result: { error: 'claim_failed' }, model: null },
  ]);
});

Deno.test('busy on a text entry is 409 and leaves the new scan alone', async () => {
  const db = new FakeSupabase();
  db.claimOverride = 'busy';
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ text: 'a banana' }));
  assertEquals(res.status, 409);
  assertEquals((await res.json()).error, 'analysis_in_progress');
  assertEquals(anthropic.calls.length, 0);
  assertEquals(db.updates, []);
});

Deno.test('a failed result write is logged but the analysis is still returned', async () => {
  const db = new FakeSupabase();
  db.updateError = new Error('write failed');
  const { handler } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).scan_id, SCAN_ID);
});
