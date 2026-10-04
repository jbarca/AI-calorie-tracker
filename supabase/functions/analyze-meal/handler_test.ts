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

/**
 * A fake of the small part of supabase-js the handler uses. Each query resolves against
 * in-memory state; writes are recorded for assertions.
 */
class FakeSupabase {
  user: { id: string } | null = { id: USER_ID };
  scan: Row | null = {
    id: SCAN_ID,
    image_path: `${USER_ID}/${SCAN_ID}.jpg`,
    status: 'pending',
    raw_result: null,
  };
  recentScanCount = 0;
  photo: Uint8Array | null = JPEG;
  updates: Row[] = [];
  inserts: Row[] = [];
  countFilters: unknown[][] = [];
  downloads: string[] = [];

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
        return Promise.resolve(
          this.photo
            ? { data: new Blob([this.photo as BlobPart]), error: null }
            : { data: null, error: new Error('not found') },
        );
      },
    }),
  };

  from(_table: string) {
    return new FakeQuery(this);
  }
}

class FakeQuery {
  private ops: [string, unknown[]][] = [];
  constructor(private db: FakeSupabase) {}
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
  neq(...a: unknown[]) {
    return this.op('neq', a);
  }
  gte(...a: unknown[]) {
    return this.op('gte', a);
  }
  maybeSingle() {
    return Promise.resolve(this.resolve());
  }
  single() {
    return Promise.resolve(this.resolve());
  }
  then<T>(onFulfilled: (v: unknown) => T, onRejected?: (e: unknown) => T) {
    return Promise.resolve(this.resolve()).then(onFulfilled, onRejected);
  }
  private resolve(): Row {
    const has = (name: string) => this.ops.find(([n]) => n === name);
    const update = has('update');
    if (update) {
      this.db.updates.push(update[1][0] as Row);
      return { error: null };
    }
    const insert = has('insert');
    if (insert) {
      this.db.inserts.push(insert[1][0] as Row);
      return { data: { id: TEXT_SCAN_ID }, error: null };
    }
    const select = has('select');
    if ((select?.[1][1] as { head?: boolean } | undefined)?.head) {
      this.db.countFilters.push(...this.ops.filter(([n]) => n !== 'select'));
      return { count: this.db.recentScanCount, error: null };
    }
    return { data: this.db.scan, error: null };
  }
}

function setup(respond: ConstructorParameters<typeof FakeAnthropic>[0], db = new FakeSupabase()) {
  const anthropic = new FakeAnthropic(respond);
  const deps: HandlerDeps = {
    anthropic,
    createUserClient: () => db as unknown as SupabaseClient,
    createAdminClient: () => db as unknown as SupabaseClient,
    config: { rateLimitPerHour: 30, effort: 'medium' },
    now: () => new Date('2026-10-04T12:00:00Z'),
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
  assertEquals(await res.json(), { scan_id: SCAN_ID, analysis: VALID_ANALYSIS });
  assertEquals(db.downloads, [`${USER_ID}/${SCAN_ID}.jpg`]);

  const content = anthropic.calls[0]!.messages[0]!.content;
  assert(Array.isArray(content) && content[0]?.type === 'image');
  assert(content[0].source.type === 'base64');
  assertEquals(content[0].source.media_type, 'image/png');
  assertEquals(content[0].source.data, btoa(String.fromCharCode(...PNG)));
  assert(content[1]?.type === 'text' && content[1].text.includes('with ketchup'));

  assertEquals(db.updates.length, 1);
  assertEquals(db.updates[0]!.status, 'complete');
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
  db.scan = { ...db.scan!, status: 'complete', raw_result: { analysis: VALID_ANALYSIS } };
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 200);
  assertEquals((await res.json()).analysis, VALID_ANALYSIS);
  assertEquals(anthropic.calls.length, 0);
});

Deno.test('rate limit: N other scans in the last hour is 429, before any AI call', async () => {
  const db = new FakeSupabase();
  db.recentScanCount = 30;
  const { handler, anthropic } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 429);
  assertEquals(anthropic.calls.length, 0);
  assertEquals(db.downloads.length, 0);
  // Counts the last hour only, excluding the scan being analysed.
  assertEquals(db.countFilters, [
    ['gte', ['created_at', '2026-10-04T11:00:00.000Z']],
    ['neq', ['id', SCAN_ID]],
  ]);
  await res.body?.cancel();
});

Deno.test('rate limit: under the limit proceeds', async () => {
  const db = new FakeSupabase();
  db.recentScanCount = 29;
  const { handler } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 200);
  await res.body?.cancel();
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
  await res.body?.cancel();
});

Deno.test('missing photo in storage is 404', async () => {
  const db = new FakeSupabase();
  db.photo = null;
  const { handler } = setup(ok, db);
  const res = await handler(post({ scan_id: SCAN_ID }));
  assertEquals(res.status, 404);
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
  assertEquals(db.inserts, [{ user_id: USER_ID, image_path: null, status: 'pending' }]);
  assertEquals(db.downloads.length, 0);
  const content = anthropic.calls[0]!.messages[0]!.content;
  assert(Array.isArray(content) && content.length === 1 && content[0]?.type === 'text');
  assert(content[0].text.includes('two boiled eggs'));
  assertEquals(db.updates[0]!.status, 'complete');
});

Deno.test('system prompt is long enough to be cacheable (512-token minimum)', () => {
  // ~4 characters per token for English prose; keep a comfortable margin.
  assert(SYSTEM_PROMPT.length > 3000, `system prompt is only ${SYSTEM_PROMPT.length} chars`);
});
