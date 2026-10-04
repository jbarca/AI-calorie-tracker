-- =============================================================================
-- Harden public.scans so it can serve as the analyze-meal rate-limit counter.
--
-- Problem: analyze-meal limits users to N analyses per rolling hour by counting
-- their scans rows. With the init migration a user could delete their own
-- scans, or rewrite created_at/status/raw_result/model, to reset that count and
-- run unlimited paid model calls. (The function now also counts with the
-- service role, so RLS changes cannot hide rows from it; see handler.ts.)
--
-- After this migration, for client roles (anon, authenticated):
--   * scans is append-only: no DELETE (policy dropped and privilege revoked).
--     Account deletion still removes scans via ON DELETE CASCADE from
--     auth.users, which does not go through these privileges or policies.
--   * UPDATE is limited to image_path, by column privileges. The init
--     migration's "scans: update own" RLS policy still scopes it to own rows.
--   * On INSERT, created_at, status, raw_result and model are server-assigned:
--     a BEFORE INSERT trigger overwrites whatever the client sent.
--
-- service_role (used by analyze-meal to record results) and the migration
-- owner keep full access.
--
-- Why column privileges for UPDATE rather than a BEFORE UPDATE trigger: they
-- are declarative, enforced by Postgres before RLS or any row is touched, are
-- visible in information_schema.column_privileges, and fail loudly (42501)
-- instead of silently rewriting values. A trigger would need its own role
-- checks and could drift from the policy set.
--
-- Why a trigger for INSERT rather than column privileges: an INSERT naming an
-- ungranted column is rejected outright, so a column grant could only reject
-- client-supplied values, not override them. The trigger lets existing callers
-- that send status = 'pending' keep working while still guaranteeing the
-- server-side values.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. No deletes by users. Scans are an append-only audit log.
-- -----------------------------------------------------------------------------
drop policy if exists "scans: delete own" on public.scans;

-- Belt and braces: with no policy, RLS already denies deletes, but also remove
-- the table privilege Supabase grants by default. TRUNCATE bypasses RLS, so it
-- goes too (PostgREST does not expose it, but direct SQL access might).
revoke delete, truncate on public.scans from anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. Users may only update image_path (e.g. after uploading the photo).
--    Revoking the table-level privilege also revokes any column-level ones.
-- -----------------------------------------------------------------------------
revoke update on public.scans from anon, authenticated;
grant update (image_path) on public.scans to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Server-assigned columns on client inserts.
-- -----------------------------------------------------------------------------
alter table public.scans alter column created_at set default now();
alter table public.scans alter column status set default 'pending';

create function public.scans_enforce_client_insert()
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
  end if;
  return new;
end;
$$;

comment on function public.scans_enforce_client_insert() is
  'Forces created_at = now(), status = pending and null raw_result/model on client (anon/authenticated) inserts into scans.';

-- Trigger functions are never called directly; keep it off the RPC surface.
revoke execute on function public.scans_enforce_client_insert() from public, anon, authenticated;

create trigger scans_enforce_client_insert
  before insert on public.scans
  for each row execute function public.scans_enforce_client_insert();
