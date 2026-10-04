# Manual device QA checklist

Run this on a real iPhone and a real Android phone before a release, against a Supabase project
that has had the one-time setup in the README done (email template with `{{ .Token }}`, Google
and Apple providers, function secrets, both functions deployed). Sign in with Apple needs a
development build (`npx expo run:ios` or an EAS dev build); everything else also works in Expo Go.

Record the device, OS version, build type (Expo Go / dev build / release) and the git commit at the
top of your notes. Mark each item pass/fail and file anything that fails.

## Setup

- [ ] `app/.env` points at the target project (`EXPO_PUBLIC_SUPABASE_URL`,
      `EXPO_PUBLIC_SUPABASE_ANON_KEY`). No `ANTHROPIC_API_KEY` anywhere in the app.
- [ ] Fresh install (delete the app first) so permission prompts appear.

## Sign-in

- [ ] **Magic link:** enter an email, open the link on the same device. The app opens on Today,
      signed in.
- [ ] **Code:** enter an email, type the 6-digit code from the same email. Signed in. A wrong
      code shows an error and does not sign in.
- [ ] **Apple (iOS, dev build):** the Apple button shows, the sheet completes, and you land on
      Today. Cancelling the sheet leaves you on sign-in with no error dialog.
- [ ] **Google:** the browser opens, you pick an account, and the app returns signed in.
      Cancelling returns to sign-in.
- [ ] Kill and relaunch the app: the session persists.

## Camera and photos

- [ ] First scan asks for camera permission; the prompt text mentions scanning meals.
- [ ] **Denying** camera permission shows a way to grant it (or to open settings) and the gallery
      fallback still works.
- [ ] Capture works; flash toggle works; the preview shows the photo before analysis.
- [ ] **Gallery:** pick a photo (asks for photo-library permission on first use). An iPhone HEIC
      photo is converted and analysed (not rejected).
- [ ] An optional hint (e.g. "oat milk latte") is accepted and reflected in the result.

## Upload and analysis

- [ ] A clear meal photo goes to the review screen with items, portions, kcal, macros and
      confidence badges, in a reasonable time (note the seconds).
- [ ] A non-food photo (keyboard, wall) shows a "no food" result, not invented items.
- [ ] Airplane mode during analysis shows "No connection" with a retry; retry after reconnecting
      succeeds and reuses the same scan.
- [ ] **409** — tap analyse twice quickly or retry while a request is in flight: "Still
      analysing this meal — please wait a moment."
- [ ] **429** — exceed `SCAN_RATE_LIMIT_PER_HOUR` (temporarily set it to 2 with
      `supabase secrets set`): "You've hit the hourly scan limit. Try again in a little while."
      Retries count toward the limit. Reset the secret afterwards.
- [ ] **415** — the app re-encodes every photo as JPEG, so this should not happen from the app.
      Pick an unusual file from the gallery (GIF, HEIF, a screenshot) and confirm it is either
      analysed or shows "That image format is not supported. Use a JPEG, PNG or WebP photo." with
      a retake option, never a generic error.
- [ ] **422** — a photo the model declines: "The AI declined to analyze this photo. Try a clearer
      photo of just the meal." with a retake option. (Hard to trigger on purpose; check the
      message by pointing a test build at a stub if needed.)

## Review and edits

- [ ] Changing an item's grams rescales its kcal and macros proportionally; the meal total updates.
- [ ] Deleting an item removes it from the total; adding an item manually works.
- [ ] Meal type defaults by time of day and can be changed.
- [ ] Save returns to Today; the meal appears with its thumbnail and the ring and macros update.
- [ ] **Edit:** tap a saved meal, change grams, save. The meal updates rather than duplicating.
- [ ] **Manual entry** ("Add food" text path) produces an estimate that can be edited and saved.

## Today, history and goal

- [ ] **Delete meal:** long-press a meal, confirm. It disappears and totals drop.
- [ ] **History:** the last 30 days group meals by local day; the 7-day chart matches the day
      totals. A meal logged just after local midnight lands on the new day.
- [ ] **Goal change:** set a new daily goal in Settings (try invalid values: 0, 25000, letters,
      which are rejected). Today's ring uses the new goal.

## Account

- [ ] **Delete account:** Settings → Delete account. The dialog requires typing the confirmation
      text; cancelling does nothing. Confirming signs you out. In the Supabase dashboard, the
      user, their rows and their `meal-photos/<user_id>/` objects are gone. Signing in again with
      the same email creates a fresh, empty account.
- [ ] Delete account in airplane mode shows an error and the account still exists.
- [ ] **Sign out:** returns to sign-in; relaunching stays signed out; signing in again shows the
      same data.

## Notes

- Dark mode and a small-screen device (e.g. iPhone SE) are worth a quick pass over every screen.
- Check the function logs in the Supabase dashboard for unexpected 500s during the run.
