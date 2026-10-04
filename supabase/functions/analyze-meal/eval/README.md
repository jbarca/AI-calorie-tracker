# analyze-meal accuracy eval

A small, repeatable baseline for how close the model's calorie estimates are to the truth, so that
prompt edits, effort changes (`ANALYZE_EFFORT`) and model upgrades can be compared on numbers
rather than impressions.

`run.ts` calls `analyzeWithClaude` from `../claude.ts`, so it sends exactly the request the
function sends (prompt, schema, effort, fallbacks). **It calls the real Anthropic API and costs
money.** It never runs in CI, and `npm run test:functions` does not execute it (only
`metrics_test.ts`, which tests the pure metric functions in `metrics.ts`).

## Files

| File                   | Committed | What it is                                              |
| ---------------------- | --------- | ------------------------------------------------------- |
| `run.ts`               | yes       | The runner                                              |
| `metrics.ts`           | yes       | Pure metric and report functions (tested)               |
| `metrics_test.ts`      | yes       | Deno tests for `metrics.ts`                             |
| `dataset.example.json` | yes       | Example labels                                          |
| `dataset.json`         | your call | Your labels (copy the example)                          |
| `photos/`              | no        | Your labelled photos (gitignored: they may be personal) |
| `results/`             | no        | One `<timestamp>.json` per run (gitignored)             |

## Dataset

Copy `dataset.example.json` to `dataset.json` and add one entry per photo in `photos/`:

```json
[
  { "image": "chicken-rice-01.jpg", "true_kcal": 610, "notes": "weighed; USDA FDC" },
  { "image": "desk-keyboard-01.jpg", "true_kcal": 0, "is_food": false, "notes": "non-food" }
]
```

- `image`: file name under `photos/` (JPEG, PNG or WebP, under 5 MB; resize to ~1024 px on the
  long edge, as the app does).
- `true_kcal`: ground truth. Must be > 0 for food photos; use 0 for non-food photos.
- `is_food` (optional, default `true`): set `false` for control photos that show no food.
- `notes` (optional): how the truth was measured.

Ground truth comes from **weighing the food before photographing it** and computing kcal from USDA
FoodData Central (or the label for packaged foods). Leave out restaurant dishes without weights,
because their "truth" is itself an estimate. Aim for about 20 photos covering single whole foods,
composite plates, mixed dishes (curry, pasta), drinks, packaged items with visible labels, a large
and a small portion of the same food, a few photos without a scale reference, and two non-food
photos.

## Running

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export ANALYZE_EFFORT=medium        # optional: low | medium | high | xhigh | max

# From the repo root. Without --yes it only prints the image count and the cost reminder.
deno task --config supabase/functions/analyze-meal/deno.json eval
deno task --config supabase/functions/analyze-meal/deno.json eval --limit 3 --yes   # smoke test
deno task --config supabase/functions/analyze-meal/deno.json eval --yes             # full run
```

The task runs with `--allow-net=api.anthropic.com`, read access to `eval/` and write access to
`eval/results/` only. Each image is one Opus 5.5 vision call; a full run of 20 photos is 20 calls.
Missing photos and an invalid `dataset.json` are reported before any call is made.

## Output

A per-image table (truth, prediction, signed % error, outcome, tokens, latency), then:

- **MAPE**: mean absolute percentage error of `total_kcal` over food photos that got an analysis.
  The headline number.
- **Mean bias**: mean signed % error and mean signed kcal error. Positive means the model
  overestimates.
- **Within ±20%**: share of food photos within 20% of the truth.
- **Non-food accuracy**: share of non-food photos the model reported as `is_food: false`.
- **Failures**: refusals, truncations, invalid output and errors. These are left out of the kcal
  metrics, so check this count before trusting the MAPE.
- **Total tokens**: input + output + cache tokens across the run.

The same summary plus every row (with the serving model) is written to
`results/<timestamp>.json`.

## Using the results

The first full run on `medium` is the baseline. Record it here:

| Date | Effort | Photos | MAPE | Bias | Within ±20% | Non-food |
| ---- | ------ | ------ | ---- | ---- | ----------- | -------- |
| —    | —      | —      | —    | —    | —           | —        |

Later changes to `prompt.ts`, `ANALYZE_EFFORT` or the model should be kept only if they hold or
improve MAPE without a meaningful cost or latency regression.
