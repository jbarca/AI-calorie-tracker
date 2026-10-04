# AI-calorie-tracker

AI app focused on providing the best AI camera-scanning tool for tracking calories.

Point the camera at a meal and get back each detected food with its portion, calories, macros and a
confidence level. Correct anything, save it to today's log, and track daily totals against a goal.
See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for the full plan.

## Stack

- **App:** Expo (React Native, TypeScript, expo-router) in `app/`
- **Backend:** Supabase (auth, Postgres, Storage, Edge Functions) in `supabase/`
- **AI:** Claude vision with structured output, called only from the `analyze-meal` Edge Function
- **Shared:** Zod schemas and types in `packages/shared` (`@calorie/shared`)

## Repository layout

```
app/                 Expo app (routes in app/app, non-route code in app/src)
packages/shared/     @calorie/shared: MealAnalysis Zod schema + types
supabase/            Supabase config, migrations, pgTAP tests, seed, Edge Functions
scripts/             Repo scripts (shared-code sync, per-function Deno test/check)
docs/                Implementation plan, device QA checklist
.github/workflows/   CI
```

## Prerequisites

- Node.js 20+ and npm
- Docker (for the local Supabase stack)
- Expo Go or a development build on a device/simulator

## Setup

```bash
# 1. Install all workspaces
npm install

# 2. Start local Supabase and apply migrations + seed
npx supabase start
npx supabase db reset

# 3. Configure the app (values come from `npx supabase status`)
cp .env.example app/.env
#    then edit app/.env: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY

# 4. Serve the analyze-meal Edge Function locally (see "Edge Function" below)
cp supabase/functions/.env.example supabase/functions/.env       # then set ANTHROPIC_API_KEY
npx supabase functions serve analyze-meal --env-file supabase/functions/.env

# 5. Run the app
cd app && npx expo start
```

> `ANTHROPIC_API_KEY` must never be prefixed with `EXPO_PUBLIC_`; anything with that prefix is
> bundled into the client.

## Scripts (repo root)

| Command                     | What it does                                                    |
| --------------------------- | --------------------------------------------------------------- |
| `npm run lint`              | ESLint (flat config) across the repo                            |
| `npm run typecheck`         | `tsc --noEmit` in every workspace                               |
| `npm test`                  | Tests in every workspace (Vitest in shared, Jest + RNTL in app) |
| `npm run test:functions`    | `deno test` for every Edge Function (fakes only, no API use)    |
| `npm run check:functions`   | `deno check` + `deno lint` for every Edge Function              |
| `npm run sync:shared`       | Copy `packages/shared/src` into the functions' `_shared` folder |
| `npm run check:shared-sync` | Fail if that copy is out of date (CI runs this)                 |
| `npm run format`            | Prettier write (`format:check` to verify)                       |

The `*:functions` scripts need [Deno](https://docs.deno.com/runtime/getting_started/installation/)
2.x on your PATH (`npm i -g deno` works).

Add Expo-native dependencies from `app/` with `npx expo install <pkg>` so versions match the SDK.

## Mobile app (`app/`)

Expo Router screens live in `app/app`, everything else in `app/src` (imported as `@/...`).

| Route                  | What it does                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------- |
| `(auth)/sign-in`       | Email magic link + 6-digit code, Sign in with Apple (iOS), Google (web OAuth)      |
| `(tabs)/index` (Today) | Calorie ring vs goal, macro bar, today's meals (tap to edit, long-press to delete) |
| `(tabs)/scan`          | Camera (flash, gallery fallback, optional hint) → analyze → review                 |
| `(tabs)/history`       | Last 30 days grouped by local day, 7-day kcal bar chart                            |
| `(tabs)/settings`      | Daily kcal goal (1-20000), sign out, delete account (type-to-confirm)              |
| `review/[scanId]`      | Edit the AI result and save it; `?mealId=` edits a saved meal                      |
| `add-text`             | Manual entry: describe a meal, analyze-meal estimates it without a photo           |

- **Auth guard:** the root `_layout.tsx` uses `Stack.Protected` on the Supabase session. The client
  uses the PKCE flow; magic links and OAuth return to `aicalorietracker://sign-in?code=...`
  (`exp://.../--/sign-in` in Expo Go), which is exchanged for a session. Both are already in
  `additional_redirect_urls` in `supabase/config.toml`.
- **Scan flow** (`src/lib/api.ts` → `analyzeMeal`): resize to 1024 px / JPEG 0.7
  (`src/lib/image.ts`) → insert a `scans` row → upload to `meal-photos/{user_id}/{scan_id}.jpg` →
  set `image_path` → `functions.invoke('analyze-meal')`. A retry reuses the same scan. Function
  errors (401/404/413/415/422/429/502/503) map to friendly messages in `@calorie/shared`.
- **Days are local:** Today and History query `meals.eaten_at` with the device's local-day
  boundaries rather than the UTC `daily_totals` view.
- **Pure logic** (rescaling, totals, meal-type default, draft editing, dates, error mapping) is in
  `packages/shared/src` with Vitest tests; component tests use Jest (`jest-expo`) and React Native
  Testing Library in `app/src/__tests__`.

The one-time Supabase setup below (email template, Google and Apple providers) is required for
every sign-in method except the magic link. Manual device testing is in
[`docs/QA.md`](docs/QA.md).

## Shared code in Edge Functions (`sync:shared`)

`packages/shared/src` is the single source of truth for the Zod schemas and pure helpers. The app
imports it as `@calorie/shared`. Edge Functions cannot import from outside `supabase/functions/`
when deployed, so `npm run sync:shared` copies the non-test `.ts` files into
`supabase/functions/_shared/calorie-shared/` (each with a "GENERATED ... do not edit" header), and
each function's `deno.json` maps `@calorie/shared` to `../_shared/calorie-shared/index.ts`.

- Edit `packages/shared/src`, never the generated copy.
- After any change there, run `npm run sync:shared` and commit the result with your change.
- `npm run check:shared-sync` (run in CI) fails and lists the files if the copy is stale.

## One-time Supabase setup (hosted project)

Do this once per Supabase project, in the dashboard unless noted.

1. **Magic-link email template:** Authentication → Emails → Magic Link. Include the 6-digit code,
   e.g. `<p>Your code: {{ .Token }}</p>`, next to the link. The default template only has the
   link, and the app's code-entry path needs `{{ .Token }}`.
2. **Redirect URLs:** Authentication → URL Configuration. Add `aicalorietracker://**` (and
   `exp://**` while using Expo Go), matching `additional_redirect_urls` in `supabase/config.toml`.
3. **Google provider:** Authentication → Providers → Google. Enable it with a Google Cloud OAuth
   client (web application) id and secret, and add the Supabase callback URL shown there to the
   Google client's authorised redirect URIs.
4. **Apple provider:**
   - Set `expo.ios.bundleIdentifier` in `app/app.json` (e.g. `com.yourname.aicalorietracker`).
   - Authentication → Providers → Apple. Enable it and add that bundle id to the client ids.
   - Sign in with Apple only works in a development build (`npx expo run:ios` or an EAS dev
     build), not in Expo Go.
5. **Function secrets** (CLI, after `npx supabase link --project-ref <project-ref>`):

   ```bash
   npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
   npx supabase secrets set SCAN_RATE_LIMIT_PER_HOUR=30 ANALYZE_EFFORT=medium   # optional
   ```

6. **Database and functions:**

   ```bash
   npx supabase db push
   npm run check:shared-sync          # the deployed copy must match packages/shared
   npx supabase functions deploy analyze-meal
   npx supabase functions deploy delete-account
   ```

7. Point `app/.env` at the project (Project Settings → API: URL and anon key).

## CI

`.github/workflows/ci.yml` runs on pull requests, on pushes to `main` and on pushes to `claude/**`
branches. Superseded runs of the same branch are cancelled. Jobs:

| Job         | What it runs                                                                                                   |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `node`      | `npm ci`, `lint`, `typecheck`, `test`, `format:check`, `check:shared-sync`                                     |
| `functions` | Deno 2.x: `test:functions`, `check:functions`                                                                  |
| `database`  | Supabase CLI: `supabase start`, `db reset`, `test db` (pgTAP in `supabase/tests`), `db lint` (fails on errors) |
| `expo`      | `npx expo export --platform android` with dummy `EXPO_PUBLIC_*` values, as a bundle smoke test                 |

The accuracy eval never runs in CI (it calls the paid API).

## Edge Function: `analyze-meal`

`supabase/functions/analyze-meal/` takes a meal photo (or a text description) and returns a
`MealAnalysis` (see `packages/shared/src/analysis.ts`) from Claude (`claude-opus-5-5`, structured
output, server-side refusal fallbacks).

**Request** (`POST`, with the user's Supabase JWT as `Authorization: Bearer ...`; with
`supabase.functions.invoke('analyze-meal', { body })` this header is added for you):

- `{ "scan_id": "<uuid>", "hint"?: "large latte with oat milk" }`: analyse the photo of a `scans`
  row the caller owns. Upload the photo to `meal-photos/{user_id}/{scan_id}.jpg` first (JPEG, PNG
  or WebP; HEIC is rejected with 415, so convert on the device).
- `{ "text": "two boiled eggs and toast" }`: manual entry with no photo. The function creates the
  `scans` row itself.

**Response:** `200 { scan_id, analysis }`. Errors are `{ error, message }`, with these statuses:
401 (no or invalid JWT), 400 (bad body), 404 (scan or photo not found), 403 (photo outside the
caller's folder), 413/415 (image too large or unsupported type), 429 (per-user hourly limit, or
the AI service is rate limited), 422 (`refused`: the model declined), 502 (truncated or invalid
AI output, or an upstream API error), and 503 (AI service unreachable or timed out). Every call
updates `scans.status` (`complete` / `failed` / `refused`), `raw_result` and `model` (the model
that actually served the request, which can be a fallback model).

**Environment variables**

| Variable                                                         | Required | Default  | Notes                                                    |
| ---------------------------------------------------------------- | -------- | -------- | -------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                              | yes      |          | Function secret only; never in the app                   |
| `SCAN_RATE_LIMIT_PER_HOUR`                                       | no       | `30`     | Max analyses per user per rolling hour                   |
| `ANALYZE_EFFORT`                                                 | no       | `medium` | `low` / `medium` / `high` / `xhigh` / `max`              |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | auto     |          | Injected by Supabase (and by `supabase functions serve`) |

**Serve locally**

```bash
npx supabase start
cp supabase/functions/.env.example supabase/functions/.env   # set ANTHROPIC_API_KEY
npx supabase functions serve analyze-meal --env-file supabase/functions/.env
```

**Deploy**

```bash
npx supabase link --project-ref <project-ref>
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase secrets set SCAN_RATE_LIMIT_PER_HOUR=30 ANALYZE_EFFORT=medium   # optional
npx supabase functions deploy analyze-meal
npx supabase functions deploy delete-account
```

**Test** with `npm run test:functions`. The tests use a fake Anthropic client and a fake
Supabase client, so they never call the real API. The accuracy eval (labelled photos, scored by
MAPE, bias, ±20% hit rate and non-food accuracy) is run by hand with your own API key; see
[`supabase/functions/analyze-meal/eval/README.md`](supabase/functions/analyze-meal/eval/README.md).
