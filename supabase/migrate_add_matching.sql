-- Supabase migration: Matching tables + RLS + RPCs (idempotent)
-- Paste into Supabase SQL Editor and run.

-- Extensions (safe if already enabled)
create extension if not exists "uuid-ossp";

-- Tables
create table if not exists public.match_requests (
  id uuid primary key default uuid_generate_v4(),
  from_user_id uuid references public.users(userid) on delete cascade not null,
  to_user_id uuid references public.users(userid) on delete cascade not null,
  created_at timestamptz default now(),
  check (from_user_id <> to_user_id)
);

-- If an older schema existed, drop extra columns (safe no-op when absent)
alter table public.match_requests drop column if exists status;
alter table public.match_requests drop column if exists responded_at;

create unique index if not exists match_requests_from_to_unique
on public.match_requests (from_user_id, to_user_id);

create index if not exists match_requests_to_user_created_at_idx
on public.match_requests (to_user_id, created_at desc);

create index if not exists match_requests_from_user_created_at_idx
on public.match_requests (from_user_id, created_at desc);

-- Migrate legacy table name `matches` -> `user_matches` (your Supabase screenshot shows `matches`)
do $$
begin
  if to_regclass('public.user_matches') is null and to_regclass('public.matches') is not null then
    alter table public.matches rename to user_matches;
  end if;
end $$;

create table if not exists public.user_matches (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid references public.users(userid) on delete cascade not null,
  user_b uuid references public.users(userid) on delete cascade not null,
  created_at timestamptz default now(),
  check (user_a < user_b)
);

create unique index if not exists matches_pair_unique
on public.user_matches (user_a, user_b);

create index if not exists matches_user_a_created_at_idx
on public.user_matches (user_a, created_at desc);

create index if not exists matches_user_b_created_at_idx
on public.user_matches (user_b, created_at desc);

create table if not exists public.blocks (
  id uuid primary key default uuid_generate_v4(),
  blocker_id uuid references public.users(userid) on delete cascade not null,
  blocked_id uuid references public.users(userid) on delete cascade not null,
  created_at timestamptz default now(),
  check (blocker_id <> blocked_id)
);

create unique index if not exists blocks_blocker_blocked_unique
on public.blocks (blocker_id, blocked_id);

create table if not exists public.reports (
  id uuid primary key default uuid_generate_v4(),
  reporter_id uuid references public.users(userid) on delete cascade not null,
  target_user_id uuid references public.users(userid) on delete cascade not null,
  target_post_id uuid references public.user_posts(id) on delete cascade,
  reason text,
  created_at timestamptz default now()
);

-- Ensure existing installs have CASCADE semantics + target_user_id required
alter table public.reports
  alter column target_user_id set not null;

alter table public.reports
  drop constraint if exists reports_target_user_id_fkey;
alter table public.reports
  add constraint reports_target_user_id_fkey
  foreign key (target_user_id) references public.users(userid) on delete cascade;

alter table public.reports
  drop constraint if exists reports_target_post_id_fkey;
alter table public.reports
  add constraint reports_target_post_id_fkey
  foreign key (target_post_id) references public.user_posts(id) on delete cascade;

-- RLS
alter table public.match_requests enable row level security;
alter table public.user_matches enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

-- Grants (RLS still applies)
grant select, insert, delete on public.match_requests to authenticated;
grant select, insert, delete on public.user_matches to authenticated;
grant select, insert, delete on public.blocks to authenticated;
grant select, insert on public.reports to authenticated;

-- Policies: match_requests (participants only)
drop policy if exists match_requests_select_participants on public.match_requests;
create policy match_requests_select_participants
on public.match_requests
for select
to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

drop policy if exists match_requests_insert_sender on public.match_requests;
create policy match_requests_insert_sender
on public.match_requests
for insert
to authenticated
with check (from_user_id = auth.uid() and from_user_id <> to_user_id);

-- Delete-based workflow (cancel/accept/decline) needs delete privileges
drop policy if exists match_requests_update_participants on public.match_requests;
drop policy if exists match_requests_delete_participants on public.match_requests;
create policy match_requests_delete_participants
on public.match_requests
for delete
to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

-- Policies: user_matches (participants only)
drop policy if exists matches_select_participants on public.user_matches;
drop policy if exists matches_insert_participants on public.user_matches;
drop policy if exists matches_delete_participants on public.user_matches;
drop policy if exists user_matches_select_participants on public.user_matches;
create policy user_matches_select_participants
on public.user_matches
for select
to authenticated
using (user_a = auth.uid() or user_b = auth.uid());

-- Needed for rpc_accept_match_request (INSERT INTO user_matches)
drop policy if exists user_matches_insert_participants on public.user_matches;
create policy user_matches_insert_participants
on public.user_matches
for insert
to authenticated
with check (user_a = auth.uid() or user_b = auth.uid());

drop policy if exists user_matches_delete_participants on public.user_matches;
create policy user_matches_delete_participants
on public.user_matches
for delete
to authenticated
using (user_a = auth.uid() or user_b = auth.uid());

-- Policies: blocks (owner-only)
drop policy if exists blocks_select_owner on public.blocks;
create policy blocks_select_owner
on public.blocks
for select
to authenticated
using (blocker_id = auth.uid());

drop policy if exists blocks_insert_owner on public.blocks;
create policy blocks_insert_owner
on public.blocks
for insert
to authenticated
with check (blocker_id = auth.uid());

drop policy if exists blocks_delete_owner on public.blocks;
create policy blocks_delete_owner
on public.blocks
for delete
to authenticated
using (blocker_id = auth.uid());

-- Policies: reports (reporter-only read, reporter-only create)
drop policy if exists reports_select_reporter on public.reports;
create policy reports_select_reporter
on public.reports
for select
to authenticated
using (reporter_id = auth.uid());

drop policy if exists reports_insert_reporter on public.reports;
create policy reports_insert_reporter
on public.reports
for insert
to authenticated
with check (reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- RPC: send match request (idempotent)
create or replace function public.rpc_send_match_request(target_user_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  req_id uuid;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot match with self';
  end if;

  insert into public.match_requests (from_user_id, to_user_id)
  values (auth.uid(), target_user_id)
  on conflict (from_user_id, to_user_id) do nothing
  returning id into req_id;

  if req_id is null then
    select id into req_id
    from public.match_requests
    where from_user_id = auth.uid() and to_user_id = target_user_id;
  end if;

  return req_id;
end;
$$;

create or replace function public.rpc_list_match_requests(
  direction text,
  start_index integer default 0,
  limit_count integer default 20
)
returns setof public.match_requests
language sql
security invoker
as $$
  select *
  from public.match_requests
  where (
    direction = 'inbound' and to_user_id = auth.uid()
    or direction = 'outbound' and from_user_id = auth.uid()
  )
  order by created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 50);
$$;

create or replace function public.rpc_accept_match_request(request_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  r public.match_requests%rowtype;
  a uuid;
  b uuid;
begin
  select * into r
  from public.match_requests
  where id = request_id
  for update;

  if not found then
    raise exception 'match request not found';
  end if;
  if r.to_user_id <> auth.uid() then
    raise exception 'only recipient can accept';
  end if;

  delete from public.match_requests
  where id = request_id;

  a := least(r.from_user_id, r.to_user_id);
  b := greatest(r.from_user_id, r.to_user_id);
  insert into public.user_matches (user_a, user_b)
  values (a, b)
  on conflict (user_a, user_b) do nothing;
end;
$$;

create or replace function public.rpc_decline_match_request(request_id uuid)
returns void
language plpgsql
security invoker
as $$
declare
  r public.match_requests%rowtype;
begin
  delete from public.match_requests
  where id = request_id
    and to_user_id = auth.uid();
end;
$$;

-- Cancel == delete request (sender-only)
create or replace function public.rpc_cancel_match_request(request_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  delete from public.match_requests
  where id = request_id
    and from_user_id = auth.uid();
end;
$$;

create or replace function public.rpc_list_matches(
  start_index integer default 0,
  limit_count integer default 50
)
returns setof public.user_matches
language sql
security invoker
as $$
  select *
  from public.user_matches
  where user_a = auth.uid() or user_b = auth.uid()
  order by created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 200);
$$;

create or replace function public.rpc_unmatch(match_id uuid)
returns void
language plpgsql
security invoker
as $$
begin
  delete from public.user_matches
  where id = match_id
    and (user_a = auth.uid() or user_b = auth.uid());
end;
$$;

-- Reports RPCs (two entrypoints; both require target_user_id)
create or replace function public.rpc_report_user(
  target_user_id uuid,
  reason text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  rid uuid;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot report self';
  end if;

  insert into public.reports (reporter_id, target_user_id, target_post_id, reason)
  values (auth.uid(), target_user_id, null, reason)
  returning id into rid;

  return rid;
end;
$$;

create or replace function public.rpc_report_post(
  target_user_id uuid,
  target_post_id uuid,
  reason text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  rid uuid;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;
  if target_post_id is null then
    raise exception 'target_post_id is required';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot report self';
  end if;

  insert into public.reports (reporter_id, target_user_id, target_post_id, reason)
  values (auth.uid(), target_user_id, target_post_id, reason)
  returning id into rid;

  return rid;
end;
$$;

-- Soft-delete my user + cleanup matching/safety tables.
-- This is used by /api/ios/me/delete.
create or replace function public.rpc_request_delete_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set deleted_at = now()
  where userid = auth.uid()
    and deleted_at is null;

  delete from public.match_requests
  where from_user_id = auth.uid() or to_user_id = auth.uid();

  delete from public.user_matches
  where user_a = auth.uid() or user_b = auth.uid();

  delete from public.blocks
  where blocker_id = auth.uid() or blocked_id = auth.uid();

  delete from public.reports
  where reporter_id = auth.uid() or target_user_id = auth.uid();
end;
$$;

-- Ensure authenticated can call RPCs (safe; RLS still enforces row-level access)
grant execute on function public.rpc_send_match_request(uuid) to authenticated;
grant execute on function public.rpc_list_match_requests(text, integer, integer) to authenticated;
grant execute on function public.rpc_accept_match_request(uuid) to authenticated;
grant execute on function public.rpc_decline_match_request(uuid) to authenticated;
grant execute on function public.rpc_cancel_match_request(uuid) to authenticated;
grant execute on function public.rpc_list_matches(integer, integer) to authenticated;
grant execute on function public.rpc_unmatch(uuid) to authenticated;
grant execute on function public.rpc_report_user(uuid, text) to authenticated;
grant execute on function public.rpc_report_post(uuid, uuid, text) to authenticated;
grant execute on function public.rpc_request_delete_user() to authenticated;


