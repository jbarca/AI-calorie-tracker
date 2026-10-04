-- =============================================================================
-- Phase 2: initial data model for the AI calorie tracker.
--
-- Tables:   profiles, scans, meals, meal_items
-- View:     daily_totals (security_invoker, so RLS on the base tables applies)
-- Storage:  private bucket `meal-photos`, path convention `{user_id}/{scan_id}.jpg`
-- Trigger:  on_auth_user_created -> creates a profiles row on signup
--
-- Deviation from docs/IMPLEMENTATION_PLAN.md: meal_items.confidence is TEXT
-- constrained to 'low' | 'medium' | 'high' (not numeric), so it matches the
-- shared AI result schema's confidence enum one-to-one.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user, created by the signup trigger below.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  daily_kcal_goal integer not null default 2000
                  check (daily_kcal_goal > 0 and daily_kcal_goal <= 20000),
  created_at      timestamptz not null default now()
);

comment on table public.profiles is 'Per-user settings. Row is created automatically on signup.';

-- -----------------------------------------------------------------------------
-- scans: audit trail of every AI call (kept for later evaluation work).
-- -----------------------------------------------------------------------------
create table public.scans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  image_path  text,   -- storage path in `meal-photos`: '{user_id}/{scan_id}.jpg'; null for text-only entries
  status      text not null default 'pending'
              check (status in ('pending', 'complete', 'failed', 'refused')),
  raw_result  jsonb,  -- raw model output, as returned by the analyze function
  model       text,   -- model id used for the call
  created_at  timestamptz not null default now()
);

comment on table public.scans is 'Audit trail of every AI meal analysis call.';

create index scans_user_id_created_at_idx on public.scans (user_id, created_at desc);

-- -----------------------------------------------------------------------------
-- meals: a logged meal, optionally linked to the scan that produced it.
-- -----------------------------------------------------------------------------
create table public.meals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
              references auth.users (id) on delete cascade,
  scan_id     uuid references public.scans (id) on delete set null,
  eaten_at    timestamptz not null default now(),
  meal_type   text check (meal_type in ('breakfast', 'lunch', 'dinner', 'snack')),
  notes       text,
  created_at  timestamptz not null default now()
);

create index meals_user_id_eaten_at_idx on public.meals (user_id, eaten_at desc);
create index meals_scan_id_idx on public.meals (scan_id) where scan_id is not null;

-- -----------------------------------------------------------------------------
-- meal_items: individual foods in a meal. Ownership is inherited from meals.
-- -----------------------------------------------------------------------------
create table public.meal_items (
  id            uuid primary key default gen_random_uuid(),
  meal_id       uuid not null references public.meals (id) on delete cascade,
  name          text not null,
  portion_desc  text,
  grams         numeric check (grams >= 0),
  kcal          numeric not null check (kcal >= 0),
  protein_g     numeric check (protein_g >= 0),
  carbs_g       numeric check (carbs_g >= 0),
  fat_g         numeric check (fat_g >= 0),
  confidence    text check (confidence in ('low', 'medium', 'high')),
  user_edited   boolean not null default false,
  created_at    timestamptz not null default now()
);

comment on column public.meal_items.confidence is
  'Model confidence: low | medium | high (matches the shared AI result schema). Null for manual entries.';

create index meal_items_meal_id_idx on public.meal_items (meal_id);

-- -----------------------------------------------------------------------------
-- daily_totals: per-user, per-day sums. security_invoker => caller's RLS applies.
-- Days are bucketed in UTC; the client is responsible for any local-day logic.
-- -----------------------------------------------------------------------------
create view public.daily_totals
with (security_invoker = true) as
select
  m.user_id,
  (m.eaten_at at time zone 'UTC')::date as day,
  coalesce(sum(mi.kcal), 0)      as kcal,
  coalesce(sum(mi.protein_g), 0) as protein_g,
  coalesce(sum(mi.carbs_g), 0)   as carbs_g,
  coalesce(sum(mi.fat_g), 0)     as fat_g
from public.meals m
left join public.meal_items mi on mi.meal_id = m.id
group by m.user_id, (m.eaten_at at time zone 'UTC')::date;

comment on view public.daily_totals is 'Daily kcal/macro totals per user (UTC days). RLS applies via security_invoker.';

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.profiles   enable row level security;
alter table public.scans      enable row level security;
alter table public.meals      enable row level security;
alter table public.meal_items enable row level security;

-- profiles: read and update own row only. Inserts come from the signup trigger,
-- deletes cascade from auth.users.
create policy "profiles: select own" on public.profiles
  for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: update own" on public.profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- scans
create policy "scans: select own" on public.scans
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "scans: insert own" on public.scans
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "scans: update own" on public.scans
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "scans: delete own" on public.scans
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- meals. Writes may only link a scan the caller owns (FK checks bypass RLS,
-- so without this a user could attach someone else's scan id).
create policy "meals: select own" on public.meals
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "meals: insert own" on public.meals
  for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      scan_id is null
      or exists (
        select 1 from public.scans s
        where s.id = scan_id and s.user_id = (select auth.uid())
      )
    )
  );

create policy "meals: update own" on public.meals
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and (
      scan_id is null
      or exists (
        select 1 from public.scans s
        where s.id = scan_id and s.user_id = (select auth.uid())
      )
    )
  );

create policy "meals: delete own" on public.meals
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- meal_items: ownership via the parent meal.
create policy "meal_items: select own" on public.meal_items
  for select to authenticated
  using (
    exists (
      select 1 from public.meals m
      where m.id = meal_id and m.user_id = (select auth.uid())
    )
  );

create policy "meal_items: insert own" on public.meal_items
  for insert to authenticated
  with check (
    exists (
      select 1 from public.meals m
      where m.id = meal_id and m.user_id = (select auth.uid())
    )
  );

create policy "meal_items: update own" on public.meal_items
  for update to authenticated
  using (
    exists (
      select 1 from public.meals m
      where m.id = meal_id and m.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.meals m
      where m.id = meal_id and m.user_id = (select auth.uid())
    )
  );

create policy "meal_items: delete own" on public.meal_items
  for delete to authenticated
  using (
    exists (
      select 1 from public.meals m
      where m.id = meal_id and m.user_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- Signup trigger: create a profiles row for each new auth user.
-- -----------------------------------------------------------------------------
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Only the trigger should run this; keep it out of the PostgREST RPC surface.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for any users that existed before this migration.
insert into public.profiles (id)
select id from auth.users
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Storage: private `meal-photos` bucket, each user confined to `{user_id}/...`.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'meal-photos',
  'meal-photos',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

create policy "meal-photos: select own folder" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "meal-photos: insert own folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "meal-photos: update own folder" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "meal-photos: delete own folder" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'meal-photos'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
