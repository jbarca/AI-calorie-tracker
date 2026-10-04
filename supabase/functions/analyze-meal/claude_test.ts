import Anthropic from '@anthropic-ai/sdk';
import { assert, assertEquals, assertExists, assertRejects } from '@std/assert';
import { analyzeWithClaude, FALLBACK_BETA, MAX_TOKENS, MODEL } from './claude.ts';
import { mapAnthropicError } from './errors.ts';
import { SYSTEM_PROMPT } from './prompt.ts';
import {
  FakeAnthropic,
  fakeMessage,
  NON_FOOD_ANALYSIS,
  textMessage,
  VALID_ANALYSIS,
} from './test_helpers.ts';

const IMAGE = { kind: 'image', mediaType: 'image/jpeg', base64: 'AAAA' } as const;

Deno.test('success: returns the validated analysis and the serving model', async () => {
  const client = new FakeAnthropic(() => textMessage(VALID_ANALYSIS));
  const out = await analyzeWithClaude(client, { ...IMAGE, hint: 'large portion' });

  assertEquals(out.kind, 'ok');
  if (out.kind !== 'ok') return;
  assertEquals(out.analysis, VALID_ANALYSIS);
  assertEquals(out.model, 'claude-opus-5-5');
});

Deno.test(
  'request: model, effort, format, fallbacks, cache breakpoint, no thinking/prefill',
  async () => {
    const client = new FakeAnthropic(() => textMessage(VALID_ANALYSIS));
    await analyzeWithClaude(client, { ...IMAGE, hint: 'oat milk latte' });

    assertEquals(client.calls.length, 1);
    const req = client.calls[0]!;
    assertEquals(req.model, MODEL);
    assertEquals(req.model, 'claude-opus-5-5');
    assertEquals(req.max_tokens, MAX_TOKENS);
    assertEquals(req.max_tokens, 16000);
    assertEquals('thinking' in req, false, 'thinking must not be sent on Opus 5.5');
    assertEquals('tool_choice' in req, false);
    assertEquals(req.output_config?.effort, 'medium');
    assertEquals(req.output_config?.format?.type, 'json_schema');
    assertExists(req.output_config?.format?.schema);
    assertEquals(req.betas, [FALLBACK_BETA]);
    assertEquals(req.betas, ['server-side-fallback-2026-07-01']);
    assertEquals(req.fallbacks, 'default');

    // Static system prompt with a cache breakpoint.
    assert(Array.isArray(req.system));
    assertEquals(req.system.length, 1);
    assertEquals(req.system[0]!.text, SYSTEM_PROMPT);
    assertEquals(req.system[0]!.cache_control, { type: 'ephemeral' });

    // One user turn (no assistant prefill): image first, then the text with the hint.
    assertEquals(req.messages.length, 1);
    assertEquals(req.messages[0]!.role, 'user');
    const content = req.messages[0]!.content;
    assert(Array.isArray(content));
    assertEquals(content[0], {
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
    });
    assert(content[1]?.type === 'text' && content[1].text.includes('oat milk latte'));
    assert(!SYSTEM_PROMPT.includes('oat milk latte'), 'hint must not leak into the system prompt');
  },
);

Deno.test('request: effort override and text-only input', async () => {
  const client = new FakeAnthropic(() => textMessage(VALID_ANALYSIS));
  await analyzeWithClaude(client, { kind: 'text', text: '2 eggs on toast' }, { effort: 'low' });

  const req = client.calls[0]!;
  assertEquals(req.output_config?.effort, 'low');
  const content = req.messages[0]!.content;
  assert(Array.isArray(content));
  assertEquals(content.length, 1);
  assert(content[0]?.type === 'text' && content[0].text.includes('2 eggs on toast'));
});

Deno.test('refusal: reported as refused with category, content not parsed', async () => {
  const client = new FakeAnthropic(() =>
    fakeMessage({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'bio', explanation: null },
      content: [],
    } as never),
  );
  const out = await analyzeWithClaude(client, IMAGE);
  assertEquals(out.kind, 'refused');
  if (out.kind !== 'refused') return;
  assertEquals(out.category, 'bio');
});

Deno.test('refusal: null stop_details is still a refusal', async () => {
  const client = new FakeAnthropic(() =>
    fakeMessage({ stop_reason: 'refusal', stop_details: null }),
  );
  const out = await analyzeWithClaude(client, IMAGE);
  assertEquals(out.kind, 'refused');
  if (out.kind === 'refused') assertEquals(out.category, null);
});

Deno.test('max_tokens: truncated output is reported, not parsed or thrown', async () => {
  const truncated = JSON.stringify(VALID_ANALYSIS).slice(0, 60);
  const client = new FakeAnthropic(() => textMessage(truncated, { stop_reason: 'max_tokens' }));
  const out = await analyzeWithClaude(client, IMAGE);
  assertEquals(out.kind, 'truncated');
});

Deno.test('non-food: is_food false with empty items is a successful analysis', async () => {
  const client = new FakeAnthropic(() => textMessage(NON_FOOD_ANALYSIS));
  const out = await analyzeWithClaude(client, IMAGE);
  assertEquals(out.kind, 'ok');
  if (out.kind !== 'ok') return;
  assertEquals(out.analysis.is_food, false);
  assertEquals(out.analysis.items, []);
});

Deno.test('schema-invalid output: wrong types or values are rejected', async () => {
  const bad = {
    ...VALID_ANALYSIS,
    items: [{ ...VALID_ANALYSIS.items[0], kcal: -5, confidence: 'certain' }],
  };
  const client = new FakeAnthropic(() => textMessage(bad));
  const out = await analyzeWithClaude(client, IMAGE);
  assertEquals(out.kind, 'invalid_output');
});

Deno.test('schema-invalid output: missing field is rejected', async () => {
  const { notes: _notes, ...missing } = VALID_ANALYSIS;
  const client = new FakeAnthropic(() => textMessage(missing));
  const out = await analyzeWithClaude(client, IMAGE);
  assertEquals(out.kind, 'invalid_output');
});

Deno.test('invalid output: non-JSON text and empty content', async () => {
  const notJson = new FakeAnthropic(() => textMessage('Here is your meal: chicken'));
  assertEquals((await analyzeWithClaude(notJson, IMAGE)).kind, 'invalid_output');

  const empty = new FakeAnthropic(() => fakeMessage({ content: [] }));
  assertEquals((await analyzeWithClaude(empty, IMAGE)).kind, 'invalid_output');
});

Deno.test(
  'fallback: reads the text after the fallback block and reports the serving model',
  async () => {
    const client = new FakeAnthropic(() =>
      fakeMessage({
        model: 'claude-opus-5',
        content: [
          { type: 'fallback', from: { model: 'claude-opus-5-5' }, to: { model: 'claude-opus-5' } },
          { type: 'text', text: JSON.stringify(VALID_ANALYSIS), citations: null },
        ],
      } as never),
    );
    const out = await analyzeWithClaude(client, IMAGE);
    assertEquals(out.kind, 'ok');
    assertEquals(out.model, 'claude-opus-5');
  },
);

Deno.test('API errors propagate as typed SDK errors', async () => {
  const client = new FakeAnthropic(() => {
    throw new Anthropic.RateLimitError(429, undefined, 'rate limited', new Headers());
  });
  await assertRejects(() => analyzeWithClaude(client, IMAGE), Anthropic.RateLimitError);
});

Deno.test('mapAnthropicError: most specific class wins', () => {
  const h = new Headers();
  assertEquals(
    mapAnthropicError(new Anthropic.RateLimitError(429, undefined, 'x', h))?.status,
    429,
  );
  assertEquals(
    mapAnthropicError(new Anthropic.APIConnectionTimeoutError())?.code,
    'upstream_timeout',
  );
  assertEquals(mapAnthropicError(new Anthropic.APIConnectionTimeoutError())?.status, 503);
  assertEquals(
    mapAnthropicError(new Anthropic.APIConnectionError({ message: 'reset' }))?.status,
    503,
  );
  assertEquals(
    mapAnthropicError(new Anthropic.InternalServerError(529, undefined, 'overloaded', h))?.status,
    502,
  );
  assertEquals(
    mapAnthropicError(new Anthropic.BadRequestError(400, undefined, 'x', h))?.status,
    502,
  );
  assertEquals(mapAnthropicError(new Error('not anthropic')), null);
});
