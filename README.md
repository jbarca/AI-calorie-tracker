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
supabase/            Supabase config, migrations, seed, Edge Functions
docs/                Implementation plan
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

| Command                   | What it does                                                       |
| ------------------------- | ------------------------------------------------------------------ |
| `npm run lint`            | ESLint (flat config) across the repo                               |
| `npm run typecheck`       | `tsc --noEmit` in every workspace                                  |
| `npm test`                | Tests in every workspace (Vitest in shared)                        |
| `npm run test:functions`  | `deno test` for the Edge Function (fake Claude client, no API use) |
| `npm run check:functions` | `deno check` + `deno lint` for the Edge Function                   |
| `npm run format`          | Prettier write (`format:check` to verify)                          |

The `*:functions` scripts need [Deno](https://docs.deno.com/runtime/getting_started/installation/)
2.x on your PATH (`npm i -g deno` works).

Add Expo-native dependencies from `app/` with `npx expo install <pkg>` so versions match the SDK.

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
```

**Test** with `npm run test:functions`. The tests use a fake Anthropic client and a fake
Supabase client, so they never call the real API. The planned accuracy eval (about 20 labeled
photos, scored by MAPE) is described in
[`supabase/functions/analyze-meal/eval/README.md`](supabase/functions/analyze-meal/eval/README.md).
