/**
 * Pure accuracy metrics for the analyze-meal eval (no I/O, no API). Tested by metrics_test.ts;
 * used by run.ts.
 */

/** One evaluated image. `predicted_*` are null when the call did not produce an analysis. */
export interface EvalRow {
  image: string;
  true_kcal: number;
  /** Ground truth: false for photos that do not show food. */
  expected_is_food: boolean;
  /** 'ok' or the failure kind (refused, truncated, invalid_output, error). */
  outcome: string;
  predicted_kcal: number | null;
  predicted_is_food: boolean | null;
  tokens: number;
  latency_ms: number;
  model: string | null;
  error?: string;
}

export interface EvalSummary {
  images: number;
  /** Food photos with an analysis, i.e. the rows the kcal metrics are computed over. */
  scored_food: number;
  failures: number;
  /** Mean absolute percentage error of total kcal, in percent. Null when nothing is scored. */
  mape: number | null;
  /** Mean signed percentage error (positive = overestimates), in percent. */
  bias_pct: number | null;
  /** Mean signed error in kcal (positive = overestimates). */
  bias_kcal: number | null;
  /** Share (0-1) of scored food photos within ±20% of the truth. */
  within_20: number | null;
  /** Non-food photos (expected is_food false) with an analysis. */
  scored_non_food: number;
  /** Share (0-1) of scored non-food photos the model reported as is_food: false. */
  non_food_accuracy: number | null;
  total_tokens: number;
}

/** Signed percentage error of one prediction; positive means an overestimate. */
export function percentError(predicted: number, actual: number): number {
  if (!(actual > 0)) throw new RangeError(`true_kcal must be > 0, got ${actual}`);
  return ((predicted - actual) / actual) * 100;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function summarize(rows: readonly EvalRow[]): EvalSummary {
  const food = rows.filter(
    (r) => r.expected_is_food && r.outcome === 'ok' && r.predicted_kcal !== null,
  );
  const nonFood = rows.filter(
    (r) => !r.expected_is_food && r.outcome === 'ok' && r.predicted_is_food !== null,
  );
  const pct = food.map((r) => percentError(r.predicted_kcal!, r.true_kcal));

  return {
    images: rows.length,
    scored_food: food.length,
    failures: rows.filter((r) => r.outcome !== 'ok').length,
    mape: mean(pct.map(Math.abs)),
    bias_pct: mean(pct),
    bias_kcal: mean(food.map((r) => r.predicted_kcal! - r.true_kcal)),
    within_20: pct.length === 0 ? null : pct.filter((p) => Math.abs(p) <= 20).length / pct.length,
    scored_non_food: nonFood.length,
    non_food_accuracy:
      nonFood.length === 0
        ? null
        : nonFood.filter((r) => r.predicted_is_food === false).length / nonFood.length,
    total_tokens: rows.reduce((sum, r) => sum + r.tokens, 0),
  };
}

/** Input + output + cache read/write tokens of one response's `usage`. */
export function totalTokens(usage: {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}): number {
  return (
    usage.input_tokens +
    usage.output_tokens +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0)
  );
}

function fmt(value: number | null, digits = 1, suffix = ''): string {
  return value === null ? 'n/a' : `${value.toFixed(digits)}${suffix}`;
}

function table(header: string[], body: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((row) => row[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
  return [line(header), line(widths.map((w) => '-'.repeat(w))), ...body.map(line)].join('\n');
}

/** Plain-text report: one row per image, then the aggregates. */
export function formatReport(rows: readonly EvalRow[], summary: EvalSummary): string {
  const perImage = table(
    ['image', 'food?', 'true', 'pred', 'err %', 'outcome', 'tokens', 'ms'],
    rows.map((r) => [
      r.image,
      r.expected_is_food ? 'yes' : 'no',
      r.expected_is_food ? String(r.true_kcal) : '-',
      r.predicted_kcal === null ? '-' : String(Math.round(r.predicted_kcal)),
      r.expected_is_food && r.predicted_kcal !== null
        ? fmt(percentError(r.predicted_kcal, r.true_kcal), 1)
        : r.predicted_is_food === null
          ? '-'
          : `is_food=${r.predicted_is_food}`,
      r.outcome,
      String(r.tokens),
      String(r.latency_ms),
    ]),
  );
  const aggregates = table(
    ['metric', 'value'],
    [
      ['images', String(summary.images)],
      ['failures', String(summary.failures)],
      ['scored food photos', String(summary.scored_food)],
      ['MAPE', fmt(summary.mape, 1, '%')],
      ['mean bias', `${fmt(summary.bias_pct, 1, '%')} (${fmt(summary.bias_kcal, 0, ' kcal')})`],
      ['within ±20%', fmt(summary.within_20 === null ? null : summary.within_20 * 100, 0, '%')],
      [
        'non-food accuracy',
        summary.non_food_accuracy === null
          ? 'n/a'
          : `${fmt(summary.non_food_accuracy * 100, 0, '%')} of ${summary.scored_non_food}`,
      ],
      ['total tokens', String(summary.total_tokens)],
    ],
  );
  return `${perImage}\n\n${aggregates}`;
}
