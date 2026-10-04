# analyze-meal accuracy eval (planned)

Status: **planned, not implemented yet.** Nothing in this folder calls the Anthropic API.

The goal is a small, repeatable baseline for how close the model's calorie estimates are to the
truth, so that prompt edits, effort changes (`ANALYZE_EFFORT`), and model upgrades can be compared
on numbers rather than impressions.

## Dataset

- About **20 labeled meal photos**, stored under `eval/photos/` (JPEG, resized to ~1024px on the
  long edge, as the app uploads them).
- A `eval/labels.json` file with one entry per photo:

  ```json
  {
    "file": "chicken-rice-01.jpg",
    "total_kcal": 610,
    "items": [{ "name": "grilled chicken breast", "grams": 150, "kcal": 248 }],
    "hint": null,
    "source": "weighed at home; USDA FDC values"
  }
  ```

- Ground truth comes from **weighing the food before photographing it** and computing kcal from
  USDA FoodData Central (or from the label for packaged foods). Restaurant dishes without weights
  are excluded, because their "truth" is itself an estimate.
- Cover a spread of cases: single whole foods, composite plates, mixed dishes (curry, pasta),
  drinks, packaged items with visible labels, a large and a small portion of the same food, two or
  three photos without a scale reference, and two non-food photos (expected `is_food: false`).

## Metrics

- **MAPE** (mean absolute percentage error) of `total_kcal` over food photos:
  `mean(|predicted - actual| / actual) * 100`. This is the headline number.
- Median absolute percentage error, and the share of meals within ±20% of the truth.
- Signed mean error (bias), to show whether the model systematically over- or under-estimates.
- Non-food accuracy: whether the non-food photos return `is_food: false` with no items.
- Calibration check: MAPE broken down by the items' `confidence`. A `low` rating should carry a
  visibly higher error than a `high` one.
- Operational numbers per run: refusals, schema failures, `max_tokens` truncations, mean output
  tokens, and latency.

## Planned runner

`eval/run.ts` (Deno) will import `analyzeWithClaude` from `../claude.ts`, so it exercises the exact
request the function sends (prompt, schema, effort, fallbacks). For each labeled photo it will:

1. base64-encode the photo and call `analyzeWithClaude` with a real `Anthropic` client;
2. record the analysis, `response.model`, `stop_reason`, and `usage`;
3. write a timestamped `eval/results/<date>-<effort>.json` and print a summary table.

It will take `--effort low|medium|high` so effort levels can be compared side by side (start with
`medium`, the function default, and `low`).

Running it costs money: about 20 Opus 5.5 vision calls per effort level. It must only be run by
hand with `ANTHROPIC_API_KEY` set. It must never run in CI or as part of `npm run test:functions`.

## Using the results

The first run on `medium` is the baseline. Record its MAPE in this README. Later changes to
`prompt.ts`, `ANALYZE_EFFORT`, or the model should be kept only if they hold or improve MAPE
without a meaningful cost or latency regression.
