-- Tests for 20261005000000_harden_scans.sql. Run with: supabase test db
--
-- scans is the analyze-meal rate-limit counter, so users must not be able to
-- remove rows or move them out of the counting window. Checks that a user
-- cannot delete scans, cannot update anything but image_path, and cannot pick
-- created_at/status/raw_result/model on insert; and that service_role still
-- can. Everything runs inside a transaction and is rolled back.

begin;

create extension if not exists pgtap with schema extensions;

select plan(27);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test');

-- The owner is trusted: explicit values are kept, even a past created_at.
insert into public.scans (id, user_id, image_path, status, raw_result, model, created_at) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a0000000-0000-4000-8000-000000000001.jpg',
   'complete', '{"analysis": {}}', 'test-model', '2026-10-01 12:00:00+00');

-- 1: the trigger leaves non-client roles alone
select is(
  (select created_at from public.scans where id = 'a0000000-0000-4000-8000-000000000001'),
  '2026-10-01 12:00:00+00'::timestamptz,
  'owner inserts keep an explicit created_at'
);

-- 2-6: schema-level checks
select is_empty(
  $$select 1 from pg_policies where schemaname = 'public' and tablename = 'scans' and cmd = 'DELETE'$$,
  'scans has no DELETE policy'
);
select ok(
  not has_table_privilege('authenticated', 'public.scans', 'DELETE'),
  'authenticated has no DELETE privilege on scans'
);
select ok(
  has_column_privilege('authenticated', 'public.scans', 'image_path', 'UPDATE'),
  'authenticated may update scans.image_path'
);
select ok(
  not (has_column_privilege('authenticated', 'public.scans', 'user_id', 'UPDATE')
    or has_column_privilege('authenticated', 'public.scans', 'status', 'UPDATE')
    or has_column_privilege('authenticated', 'public.scans', 'raw_result', 'UPDATE')
    or has_column_privilege('authenticated', 'public.scans', 'model', 'UPDATE')
    or has_column_privilege('authenticated', 'public.scans', 'created_at', 'UPDATE')
    or has_column_privilege('authenticated', 'public.scans', 'id', 'UPDATE')),
  'authenticated may not update any other scans column'
);
select has_trigger('public', 'scans', 'scans_enforce_client_insert', 'insert trigger exists on scans');

-- ---------------------------------------------------------------------------
-- Act as user A
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

-- 7-8: cannot delete own scan
select throws_ok(
  $$delete from public.scans where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'A cannot delete their own scan'
);
select is(
  (select count(*) from public.scans where id = 'a0000000-0000-4000-8000-000000000001'),
  1::bigint,
  'A''s scan still exists after the delete attempt'
);

-- 9-14: cannot update server-owned columns of own scan
select throws_ok(
  $$update public.scans set status = 'failed' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'A cannot update status'
);
select throws_ok(
  $$update public.scans set raw_result = '{}' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'A cannot update raw_result'
);
select throws_ok(
  $$update public.scans set model = 'other' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'A cannot update model'
);
select throws_ok(
  $$update public.scans set created_at = '2000-01-01' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'A cannot update created_at'
);
select throws_ok(
  $$update public.scans set user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'A cannot update user_id (even to their own id)'
);
select results_eq(
  $$select status, model, created_at from public.scans where id = 'a0000000-0000-4000-8000-000000000001'$$,
  $$values ('complete'::text, 'test-model'::text, '2026-10-01 12:00:00+00'::timestamptz)$$,
  'A''s scan is unchanged after the update attempts'
);

-- 15: can update image_path
select results_eq(
  $$update public.scans set image_path = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/new.jpg'
    where id = 'a0000000-0000-4000-8000-000000000001' returning image_path$$,
  $$values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/new.jpg'::text)$$,
  'A can update image_path on their own scan'
);

-- 16-17: plain insert still works (the app's normal path)
select lives_ok(
  $$insert into public.scans (id, image_path)
    values ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a0000000-0000-4000-8000-000000000002.jpg')$$,
  'A can insert a scan'
);
select results_eq(
  $$select user_id, status, created_at from public.scans where id = 'a0000000-0000-4000-8000-000000000002'$$,
  $$values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'::uuid, 'pending'::text, now())$$,
  'a plain insert gets user_id = auth.uid(), status pending and created_at now()'
);

-- 18-20: client-supplied server-owned values are overridden on insert
select lives_ok(
  $$insert into public.scans (id, user_id, status, raw_result, model, created_at)
    values ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'complete', '{"analysis": {"is_food": true}}', 'fake-model', '2000-01-01 00:00:00+00')$$,
  'an insert that supplies created_at/status/raw_result/model is accepted'
);
select is(
  (select created_at from public.scans where id = 'a0000000-0000-4000-8000-000000000003'),
  now(),
  'A cannot backdate created_at on insert (it is forced to now())'
);
select results_eq(
  $$select status, raw_result, model from public.scans where id = 'a0000000-0000-4000-8000-000000000003'$$,
  $$values ('pending'::text, null::jsonb, null::text)$$,
  'status is forced to pending and raw_result/model to null on insert'
);

-- 21: the rate-limit window sees every scan A made in this hour
select is(
  (select count(*) from public.scans where created_at >= now() - interval '1 hour'),
  2::bigint,
  'both new scans fall inside the rate-limit window'
);

-- ---------------------------------------------------------------------------
-- Anonymous callers cannot write
-- ---------------------------------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

-- 22
select throws_ok(
  $$update public.scans set image_path = 'x'$$,
  '42501', null,
  'anon cannot update scans'
);

-- ---------------------------------------------------------------------------
-- service_role (analyze-meal) keeps full access
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 23-24
select results_eq(
  $$update public.scans set status = 'complete', raw_result = '{"analysis": {}}', model = 'claude-opus-5-5'
    where id = 'a0000000-0000-4000-8000-000000000002'
      and user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    returning status, model$$,
  $$values ('complete'::text, 'claude-opus-5-5'::text)$$,
  'service_role can record status, raw_result and model'
);
select lives_ok(
  $$insert into public.scans (id, user_id, status, created_at)
    values ('a0000000-0000-4000-8000-000000000004', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'failed', '2026-10-01 00:00:00+00')$$,
  'service_role can insert a scan with explicit values'
);
-- 25
select results_eq(
  $$select status, created_at from public.scans where id = 'a0000000-0000-4000-8000-000000000004'$$,
  $$values ('failed'::text, '2026-10-01 00:00:00+00'::timestamptz)$$,
  'service_role inserts are not overridden by the trigger'
);

-- ---------------------------------------------------------------------------
-- 26-27: account deletion still removes scans
-- ---------------------------------------------------------------------------
reset role;
select lives_ok(
  $$delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,
  'deleting the auth user succeeds'
);
select is(
  (select count(*) from public.scans where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0::bigint,
  'deleting the auth user cascades to their scans'
);

select * from finish();
rollback;
