-- Tests for 20261006000000_scan_attempts.sql. Run with: supabase test db
--
-- claim_analysis() is the gate in front of every analyze-meal model call. It
-- must hand out at most one in-flight claim per scan, count every attempt
-- (retries included) against the hourly limit, and be unreachable for users,
-- as must the analysis_attempts table. Everything runs inside a transaction and
-- is rolled back. Note that now() is fixed for the whole transaction.

begin;

create extension if not exists pgtap with schema extensions;

select plan(47);

-- ---------------------------------------------------------------------------
-- Fixtures (as the migration owner)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test');

insert into public.scans (id, user_id, image_path) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a0000000-0000-4000-8000-000000000001.jpg'),
  ('a0000000-0000-4000-8000-000000000002', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/a0000000-0000-4000-8000-000000000002.jpg'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
   'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/b0000000-0000-4000-8000-000000000001.jpg');

-- ---------------------------------------------------------------------------
-- 1-14: schema, RLS and privileges
-- ---------------------------------------------------------------------------
select has_table('public', 'analysis_attempts', 'analysis_attempts exists');
select has_column('public', 'scans', 'claimed_at', 'scans.claimed_at exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.analysis_attempts'::regclass),
  'RLS enabled on analysis_attempts'
);
select is_empty(
  $$select 1 from pg_policies where schemaname = 'public' and tablename = 'analysis_attempts'$$,
  'analysis_attempts has no policies'
);
select ok(
  not (has_table_privilege('authenticated', 'public.analysis_attempts', 'SELECT')
    or has_table_privilege('authenticated', 'public.analysis_attempts', 'INSERT')
    or has_table_privilege('authenticated', 'public.analysis_attempts', 'UPDATE')
    or has_table_privilege('authenticated', 'public.analysis_attempts', 'DELETE')
    or has_table_privilege('authenticated', 'public.analysis_attempts', 'TRUNCATE')),
  'authenticated has no privileges on analysis_attempts'
);
select ok(
  not (has_table_privilege('anon', 'public.analysis_attempts', 'SELECT')
    or has_table_privilege('anon', 'public.analysis_attempts', 'INSERT')
    or has_table_privilege('anon', 'public.analysis_attempts', 'UPDATE')
    or has_table_privilege('anon', 'public.analysis_attempts', 'DELETE')
    or has_table_privilege('anon', 'public.analysis_attempts', 'TRUNCATE')),
  'anon has no privileges on analysis_attempts'
);
select has_index(
  'public', 'analysis_attempts', 'analysis_attempts_user_id_created_at_idx',
  'analysis_attempts has a (user_id, created_at) index'
);
select ok(
  (select prosecdef from pg_proc
    where oid = 'public.claim_analysis(uuid, uuid, integer, interval)'::regprocedure),
  'claim_analysis is security definer'
);
select ok(
  (select 'search_path=""' = any(proconfig) from pg_proc
    where oid = 'public.claim_analysis(uuid, uuid, integer, interval)'::regprocedure),
  'claim_analysis pins an empty search_path'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_analysis(uuid, uuid, integer, interval)', 'EXECUTE'),
  'authenticated cannot execute claim_analysis'
);
select ok(
  not has_function_privilege('anon', 'public.claim_analysis(uuid, uuid, integer, interval)', 'EXECUTE'),
  'anon cannot execute claim_analysis'
);
select ok(
  has_function_privilege('service_role', 'public.claim_analysis(uuid, uuid, integer, interval)', 'EXECUTE'),
  'service_role can execute claim_analysis'
);
-- The harden-scans column grant (image_path only) also covers the new column.
select ok(
  not (has_column_privilege('authenticated', 'public.scans', 'status', 'UPDATE')
    or has_column_privilege('authenticated', 'public.scans', 'claimed_at', 'UPDATE')
    or has_column_privilege('anon', 'public.scans', 'claimed_at', 'UPDATE')),
  'clients cannot update scans.status or scans.claimed_at'
);
select lives_ok(
  $$insert into public.scans (id, user_id, status, claimed_at)
    values ('a0000000-0000-4000-8000-0000000000ff', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            'processing', now())$$,
  'the status check constraint accepts processing'
);

-- ---------------------------------------------------------------------------
-- 15-22: as user A, none of it is reachable
-- ---------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

select throws_ok(
  $$select 1 from public.analysis_attempts$$,
  '42501', null,
  'A cannot read analysis_attempts'
);
select throws_ok(
  $$insert into public.analysis_attempts (user_id, scan_id)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001')$$,
  '42501', null,
  'A cannot insert into analysis_attempts'
);
select throws_ok(
  $$delete from public.analysis_attempts$$,
  '42501', null,
  'A cannot delete from analysis_attempts'
);
select throws_ok(
  $$select public.claim_analysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                                 'a0000000-0000-4000-8000-000000000001', 1000)$$,
  '42501', null,
  'A cannot execute claim_analysis'
);
select throws_ok(
  $$update public.scans set status = 'processing' where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'A cannot set status to processing'
);
select throws_ok(
  $$update public.scans set claimed_at = now() - interval '1 day'
    where id = 'a0000000-0000-4000-8000-000000000001'$$,
  '42501', null,
  'A cannot set claimed_at'
);
select lives_ok(
  $$insert into public.scans (id, status, claimed_at)
    values ('a0000000-0000-4000-8000-000000000003', 'processing', now())$$,
  'an insert that supplies status = processing and claimed_at is accepted'
);
select results_eq(
  $$select status, claimed_at from public.scans where id = 'a0000000-0000-4000-8000-000000000003'$$,
  $$values ('pending'::text, null::timestamptz)$$,
  'the insert trigger forces status pending and claimed_at null for clients'
);

reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

-- 23-24
select throws_ok(
  $$select 1 from public.analysis_attempts$$,
  '42501', null,
  'anon cannot read analysis_attempts'
);
select throws_ok(
  $$select public.claim_analysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
                                 'a0000000-0000-4000-8000-000000000001', 1000)$$,
  '42501', null,
  'anon cannot execute claim_analysis'
);

-- ---------------------------------------------------------------------------
-- service_role (analyze-meal): claim semantics
-- ---------------------------------------------------------------------------
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- 25-28: first claim wins, second is busy and costs nothing
select is(
  public.claim_analysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 5),
  'claimed',
  'first claim on a pending scan is claimed'
);
select results_eq(
  $$select status, claimed_at from public.scans where id = 'a0000000-0000-4000-8000-000000000001'$$,
  $$values ('processing'::text, now())$$,
  'a claimed scan is processing with claimed_at = now()'
);
select is(
  public.claim_analysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 5),
  'busy',
  'a second claim on the same scan is busy'
);
select is(
  (select count(*) from public.analysis_attempts where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  1::bigint,
  'the busy claim did not record an attempt'
);

-- 29-30: ownership
select is(
  public.claim_analysis('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'a0000000-0000-4000-8000-000000000002', 5),
  'not_found',
  'claiming another user''s scan is not_found'
);
select is(
  public.claim_analysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-0000000000aa', 5),
  'not_found',
  'claiming a missing scan is not_found'
);

-- 31-33: a stale claim (the worker died) can be reclaimed, and costs an attempt
update public.scans set claimed_at = now() - interval '10 minutes'
  where id = 'a0000000-0000-4000-8000-000000000001';
select is(
  public.claim_analysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 5),
  'claimed',
  'a claim older than the default 3 minutes can be reclaimed'
);
update public.scans set claimed_at = now() - interval '1 minute'
  where id = 'a0000000-0000-4000-8000-000000000001';
select is(
  public.claim_analysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 5,
                        interval '30 seconds'),
  'claimed',
  'p_stale overrides the staleness window'
);
select is(
  (select count(*) from public.analysis_attempts where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  3::bigint,
  'each reclaim recorded an attempt'
);

-- 34-35: retrying a failed scan claims again and counts as an attempt
update public.scans set status = 'failed' where id = 'a0000000-0000-4000-8000-000000000001';
select is(
  public.claim_analysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 5),
  'claimed',
  'a failed scan can be retried'
);
select is(
  (select count(*) from public.analysis_attempts
    where scan_id = 'a0000000-0000-4000-8000-000000000001'),
  4::bigint,
  'the retry recorded an attempt'
);

-- 36-38: the limit counts attempts (retries included), not scans
select is(
  public.claim_analysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 4),
  'rate_limited',
  'a fresh scan is rate_limited once retries of another scan reach the limit'
);
select results_eq(
  $$select status, claimed_at from public.scans where id = 'a0000000-0000-4000-8000-000000000002'$$,
  $$values ('pending'::text, null::timestamptz)$$,
  'a rate_limited claim leaves the scan untouched'
);
select is(
  (select count(*) from public.analysis_attempts where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  4::bigint,
  'a rate_limited claim does not record an attempt'
);

-- 39: attempts older than an hour fall out of the window
update public.analysis_attempts set created_at = now() - interval '61 minutes'
  where id = (select id from public.analysis_attempts
              where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' limit 1);
select is(
  public.claim_analysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 4),
  'claimed',
  'attempts older than an hour do not count'
);

-- 40: the limit is per user
select is(
  public.claim_analysis('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b0000000-0000-4000-8000-000000000001', 1),
  'claimed',
  'B''s limit is not affected by A''s attempts'
);

-- 41-42: complete scans are never re-analysed
update public.scans set status = 'complete' where id = 'a0000000-0000-4000-8000-000000000001';
select is(
  public.claim_analysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000001', 100),
  'complete',
  'claiming a complete scan returns complete'
);
select is(
  (select count(*) from public.analysis_attempts where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  5::bigint,
  'a complete claim does not record an attempt'
);

-- 43: refused scans can be retried too (and are counted)
update public.scans set status = 'refused' where id = 'a0000000-0000-4000-8000-000000000002';
select is(
  public.claim_analysis('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a0000000-0000-4000-8000-000000000002', 100),
  'claimed',
  'a refused scan can be retried'
);

-- 44: service_role can read the counter
select is(
  (select count(*) from public.analysis_attempts),
  7::bigint,
  'service_role can read analysis_attempts'
);

-- ---------------------------------------------------------------------------
-- 45-47: cascades
-- ---------------------------------------------------------------------------
reset role;
select throws_ok(
  $$select public.claim_analysis(null, 'a0000000-0000-4000-8000-000000000001', 5)$$,
  '22004', null,
  'claim_analysis rejects null arguments'
);
delete from public.scans where id = 'b0000000-0000-4000-8000-000000000001';
select is(
  (select count(*) from public.analysis_attempts where user_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  0::bigint,
  'deleting a scan cascades to its attempts'
);
delete from auth.users where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
select is(
  (select count(*) from public.analysis_attempts where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  0::bigint,
  'deleting an auth user cascades to their attempts'
);

select * from finish();
rollback;
