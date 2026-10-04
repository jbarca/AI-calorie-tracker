import { assertAlmostEquals, assertEquals, assertStringIncludes, assertThrows } from '@std/assert';
import { type EvalRow, formatReport, percentError, summarize, totalTokens } from './metrics.ts';

function row(partial: Partial<EvalRow>): EvalRow {
  return {
    image: 'x.jpg',
    true_kcal: 500,
    expected_is_food: true,
    outcome: 'ok',
    predicted_kcal: 500,
    predicted_is_food: true,
    tokens: 100,
    latency_ms: 1000,
    model: 'claude-opus-5-5',
    ...partial,
  };
}

Deno.test('percentError: signed, relative to the truth', () => {
  assertEquals(percentError(600, 500), 20);
  assertEquals(percentError(400, 500), -20);
  assertThrows(() => percentError(100, 0), RangeError);
});

Deno.test('summarize: MAPE, bias, ±20% hit rate over food rows', () => {
  const s = summarize([
    row({ image: 'a', true_kcal: 500, predicted_kcal: 600 }), // +20%
    row({ image: 'b', true_kcal: 400, predicted_kcal: 300 }), // -25%
    row({ image: 'c', true_kcal: 200, predicted_kcal: 210 }), // +5%
  ]);
  assertEquals(s.images, 3);
  assertEquals(s.scored_food, 3);
  assertEquals(s.failures, 0);
  assertAlmostEquals(s.mape!, 50 / 3);
  assertAlmostEquals(s.bias_pct!, 0);
  assertAlmostEquals(s.bias_kcal!, (100 - 100 + 10) / 3);
  assertAlmostEquals(s.within_20!, 2 / 3);
  assertEquals(s.non_food_accuracy, null);
  assertEquals(s.total_tokens, 300);
});

Deno.test('summarize: failures and non-food rows are kept out of the kcal metrics', () => {
  const s = summarize([
    row({ image: 'a', true_kcal: 500, predicted_kcal: 450 }), // -10%
    row({ image: 'b', outcome: 'refused', predicted_kcal: null, predicted_is_food: null }),
    row({
      image: 'c',
      expected_is_food: false,
      true_kcal: 0,
      predicted_kcal: 0,
      predicted_is_food: false,
    }),
    row({
      image: 'd',
      expected_is_food: false,
      true_kcal: 0,
      predicted_kcal: 90,
      predicted_is_food: true,
    }),
    row({
      image: 'e',
      expected_is_food: false,
      outcome: 'error',
      predicted_kcal: null,
      predicted_is_food: null,
      tokens: 0,
    }),
  ]);
  assertEquals(s.images, 5);
  assertEquals(s.failures, 2);
  assertEquals(s.scored_food, 1);
  assertAlmostEquals(s.mape!, 10);
  assertAlmostEquals(s.bias_pct!, -10);
  assertEquals(s.within_20, 1);
  assertEquals(s.scored_non_food, 2);
  assertEquals(s.non_food_accuracy, 0.5);
  assertEquals(s.total_tokens, 400);
});

Deno.test('summarize: empty input gives nulls, not NaN', () => {
  const s = summarize([]);
  assertEquals(s.mape, null);
  assertEquals(s.bias_pct, null);
  assertEquals(s.within_20, null);
  assertEquals(s.non_food_accuracy, null);
  assertEquals(s.total_tokens, 0);
});

Deno.test('totalTokens: adds cache tokens, tolerating nulls', () => {
  assertEquals(totalTokens({ input_tokens: 10, output_tokens: 5 }), 15);
  assertEquals(
    totalTokens({
      input_tokens: 10,
      output_tokens: 5,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: 100,
    }),
    115,
  );
});

Deno.test('formatReport: per-image rows and aggregates', () => {
  const rows = [row({ image: 'plate.jpg', predicted_kcal: 550 })];
  const report = formatReport(rows, summarize(rows));
  assertStringIncludes(report, 'plate.jpg');
  assertStringIncludes(report, '10.0');
  assertStringIncludes(report, 'MAPE');
  assertStringIncludes(report, 'non-food accuracy');
});
