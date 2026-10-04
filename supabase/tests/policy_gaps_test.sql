-- Extra coverage for the init migration's UPDATE policies and bucket settings, plus
-- scans privileges for anon. Run with: supabase test db
--
-- NOT covered here: storage DELETE policies. Supabase's storage.protect_delete() trigger rejects
-- direct DELETEs on storage.objects (only the Storage API may delete), so they cannot be tested in SQL.
--
-- NOT covered here: the per-user advisory lock inside claim_analysis(). Serialisation between
-- concurrent transactions cannot be exercised inside one pgTAP transaction, so it is verified
-- only by reading the function (see supabase/migrations/20261006000000_scan_attempts.sql).

begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'b@example.test');

insert into public.scans (id, user_id) values
  ('a0000000-0000-4000-8000-000000000001', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
insert into public.meals (id, user_id, scan_id) values
  ('a0000000-0000-4000-8000-000000000003', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
   'a0000000-0000-4000-8000-000000000001');
insert into storage.objects (bucket_id, name) values
  ('meal-photos', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/own.jpg'),
  ('meal-photos', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/theirs.jpg');

-- Bucket settings
select is(
  (select file_size_limit from storage.buckets where id = 'meal-photos'),
  10485760::bigint,
  'meal-photos has a 10 MB size limit'
);
select ok(
  (select allowed_mime_types from storage.buckets where id = 'meal-photos')
    @> array['image/jpeg', 'image/png', 'image/webp'],
  'meal-photos allows JPEG, PNG and WebP'
);

-- Act as user A
set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated"}', true);

select throws_ok(
  $$update public.meals set scan_id = 'b0000000-0000-4000-8000-000000000001'
    where id = 'a0000000-0000-4000-8000-000000000003'$$,
  '42501', null,
  'A cannot re-point their meal at B''s scan (UPDATE WITH CHECK)'
);
select lives_ok(
  $$update public.meals set scan_id = null where id = 'a0000000-0000-4000-8000-000000000003'$$,
  'A can still detach their own meal from its scan'
);

select is_empty(
  $$update storage.objects set name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/x.jpg'
    where name = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/theirs.jpg' returning id$$,
  'A cannot overwrite B''s photo'
);
select throws_ok(
  $$update storage.objects set name = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/stolen.jpg'
    where name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/own.jpg'$$,
  '42501', null,
  'A cannot move their photo into B''s folder (UPDATE WITH CHECK)'
);
select isnt_empty(
  $$update storage.objects set name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/renamed.jpg'
    where name = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/own.jpg' returning id$$,
  'A can overwrite their own photo (what upsert: true relies on)'
);
select throws_ok(
  $$truncate public.scans$$,
  '42501', null,
  'authenticated cannot TRUNCATE scans'
);

reset role;

-- Anonymous callers
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok(
  $$insert into public.scans (user_id) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')$$,
  '42501', null,
  'anon cannot insert into scans'
);
reset role;

select * from finish();
rollback;
