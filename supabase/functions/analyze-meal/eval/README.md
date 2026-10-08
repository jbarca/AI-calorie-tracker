# analyze-meal accuracy eval

A small, repeatable baseline for how close the model's calorie estimates are to
the truth, so that prompt edits, effort changes (`ANALYZE_EFFORT`) and model
upgrades can be compared on numbers rather than impressions.

`run.ts` calls `analyzeWithClaude` from `../claude.ts`, so it sends exactly the
request the function sends (prompt, schema, effort, fallbacks). **It calls the
real Anthropic API and costs money.** It never runs in CI, and
`npm run test:functions` does not execute it (only `metrics_test.ts`, which
tests the pure metric functions in `metrics.ts`).

## Files

| File                   | Committed | What it is                                                     |
| ---------------------- | --------- | -------------------------------------------------------------- |
| `run.ts`               | yes       | The runner                                                     |
| `fetch.ts`             | yes       | Downloads the public reference photos listed in `dataset.json` |
| `dataset.ts`           | yes       | The `dataset.json` schema                                      |
| `metrics.ts`           | yes       | Pure metric and report functions (tested)                      |
| `metrics_test.ts`      | yes       | Deno tests for `metrics.ts`                                    |
| `dataset.json`         | yes       | Labels for the 134-photo public reference set                  |
| `dataset.example.json` | yes       | Example labels for your own photos                             |
| `photos/`              | no        | Downloaded and your own photos (gitignored)                    |
| `results/`             | no        | One `<timestamp>.json` per run (gitignored)                    |

## Dataset

`dataset.json` is a public reference set of 134 photos whose calorie truth was
measured, not estimated. Nothing in it needs weighing or photographing;
`fetch.ts` downloads the photos:

```bash
deno task --config supabase/functions/analyze-meal/deno.json eval:fetch   # free, ~10 MB
```

| Category      | Photos | Source and ground truth                                                                                                                                                                                 |
| ------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mixed-plate` |     64 | [Nutrition5k](https://github.com/google-research-datasets/Nutrition5k) (CC BY 4.0): overhead photos of cafeteria plates; every ingredient was weighed on a scale and converted to kcal with USDA values |
| `single-food` |     30 | Nutrition5k, one ingredient per plate; includes 6 small/large portion pairs of the same food (12 photos)                                                                                                |
| `packaged`    |     23 | [Open Food Facts](https://world.openfoodfacts.org) (CC BY-SA 3.0): single-serve packs photographed front-on; truth is the pack's kcal per 100 g x net quantity                                          |
| `drink`       |     12 | Open Food Facts: cans, bottles and cartons (soft drinks, juice, energy drinks, shakes, non-alcoholic beer)                                                                                              |
| `non-food`    |      5 | scikit-image and scikit-learn sample photos (public domain, CC0, CC BY 2.0): a person, a cat, a rocket, a building, a flower                                                                            |

How the labels were checked, so they can be trusted:

- **Nutrition5k**: of 5,006 dishes, kept only those with an overhead photo, at
  least 40 kcal, and labels that agree with themselves: ingredient kcal sum to
  the dish total (±2%), recomputing from the per-gram table agrees (±5%),
  ingredient masses sum to the dish mass, energy density is plausible and macros
  match kcal by Atwater factors. From those 2,678, a stratified sample by kcal
  band and plate complexity (at least 15 minutes apart, so the dataset's
  incremental scans of one plate don't repeat) was **checked by eye** against
  the ingredient list: 17 of 111 were dropped (label didn't match the photo,
  food cut off by the frame, a second plate in view, or a near-duplicate).
- **Open Food Facts**: from the 4.5 M-product dump, kept single-serve products
  (serving size equal to the pack size, not a multipack) sold in
  English-speaking countries whose kcal agree with their macros and kJ. Each
  product's kcal was then **matched against the Google Vision OCR of its own
  label photos**; 65 of 260 failed and were dropped. The front photo was picked
  by eye, which dropped 2 more (a 1 L carton listed as 250 ml, and a drink with
  two label versions). Where the printed label and the database differed
  slightly, the label wins (3 products, noted in `notes`).

Limits to keep in mind when reading results: Nutrition5k plates are all from one
cafeteria, shot from directly above at 640x480 with the same white plates, and
lean towards simple, lightly sauced food. There are no restaurant meals, curries
or pasta dishes with hidden oil. Packaged items are easier than real meals,
because the model can read the brand and label. Add your own weighed photos
(below) to cover those gaps.

### Adding your own photos

Add one entry per photo in `photos/`, without a `source`:

```json
[
  {
    "image": "chicken-rice-01.jpg",
    "true_kcal": 610,
    "category": "mixed-dish",
    "notes": "weighed; USDA FDC"
  },
  {
    "image": "desk-keyboard-01.jpg",
    "true_kcal": 0,
    "is_food": false,
    "notes": "non-food"
  }
]
```

- `image`: file name under `photos/` (JPEG, PNG or WebP, under 5 MB; resize to
  ~1024 px on the long edge, as the app does).
- `true_kcal`: ground truth. Must be > 0 for food photos; use 0 for non-food
  photos.
- `is_food` (optional, default `true`): set `false` for control photos that show
  no food.
- `category` (optional): groups rows in the per-category breakdown of the
  report.
- `source` and `license` (optional): a public URL `fetch.ts` downloads the photo
  from (saved as JPEG, so `image` must end in `.jpg`), and its licence.
- `notes` (optional): how the truth was measured.

Ground truth comes from **weighing the food before photographing it** and
computing kcal from USDA FoodData Central (or the label for packaged foods).
Leave out restaurant dishes without weights, because their "truth" is itself an
estimate.

## Running

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export ANALYZE_EFFORT=medium        # optional: low | medium | high | xhigh | max

# From the repo root. Without --yes it only prints the image count and the cost reminder.
deno task --config supabase/functions/analyze-meal/deno.json eval
deno task --config supabase/functions/analyze-meal/deno.json eval --limit 3 --yes   # smoke test: 3 photos across categories
deno task --config supabase/functions/analyze-meal/deno.json eval --yes             # full run
```

The task runs with `--allow-net=api.anthropic.com`, read access to `eval/` and
write access to `eval/results/` only. Each image is one Opus 5.5 vision call; a
full run of the reference set is 134 calls. Missing photos and an invalid
`dataset.json` are reported before any call is made.

## Output

A per-image table (truth, prediction, signed % error, outcome, tokens, latency),
then:

- **MAPE**: mean absolute percentage error of `total_kcal` over food photos that
  got an analysis. The headline number.
- **Mean bias**: mean signed % error and mean signed kcal error. Positive means
  the model overestimates.
- **Within ±20%**: share of food photos within 20% of the truth.
- **Non-food accuracy**: share of non-food photos the model reported as
  `is_food: false`.
- **Failures**: refusals, truncations, invalid output and errors. These are left
  out of the kcal metrics, so check this count before trusting the MAPE.
- **Total tokens**: input + output + cache tokens across the run.
- **Per category**: MAPE, bias and the ±20% rate for each `category`, when there
  is more than one.

The same summary plus every row (with the serving model) is written to
`results/<timestamp>.json`.

## Using the results

Follow the repeatable procedure in
[`docs/ACCURACY_EVAL.md`](../../../../docs/ACCURACY_EVAL.md) and record every
full run in its run log. The first full run on `medium` is the baseline.

Later changes to `prompt.ts`, `ANALYZE_EFFORT` or the model should be kept only
if they hold or improve MAPE without a meaningful cost or latency regression.
