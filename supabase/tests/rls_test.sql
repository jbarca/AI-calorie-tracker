-- RLS / ownership tests for the init migration (plus the scans hardening
-- migration, which changes how scan deletes fail). Run with: supabase test db
--
-- Creates two users (A and B), gives each a scan, a meal and meal items, then
-- checks as user A that nothing of user B's can be read or modified.
-- Everything runs inside a transaction and is rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(41);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner, bypassing RLS)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test');

-- 1-3: signup trigger
select is(
  (select count(*) from public.profiles
    where id in ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')),
  2::bigint,
  'on_auth_user_created creates a profile for each new user'
);
select is(
  (select daily_kcal_goal from public.profiles where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  2000,
  'new profile gets the default daily_kcal_goal of 2000'
);
select has_trigger('auth', 'users', 'on_auth_user_created', 'trigger exists on auth.users');

-- 4-8: RLS enabled everywhere, daily_totals is security_invoker
select ok((select relrowsecurity from pg_class where oid = 'public.profiles'::regclass),   'RLS enabled on profiles');
select ok((select relrowsecurity from pg_class where oid = 'public.scans'::regclass),      'RLS enabled on scans');
select ok((select relrowsecurity from pg_class where oid = 'public.meals'::regclass),      'RLS enabled on meals');
select ok((select relrowsecurity from pg_class where oid = 'public.meal_items'::regclass), 'RLS enabled on meal_items');
select ok(
  (select 'security_invoker=true' = any(reloptions) from pg_class where oid = 'public.daily_totals'::regclass),
  'daily_totals is a security_invoker view'
);

-- 9: bucket is private
select is(
  (select public from storage.buckets where id = 'meal-photos'),
  false,
  'meal-photos bucket exists and is private'
);

insert into public.scans (id, user_id, image_path, status, model) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a0000000-0000-4000-8000-000000000001.jpg', 'complete', 'test-model'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/b0000000-0000-4000-8000-000000000001.jpg', 'complete', 'test-model');

insert into public.meals (id, user_id, scan_id, eaten_at, meal_type) values
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'a0000000-0000-4000-8000-000000000001', '2026-10-01 12:00:00+00', 'lunch'),
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   null, '2026-10-01 19:00:00+00', 'dinner'),
  ('b0000000-0000-4000-8000-000000000002', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'b0000000-0000-4000-8000-000000000001', '2026-10-01 12:00:00+00', 'lunch');

insert into public.meal_items (id, meal_id, name, grams, kcal, protein_g, carbs_g, fat_g, confidence) values
  ('a0000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002', 'rice',    150, 200, 4, 44, 0.5, 'high'),
  ('a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000003', 'chicken', 120, 300, 30, 0, 18, 'medium'),
  ('b0000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-000000000002', 'pizza',   200, 550, 22, 60, 24, 'low');

insert into storage.objects (bucket_id, name) values
  ('meal-photos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/b0000000-0000-4000-8000-000000000001.jpg');

-- ---------------------------------------------------------------------------
-- Act as user A
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

-- 10-14: reads are scoped
select results_eq(
  'select id from public.profiles',
  $$values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid)$$,
  'A sees only their own profile'
);
select results_eq(
  'select id from public.scans',
  $$values ('a0000000-0000-4000-8000-000000000001'::uuid)$$,
  'A sees only their own scans'
);
select results_eq(
  'select id from public.meals order by eaten_at',
  $$values ('a0000000-0000-4000-8000-000000000002'::uuid), ('a0000000-0000-4000-8000-000000000003'::uuid)$$,
  'A sees only their own meals'
);
select results_eq(
  'select id from public.meal_items order by kcal',
  $$values ('a0000000-0000-4000-8000-000000000004'::uuid), ('a0000000-0000-4000-8000-000000000005'::uuid)$$,
  'A sees only their own meal_items'
);
select results_eq(
  'select user_id, day, kcal, protein_g, carbs_g, fat_g from public.daily_totals',
  $$values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, '2026-10-01'::date,
            500::numeric, 34::numeric, 44::numeric, 18.5::numeric)$$,
  'daily_totals only contains A''s totals, summed across A''s meals'
);

-- 15-16: storage reads scoped to own folder
select is_empty(
  $$select 1 from storage.objects where bucket_id = 'meal-photos'$$,
  'A cannot see objects in B''s meal-photos folder'
);
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('meal-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a0000000-0000-4000-8000-000000000001.jpg')$$,
  'A can upload into their own folder'
);

-- 17: storage writes into another user's folder are rejected
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('meal-photos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/evil.jpg')$$,
  '42501', null,
  'A cannot upload into B''s folder'
);

-- 18-23: updates/deletes of B's rows silently affect nothing
select is_empty(
  $$update public.scans set image_path = 'hacked' where id = 'b0000000-0000-4000-8000-000000000001' returning id$$,
  'A cannot update B''s scan'
);
-- Scans are append-only for users (20261005000000_harden_scans.sql), so this is
-- a privilege error rather than an RLS no-op.
select throws_ok(
  $$delete from public.scans where id = 'b0000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'A cannot delete B''s scan'
);
select is_empty(
  $$update public.meals set notes = 'hacked' where id = 'b0000000-0000-4000-8000-000000000002' returning id$$,
  'A cannot update B''s meal'
);
select is_empty(
  $$delete from public.meals where id = 'b0000000-0000-4000-8000-000000000002' returning id$$,
  'A cannot delete B''s meal'
);
select is_empty(
  $$update public.meal_items set kcal = 1 where id = 'b0000000-0000-4000-8000-000000000003' returning id$$,
  'A cannot update B''s meal_item'
);
select is_empty(
  $$delete from public.meal_items where id = 'b0000000-0000-4000-8000-000000000003' returning id$$,
  'A cannot delete B''s meal_item'
);

-- 24-25: profiles
select is_empty(
  $$update public.profiles set daily_kcal_goal = 1 where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' returning id$$,
  'A cannot update B''s profile'
);
select results_eq(
  $$update public.profiles set daily_kcal_goal = 1800 returning daily_kcal_goal$$,
  $$values (1800)$$,
  'A can update their own profile'
);

-- 26-31: inserts/updates that would create or move rows into B's ownership fail
select throws_ok(
  $$insert into public.scans (user_id, status) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'pending')$$,
  '42501', null,
  'A cannot insert a scan owned by B'
);
select throws_ok(
  $$insert into public.meals (user_id) values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$,
  '42501', null,
  'A cannot insert a meal owned by B'
);
select throws_ok(
  $$insert into public.meals (scan_id) values ('b0000000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'A cannot link their meal to B''s scan'
);
select throws_ok(
  $$insert into public.meal_items (meal_id, name, kcal) values ('b0000000-0000-4000-8000-000000000002', 'x', 1)$$,
  '42501', null,
  'A cannot add items to B''s meal'
);
select throws_ok(
  $$update public.meals set user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id = 'a0000000-0000-4000-8000-000000000003'$$,
  '42501', null,
  'A cannot hand their meal over to B'
);
select throws_ok(
  $$update public.meal_items set meal_id = 'b0000000-0000-4000-8000-000000000002' where id = 'a0000000-0000-4000-8000-000000000005'$$,
  '42501', null,
  'A cannot move their item into B''s meal'
);

-- 32-34: A's own writes work, and user_id defaults to auth.uid()
select lives_ok(
  $$insert into public.scans (id, status) values ('a0000000-0000-4000-8000-000000000009', 'pending')$$,
  'A can insert a scan without specifying user_id'
);
select is(
  (select user_id from public.scans where id = 'a0000000-0000-4000-8000-000000000009'),
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid,
  'scans.user_id defaults to auth.uid()'
);
select lives_ok(
  $$insert into public.meal_items (meal_id, name, kcal, confidence, user_edited)
    values ('a0000000-0000-4000-8000-000000000003', 'salad', 80, null, true)$$,
  'A can add an item to their own meal'
);

-- 35: constraints
select throws_ok(
  $$insert into public.meal_items (meal_id, name, kcal, confidence)
    values ('a0000000-0000-4000-8000-000000000003', 'x', 10, 'certain')$$,
  '23514', null,
  'meal_items.confidence only accepts low/medium/high'
);

-- ---------------------------------------------------------------------------
-- Anonymous callers see nothing
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

-- 36-37
select is_empty('select 1 from public.meals', 'anon sees no meals');
select is_empty('select 1 from public.daily_totals', 'anon sees no daily_totals');

-- ---------------------------------------------------------------------------
-- Act as user B: B's data survived A's attempts
-- ---------------------------------------------------------------------------
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated"}', true);

-- 38-40
select results_eq(
  'select status, (select count(*) from public.meal_items) from public.scans',
  $$values ('complete'::text, 1::bigint)$$,
  'B''s scan and meal_item are intact and B sees only their own'
);
select results_eq(
  'select kcal from public.daily_totals',
  $$values (550::numeric)$$,
  'B''s daily_totals are scoped to B'
);
select results_eq(
  'select daily_kcal_goal from public.profiles',
  $$values (2000)$$,
  'B''s profile was not changed by A'
);

-- ---------------------------------------------------------------------------
-- 41: deleting the auth user cascades to their data
-- ---------------------------------------------------------------------------
reset role;
delete from auth.users where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
select is(
  (select count(*) from public.meal_items where meal_id = 'b0000000-0000-4000-8000-000000000002')
  + (select count(*) from public.meals where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  + (select count(*) from public.scans where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
  + (select count(*) from public.profiles where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0::bigint,
  'deleting an auth user cascades to profiles, scans, meals and meal_items'
);

select * from finish();
rollback;
