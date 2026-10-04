# Implementation Plan — AI Calorie Tracker (camera scanning)

## Context
The repo `jbarca/AI-calorie-tracker` contains only a README: *"AI app focused on providing the best AI camera-scanning tool for tracking calories."* Nothing exists yet, so this plan builds the MVP from scratch.

Decisions made with the user:
- **Client:** Expo (React Native, TypeScript), for iOS and Android from one codebase.
- **AI:** the Claude vision API with structured output.
- **Backend:** Supabase for auth, Postgres, Storage, and an Edge Function that keeps the Anthropic API key server-side.

**MVP outcome:** a user signs in, points the camera at a meal, and gets back a list of detected foods. Each food has a portion, calories, macros and a confidence level. The user corrects any of these, saves the meal to today's log, and sees daily totals against a calorie goal.

## Repository layout (monorepo, npm workspaces)
```
/app                    Expo app (expo-router)
  app/(auth)/sign-in.tsx
  app/(tabs)/index.tsx      Today: totals ring + meal list
  app/(tabs)/scan.tsx       Camera capture
  app/(tabs)/history.tsx    Past days
  app/(tabs)/settings.tsx   Goal, units, sign out
  app/review/[scanId].tsx   Edit AI result → save meal
  src/lib/supabase.ts       Supabase client (AsyncStorage session)
  src/lib/api.ts            analyzeMeal(), meal CRUD
  src/lib/image.ts          resize/compress before upload
  src/hooks/                useToday, useMeals (TanStack Query)
  src/components/           FoodItemRow, MacroBar, CalorieRing
/packages/shared        Zod schemas + TS types shared by app and function
  src/analysis.ts           MealAnalysis schema (single source of truth)
/supabase
  migrations/0001_init.sql
  functions/analyze-meal/index.ts
  functions/analyze-meal/prompt.ts
  seed.sql
/README.md              setup + run instructions
```

## Phase 1: Scaffolding
1. Root `package.json` with workspaces `app` and `packages/*`, TypeScript strict, ESLint and Prettier.
2. `npx create-expo-app app -t tabs`, then add these packages: `expo-camera`, `expo-image-picker` (gallery fallback), `expo-image-manipulator`, `@supabase/supabase-js`, `@react-native-async-storage/async-storage`, `@tanstack/react-query`, `zod`.
3. `supabase init`. Local development runs through `supabase start`.
4. Add `.env.example` with `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`. `ANTHROPIC_API_KEY` is a Supabase function secret only and never goes in the app bundle.

## Phase 2: Data model (`supabase/migrations/0001_init.sql`)
- `profiles(id uuid pk → auth.users, daily_kcal_goal int default 2000, created_at)`
- `scans(id, user_id, image_path, status text, raw_result jsonb, model text, created_at)`. This is an audit trail of every AI call, kept so it can feed later evaluation work.
- `meals(id, user_id, scan_id null, eaten_at timestamptz, meal_type text, notes)`
- `meal_items(id, meal_id, name, portion_desc, grams numeric, kcal numeric, protein_g, carbs_g, fat_g, confidence numeric, user_edited bool)`
- A view `daily_totals(user_id, day, kcal, protein_g, carbs_g, fat_g)`
- Enable RLS on every table with the policy `user_id = auth.uid()` (for `meal_items`, join through `meals`).
- A private Storage bucket `meal-photos` with path convention `{user_id}/{scan_id}.jpg` and a policy restricting each user to their own folder.
- A trigger that creates a `profiles` row on signup.

## Phase 3: AI analysis Edge Function (`supabase/functions/analyze-meal`)
**Shared schema** (`packages/shared/src/analysis.ts`, Zod):
```ts
MealAnalysis = {
  is_food: boolean,
  items: [{ name, portion_desc, estimated_grams, kcal, protein_g, carbs_g, fat_g,
            confidence: "low"|"medium"|"high" }],
  total_kcal, notes  // e.g. "sauce hidden; assumed 1 tbsp oil"
}
```

**Function flow:**
1. Verify the caller's JWT and get `user_id`.
2. Receive `{ scan_id }`. The client uploads the photo to Storage first, so the function downloads it with the service role. This keeps the request small and the image retained.
3. Call Claude with the official `@anthropic-ai/sdk` (imported through `npm:` in Deno):
   - `client.messages.parse({ model: "claude-opus-5-5", max_tokens: 16000, output_config: { effort: "medium", format: zodOutputFormat(MealAnalysis) }, messages: [{ role: "user", content: [image base64 block, text instructions] }] })`
   - Omit the `thinking` parameter, because Opus 5.5 always runs adaptive thinking. Set `effort` explicitly, then tune the cost/latency trade-off later (try `low`).
   - Enable server-side refusal fallbacks (`betas: ["server-side-fallback-2026-07-01"]`, `fallbacks: "default"`), and check `stop_reason` (`refusal` / `max_tokens`) before reading output.
   - Map typed SDK errors (`RateLimitError` returns 429 to the client, `APIConnectionError` returns 503, and so on) instead of using a catch-all.
4. The prompt (`prompt.ts`, kept static so it can be cached) asks the model to:
   - identify each distinct food;
   - estimate portion size from visual cues such as plate size, utensils and hands;
   - give kcal and macros per item using standard nutrition references;
   - state the assumptions it made, such as cooking oil or hidden ingredients;
   - set `is_food: false` for non-food images.

   An optional user text hint (for example "large latte with oat milk") is appended.
5. Save `raw_result`, `model` and `status` to `scans` and return the parsed result.
6. Add basic per-user rate limiting by counting `scans` in the last hour.

## Phase 4: Mobile app
1. **Auth:** Supabase email magic link plus Sign in with Apple and Google (Apple is required on iOS if other social logins are offered). Route guard in the root `_layout.tsx`.
2. **Scan screen:** `CameraView` from expo-camera with a capture button, flash toggle and gallery-pick fallback. Handle camera permissions.
   - On capture, resize to about 1024px on the long edge as JPEG at quality 0.7 (`src/lib/image.ts`).
   - Insert a `scans` row, upload to `meal-photos`, call `supabase.functions.invoke("analyze-meal")`, and show a skeleton or "Analyzing…" state.
3. **Review screen** (where accuracy UX matters most):
   - Show the photo and the editable list of items.
   - For each item: edit the name, a grams slider or stepper (kcal and macros rescale proportionally), delete, and a confidence badge.
   - "Add item" for anything the model missed; show the model's `notes`.
   - Choose the meal type, which defaults from the time of day.
   - Save writes `meals` and `meal_items`, with `user_edited` set on changed rows.
   - If `is_food` is false, show "No food detected" with a retake button.
4. **Today tab:** a calorie ring against the goal, macro bars, and a meal list with thumbnails from signed URLs. Swipe to delete; tap to re-open the review editor.
5. **History tab:** a day list from `daily_totals` with a simple 7-day bar chart.
6. **Settings:** daily kcal goal, sign out, delete account (removes Storage objects and rows).
7. **Manual entry:** a quick text-only "Add food" path that reuses the same function with no image, so the app still works without the camera.

## Phase 5: Quality, testing, delivery
- **Unit tests (Jest):** portion rescaling math, Zod schema parsing, and daily-total aggregation.
- **Edge Function tests (Deno test):** mock the Anthropic client and cover refusal, `max_tokens`, non-food and success paths.
- **Accuracy eval script** (`supabase/functions/analyze-meal/eval/`): about 20 labeled meal photos with known kcal, reporting mean absolute percentage error. This becomes the baseline for later prompt and effort tuning.
- **CI:** GitHub Actions running lint, typecheck and tests on PRs.
- **README:** setup covering `supabase start`, `supabase functions serve`, `supabase secrets set ANTHROPIC_API_KEY=...` and `npx expo start`.

## Out of scope for MVP (future)
- Barcode scanning
- HealthKit and Google Fit sync
- USDA FoodData Central lookup to ground the macros
- Offline queue
- Multi-photo or depth-based portion estimation
- Subscriptions

## Verification
1. `supabase start && supabase db reset` applies the migrations. Then check RLS: user A cannot read user B's rows (SQL test using `set request.jwt.claims`).
2. Run `supabase functions serve analyze-meal` and curl it with a test JWT and a sample food photo. Expect valid `MealAnalysis` JSON and a populated `scans` row. With a non-food photo, expect `is_food: false`.
3. Run `npm test` in the workspaces (Jest and Deno tests) and confirm they pass. Run `npm run typecheck` and lint, and confirm they are clean.
4. Run `npx expo start` on a device or simulator, then sign in → scan a meal → edit grams → save. Check that the Today totals update and the photo thumbnail renders.
5. Run the eval script and record the baseline MAPE in the README.
6. Commit to `claude/busy-wright-b9fuj3` in logical commits (scaffold, schema, function, app screens, tests/CI) and push.
