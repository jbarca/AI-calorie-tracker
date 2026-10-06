# Accuracy eval: repeatable process

How to measure how close `analyze-meal`'s calorie estimates are to the truth, and how to repeat
that measurement whenever something changes. The runner and metrics are documented in
[`supabase/functions/analyze-meal/eval/README.md`](../supabase/functions/analyze-meal/eval/README.md);
this file is the step-by-step procedure.

> **This costs money.** Every photo is one real Claude call with the same prompt and settings as
> the live app. Run it on your own machine; it never runs in CI.

## When to run it

Run a full eval (step 5) and log the result (step 7) whenever any of these change:

- `supabase/functions/analyze-meal/prompt.ts` (the system prompt)
- `supabase/functions/analyze-meal/claude.ts` (model, request settings)
- the `ANALYZE_EFFORT` value you deploy with
- the shared `MealAnalysis` schema in `packages/shared/src/analysis.ts`
- the dataset itself (new or relabelled photos)

Also re-run it about once a month, even with no changes, to catch model-side drift.

## Checklist

Copy this into your notes for each run:

```
[ ] 1. Code pulled, Deno 2 available
[ ] 2. Photos in eval/photos/ (eval:fetch, plus any of your own)
[ ] 3. Labels in eval/dataset.json match the photos
[ ] 4. Dry run passes (no API calls)
[ ] 5. Smoke test on 3 photos, then the full run
[ ] 6. Failures = 0, results read
[ ] 7. Row added to the run log below
[ ] 8. Change kept or reverted
```

## 1. Prepare

```bash
git pull
deno --version   # needs Deno 2; if missing: npm i -g deno
```

All commands below run from the repository root.

## 2. Get the photos

`eval/dataset.json` already lists a public reference set of 134 photos with measured calories:
weighed cafeteria plates from Nutrition5k, single-serve packaged foods and drinks from Open Food
Facts whose kcal were checked against their label photos, and 5 non-food controls. How each source
was filtered and checked is in the
[eval README](../supabase/functions/analyze-meal/eval/README.md#dataset). Download the photos
(free, no API calls; already-downloaded photos are skipped):

```bash
deno task --config supabase/functions/analyze-meal/deno.json eval:fetch
```

The reference set has no restaurant meals and few saucy mixed dishes (curry, pasta), which is where
hidden oil makes estimates hardest. To cover those, add your own photos, and **weigh the food
before photographing it**:

- Work out true kcal from the weights using USDA FoodData Central, or the label for packaged food.
- Shoot the way you would in the app: from above, at normal distance, with the plate fully in frame.
- Leave out restaurant meals you couldn't weigh, because their "truth" is itself a guess.
- Use JPEG, PNG or WebP under 5 MB, resized to about 1024 px on the long side, as the app does.
  Phones often save HEIC, which the function rejects, so export as JPEG.
- Use stable, descriptive file names (`chicken-rice-01.jpg`) and **never re-use a name for a
  different photo**. Comparisons between runs rely on the photo set staying the same.

Save them in `supabase/functions/analyze-meal/eval/photos/`. That folder is gitignored, so your
photos stay private. Keep a backup somewhere else, because the eval can't be repeated without
them.

## 3. Label your own photos

Add one entry per photo of your own to `supabase/functions/analyze-meal/eval/dataset.local.json`
(a JSON array like `dataset.json`; gitignored, and the runner appends it to the reference set),
without a `source`:

```json
{ "image": "chicken-rice-01.jpg", "true_kcal": 610, "category": "mixed-dish", "notes": "150 g chicken, 180 g rice, 1 tsp oil; weighed" }
```

- `true_kcal` must be above 0 for food photos. Use 0 with `"is_food": false` for no-food photos.
- `category` groups the row in the per-category breakdown; reuse `mixed-plate`, `single-food`,
  `packaged` and `drink`, or add your own. The breakdown covers food photos only: non-food photos
  are reported as the separate Non-food accuracy figure, whatever their category.
- Use `notes` to record how you measured, so the label can be checked later.
- When you add or relabel photos, note it in the run log. The new MAPE is then a new baseline and
  isn't directly comparable with earlier runs.
- `dataset.local.json` never reaches a commit, so your labels stay private and `dataset.json`
  stays identical to the baseline.

## 4. Dry run (free)

```bash
export ANTHROPIC_API_KEY=sk-ant-...
deno task --config supabase/functions/analyze-meal/deno.json eval
```

Without `--yes`, nothing is sent to Claude. The dry run checks `dataset.json`, reports missing
photos, and prints how many images it would send. Fix anything it reports before going on.

## 5. Run

```bash
# Optional: low | medium | high | xhigh | max. Defaults to medium, which matches the app.
export ANALYZE_EFFORT=medium

# Smoke test: 3 photos from different categories, to catch setup problems cheaply.
deno task --config supabase/functions/analyze-meal/deno.json eval --limit 3 --yes

# Full run.
deno task --config supabase/functions/analyze-meal/deno.json eval --yes
```

A rough guide is a few cents per photo, so a few dollars for the 134-photo reference set at
`medium`. The token total in the output shows what the run actually used.

## 6. Read the results

The script prints one row per photo (truth, prediction, % error, tokens, time), then a summary.
The full results are also saved to `eval/results/<timestamp>.json`, which is gitignored.

Check **Failures first**. Refusals, truncated replies and invalid output are left out of the
calorie metrics, so the other numbers only mean something when Failures is 0. If it isn't 0, look
at those rows before going further.

| Metric          | What it means                                                       | Good direction  |
| --------------- | ------------------------------------------------------------------- | --------------- |
| **MAPE**        | Average calorie error as a %. The headline number.                  | Lower           |
| **Bias**        | Average signed error. Positive means overestimating, negative under. | Closer to 0     |
| **Within ±20%** | Share of meals close enough to be useful.                           | Higher          |
| **Non-food**    | Share of no-food photos correctly reported as not food.             | 100%            |
| **Tokens**      | Total tokens used, a proxy for cost.                                | Lower, if equal |

Then read the per-category table under the summary. Packaged items and drinks should score far
better than plates, because the label is visible; a high MAPE there points at reading labels,
while a high MAPE on `mixed-plate` points at portion estimation. Look at the worst rows too. A
pattern there, such as hidden oil, drinks or small portions, tells you what to change in
`prompt.ts`.

## 7. Log the run

Add a row to the run log below for every full run, including runs whose change you reverted.
Commit the log update. The photos and results are never committed.

## 8. Decide

Compare against the latest **baseline** row run on the same photo set:

- **Keep** the change if MAPE holds or improves, Failures stays at 0, non-food stays at 100%, and
  tokens and time don't rise noticeably.
- **Revert** it otherwise, but keep its row in the log so the result isn't lost.
- If you kept it, mark the new row as the baseline.

Results can vary a little between identical runs. If MAPE moves by only a point or two, run it
again before deciding.

## Run log

| Date | Commit | Photos | Effort | Change tested | MAPE | Bias | ±20% | Non-food | Failures | Tokens | Decision |
| ---- | ------ | ------ | ------ | ------------- | ---- | ---- | ---- | -------- | -------- | ------ | -------- |
| —    | —      | —      | —      | first run     | —    | —    | —    | —        | —        | —      | baseline |
