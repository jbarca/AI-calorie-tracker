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

# 4. Give the Edge Function its Anthropic key (server-side secret, never in the app)
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...            # hosted project
#    for local serving, put ANTHROPIC_API_KEY in supabase/functions/.env (gitignored)
npx supabase functions serve

# 5. Run the app
cd app && npx expo start
```

> `ANTHROPIC_API_KEY` must never be prefixed with `EXPO_PUBLIC_`; anything with that prefix is
> bundled into the client.

## Scripts (repo root)

| Command             | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm run lint`      | ESLint (flat config) across the repo        |
| `npm run typecheck` | `tsc --noEmit` in every workspace           |
| `npm test`          | Tests in every workspace (Vitest in shared) |
| `npm run format`    | Prettier write (`format:check` to verify)   |

Add Expo-native dependencies from `app/` with `npx expo install <pkg>` so versions match the SDK.
