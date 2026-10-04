-- =============================================================================
-- Close the analyze-meal rate-limit gap with an atomic per-attempt claim.
--
-- Before this migration analyze-meal counted the caller's scans from the last
-- hour (excluding the current one) and then called Claude. Two holes:
--   * Many concurrent requests for one pending scan each passed the check and
--     each made a paid model call.
--   * Retrying a failed or refused scan made a new model call that was never
--     counted.
--
-- Now every model call must first win public.claim_analysis(), which, in one
-- transaction and serialised per user:
--   * refuses a scan that is already being analysed ('busy'),
--   * counts the user's analysis attempts (not scans) in the last hour and
--     refuses at the limit ('rate_limited'),
--   * otherwise records an attempt and marks the scan 'processing'.
-- So each model call, including retries, costs exactly one attempt, and
-- concurrent duplicates are turned away.
--
-- Client roles (anon, authenticated) cannot touch any of this:
--   * scans.status / scans.claimed_at are not in the column UPDATE grant from
--     20261005000000_harden_scans.sql (only image_path is), and the insert
--     trigger forces status = 'pending' and claimed_at = null on client inserts.
--   * analysis_attempts has RLS on, no policies, and no privileges for them.
--   * claim_analysis is executable by service_role only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. scans: a 'processing' status and the time the current attempt was claimed.
-- -----------------------------------------------------------------------------
alter table public.scans drop constraint if exists scans_status_check;
alter table public.scans add constraint scans_status_check
  check (status in ('pending', 'processing', 'complete', 'failed', 'refused'));

alter table public.scans add column claimed_at timestamptz;

comment on column public.scans.claimed_at is
  'When the current (or last) analysis attempt was claimed by claim_analysis(). Server-only.';

-- Re-define the client insert trigger so a client cannot pre-set claimed_at.
-- (status is already forced to 'pending', so a client cannot insert a
-- 'processing' scan either.)
create or replace function public.scans_enforce_client_insert()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- current_user is the role the statement runs as. PostgREST switches to
  -- anon or authenticated for client requests; service_role and the
  -- migration owner are trusted and keep the values they supply.
  if current_user in ('anon', 'authenticated') then
    new.created_at := now();
    new.status     := 'pending';
    new.raw_result := null;
    new.model      := null;
    new.claimed_at := null;
  end if;
  return new;
end;
$$;

comment on function public.scans_enforce_client_insert() is
  'Forces created_at = now(), status = pending and null raw_result/model/claimed_at on client (anon/authenticated) inserts into scans.';

revoke execute on function public.scans_enforce_client_insert() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. analysis_attempts: one row per model call. This is the rate-limit counter.
-- -----------------------------------------------------------------------------
create table public.analysis_attempts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  scan_id     uuid not null references public.scans (id) on delete cascade,
  created_at  timestamptz not null default now()
);

comment on table public.analysis_attempts is
  'One row per analyze-meal model call (including retries). Written only by claim_analysis(); service role only.';

create index analysis_attempts_user_id_created_at_idx
  on public.analysis_attempts (user_id, created_at desc);
create index analysis_attempts_scan_id_idx on public.analysis_attempts (scan_id);

-- RLS on with no policies: client roles see and change nothing. Also drop the
-- table privileges Supabase grants by default, so access fails loudly.
alter table public.analysis_attempts enable row level security;
revoke all on public.analysis_attempts from public, anon, authenticated;
grant select, insert, update, delete on public.analysis_attempts to service_role;

-- -----------------------------------------------------------------------------
-- 3. claim_analysis: the atomic gate in front of every model call.
--
-- Returns one of:
--   'not_found'    no such scan, or it belongs to someone else
--   'complete'     the scan already has a result; no new call is needed
--   'busy'         another attempt claimed it less than p_stale ago
--   'rate_limited' the user already made p_limit attempts in the last hour
--   'claimed'      an attempt was recorded and the scan is now 'processing';
--                  the caller must call the model and then write a final status
-- -----------------------------------------------------------------------------
create function public.claim_analysis(
  p_user  uuid,
  p_scan  uuid,
  p_limit integer,
  p_stale interval default interval '3 minutes'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scan     public.scans%rowtype;
  v_attempts bigint;
begin
  if p_user is null or p_scan is null or p_limit is null then
    raise exception 'claim_analysis: p_user, p_scan and p_limit are required'
      using errcode = '22004';
  end if;

  -- Serialise all claims for this user, so concurrent requests (for the same
  -- scan or different ones) cannot both pass the count below. Released at the
  -- end of the transaction.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));

  select * into v_scan
  from public.scans
  where id = p_scan
  for update;

  if not found or v_scan.user_id <> p_user then
    return 'not_found';
  end if;

  if v_scan.status = 'complete' then
    return 'complete';
  end if;

  if v_scan.status = 'processing'
     and v_scan.claimed_at is not null
     and v_scan.claimed_at > now() - p_stale then
    return 'busy';
  end if;

  select count(*) into v_attempts
  from public.analysis_attempts
  where user_id = p_user
    and created_at > now() - interval '1 hour';

  if v_attempts >= p_limit then
    return 'rate_limited';
  end if;

  insert into public.analysis_attempts (user_id, scan_id)
  values (p_user, p_scan);

  update public.scans
  set status = 'processing', claimed_at = now()
  where id = p_scan;

  return 'claimed';
end;
$$;

comment on function public.claim_analysis(uuid, uuid, integer, interval) is
  'Atomically claims one analysis attempt for a scan (rate limit + in-flight dedupe). Service role only.';

revoke execute on function public.claim_analysis(uuid, uuid, integer, interval)
  from public, anon, authenticated;
grant execute on function public.claim_analysis(uuid, uuid, integer, interval) to service_role;
