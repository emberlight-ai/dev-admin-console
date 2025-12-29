-- Enable UUID extension
create extension if not exists "uuid-ossp";
-- Enable PostGIS for geospatial queries (range/bbox, distance, etc.)
create extension if not exists postgis;

-- updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Create User table
create table public.users (
  -- Align app user id to Supabase Auth user id for consistent identity + simple RLS.
  userid uuid primary key references auth.users(id) on delete cascade,
  -- Allow bootstrap on signup; app should prompt user to complete profile.
  username text not null default '',
  age integer,
  gender text,
  personality text,
  zipcode text,
  phone text,
  bio text,
  education text,
  profession text,
  avatar text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  is_digital_human boolean default false
);

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

-- Auto-create a profile row on signup (email/apple/google) so iOS can immediately read/update profile.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (userid, username, is_digital_human)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', ''),
    false
  )
  on conflict (userid) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Safe public profile projection for matched users (omit phone/zipcode, etc.)
create or replace view public.user_public_profiles as
select
  userid,
  username,
  age,
  gender,
  personality,
  profession,
  bio,
  education,
  avatar,
  created_at,
  updated_at,
  is_digital_human
from public.users
where deleted_at is null;

-- Create SystemPrompts table (versioned system prompt templates per gender + personality)
create table public."SystemPrompts" (
  id uuid primary key default uuid_generate_v4(),
  gender text not null,
  personality text not null,
  system_prompt text not null,
  created_at timestamptz default now()
);

-- Fast lookup for newest prompt by (gender, personality)
create index if not exists systemprompts_gender_personality_created_at_idx
on public."SystemPrompts" (gender, personality, created_at desc);

-- Create UserPosts table
create table public.user_posts (
  id uuid primary key default uuid_generate_v4(),
  userid uuid references public.users(userid) on delete cascade not null,
  photos text[] not null default '{}',
  description text,
  location_name text,
  longitude double precision,
  latitude double precision,
  altitude double precision,
  occurred_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

drop trigger if exists user_posts_set_updated_at on public.user_posts;
create trigger user_posts_set_updated_at
before update on public.user_posts
for each row
execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row Level Security (RLS)
-- - Reads: any authenticated user can read profiles/posts (excluding soft-deleted rows)
-- - Writes: only the owner (userid = auth.uid())
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.user_posts enable row level security;

drop policy if exists users_read_authenticated on public.users;
drop policy if exists "Public read profiles" on public.users;
create policy "Public read profiles" on public.users
  for select
  to public
  using (deleted_at is null);

drop policy if exists users_insert_owner on public.users;
create policy users_insert_owner
on public.users
for insert
to authenticated
with check (userid = auth.uid());

drop policy if exists users_update_owner on public.users;
create policy users_update_owner
on public.users
for update
to authenticated
using (userid = auth.uid() and deleted_at is null)
with check (userid = auth.uid());

drop policy if exists users_delete_owner on public.users;
create policy users_delete_owner
on public.users
for delete
to authenticated
using (userid = auth.uid());

drop policy if exists user_posts_read_authenticated on public.user_posts;
create policy user_posts_read_authenticated
on public.user_posts
for select
to authenticated
using (deleted_at is null);

drop policy if exists user_posts_insert_owner on public.user_posts;
create policy user_posts_insert_owner
on public.user_posts
for insert
to authenticated
with check (userid = auth.uid());

drop policy if exists user_posts_update_owner on public.user_posts;
create policy user_posts_update_owner
on public.user_posts
for update
to authenticated
using (userid = auth.uid() and deleted_at is null)
with check (userid = auth.uid());

drop policy if exists user_posts_delete_owner on public.user_posts;
create policy user_posts_delete_owner
on public.user_posts
for delete
to authenticated
using (userid = auth.uid());

-- Geospatial point for indexing (generated from longitude/latitude)
alter table public.user_posts
  add column if not exists geom geometry(Point, 4326)
  generated always as (
    case
      when longitude is null or latitude is null then null
      else st_setsrid(st_makepoint(longitude, latitude), 4326)
    end
  ) stored;

-- Basic coordinate validation (allows NULL when no location set)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_posts_longitude_range'
      and conrelid = 'public.user_posts'::regclass
  ) then
    alter table public.user_posts
      add constraint user_posts_longitude_range
      check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_posts_latitude_range'
      and conrelid = 'public.user_posts'::regclass
  ) then
    alter table public.user_posts
      add constraint user_posts_latitude_range
      check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;
end $$;

-- Fast bounding-box and spatial queries
create index if not exists user_posts_geom_gix on public.user_posts using gist (geom);
-- Common sorting / filtering by time
create index if not exists user_posts_occurred_at_idx on public.user_posts (occurred_at);

-- ---------------------------------------------------------------------------
-- RPCs for efficient pagination + 3D Earth rendering
-- ---------------------------------------------------------------------------

create or replace function public.rpc_get_user_posts(
  target_user_id uuid,
  start_index integer default 0,
  limit_count integer default 5,
  has_location boolean default false
)
returns setof public.user_posts
language sql
security invoker
as $$
  select *
  from public.user_posts
  where userid = target_user_id
    and deleted_at is null
    and (
      not has_location
      or geom is not null
      or location_name is not null
    )
  order by occurred_at desc, created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 50);
$$;

create or replace function public.rpc_get_user_locations(
  target_user_id uuid,
  start_index integer default 0,
  limit_count integer default 200
)
returns table (
  post_id uuid,
  occurred_at timestamptz,
  longitude double precision,
  latitude double precision,
  altitude double precision,
  location_name text
)
language sql
security invoker
as $$
  select
    id as post_id,
    occurred_at,
    longitude,
    latitude,
    altitude,
    location_name
  from public.user_posts
  where userid = target_user_id
    and deleted_at is null
    and (geom is not null or location_name is not null)
  order by occurred_at desc, created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 500);
$$;

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

  -- Cleanup: remove the user's presence from matching/safety tables.
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

-- ---------------------------------------------------------------------------
-- Matching (mutual agreement) + safety controls (blocks/reports)
-- ---------------------------------------------------------------------------

-- Match requests are minimal: row exists == request exists.
-- - A sends -> INSERT
-- - A cancels -> DELETE
-- - B accepts -> DELETE request + INSERT into user_matches
create table if not exists public.match_requests (
  id uuid primary key default uuid_generate_v4(),
  from_user_id uuid references public.users(userid) on delete cascade not null,
  to_user_id uuid references public.users(userid) on delete cascade not null,
  created_at timestamptz default now(),
  check (from_user_id <> to_user_id)
);

-- If this project previously used status/enum, keep it compatible (safe no-op when absent)
alter table public.match_requests drop column if exists status;
alter table public.match_requests drop column if exists responded_at;

create unique index if not exists match_requests_from_to_unique
on public.match_requests (from_user_id, to_user_id);

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

-- Keep original index name to avoid duplicates even after rename.
create unique index if not exists matches_pair_unique
on public.user_matches (user_a, user_b);

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
  -- Always set:
  -- - reporting a user: target_user_id set, target_post_id NULL
  -- - reporting a post: target_user_id set, target_post_id set
  target_user_id uuid references public.users(userid) on delete cascade not null,
  target_post_id uuid references public.user_posts(id) on delete cascade,
  reason text,
  created_at timestamptz default now()
);

alter table public.match_requests enable row level security;
alter table public.user_matches enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

-- Participants-only for match requests
drop policy if exists match_requests_select_participants on public.match_requests;
drop policy if exists "Authenticated can read all match requests" on public.match_requests;
drop policy if exists "Public can read all match requests" on public.match_requests;
create policy "Public can read all match requests" on public.match_requests
for select
to public
using (true);

drop policy if exists match_requests_insert_sender on public.match_requests;
create policy match_requests_insert_sender
on public.match_requests
for insert
to authenticated
with check (from_user_id = auth.uid() and from_user_id <> to_user_id);

-- Delete-based workflow needs delete privileges (cancel/accept/decline)
drop policy if exists match_requests_update_participants on public.match_requests;
drop policy if exists match_requests_delete_participants on public.match_requests;
create policy match_requests_delete_participants
on public.match_requests
for delete
to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

-- Participants-only for user_matches
drop policy if exists matches_select_participants on public.user_matches;
drop policy if exists matches_insert_participants on public.user_matches;
drop policy if exists matches_delete_participants on public.user_matches;
drop policy if exists user_matches_select_participants on public.user_matches;
drop policy if exists "Authenticated can read all matches" on public.user_matches;
drop policy if exists "Public can read all matches" on public.user_matches;
create policy "Public can read all matches" on public.user_matches
for select
to public
using (true);

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

-- Blocks: owner-only
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

-- Reports: reporter-only read, reporter-only create
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

-- MVP (loose): no match-gated reads in RLS; reads are allowed for any authenticated user.

-- RPC: send match request (idempotent)
create or replace function public.rpc_send_match_request(target_user_id uuid)
returns uuid
language plpgsql
security invoker
as $$
declare
  req_id uuid;
  match_id uuid;
  a uuid;
  b uuid;
  reciprocal_id uuid;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot match with self';
  end if;

  -- If already matched, return existing match id.
  a := least(auth.uid(), target_user_id);
  b := greatest(auth.uid(), target_user_id);
  select id into match_id
  from public.user_matches
  where user_a = a and user_b = b
  limit 1;
  if match_id is not null then
    return match_id;
  end if;

  -- If the other user has already invited me, auto-match:
  -- delete both pending requests and insert into user_matches.
  select id into reciprocal_id
  from public.match_requests
  where from_user_id = target_user_id
    and to_user_id = auth.uid()
  limit 1;

  if reciprocal_id is not null then
    delete from public.match_requests
    where (from_user_id = auth.uid() and to_user_id = target_user_id)
       or (from_user_id = target_user_id and to_user_id = auth.uid());

    insert into public.user_matches (user_a, user_b)
    values (a, b)
    on conflict (user_a, user_b) do update set created_at = public.user_matches.created_at
    returning id into match_id;

    return match_id;
  end if;

  -- Normal path: create (or return existing) outbound request.
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
returns table (
  request_id uuid,
  from_user_id uuid,
  to_user_id uuid,
  created_at timestamptz,
  other_user_id uuid,
  other_username text,
  other_avatar text
)
language sql
security invoker
as $$
  select
    mr.id as request_id,
    mr.from_user_id,
    mr.to_user_id,
    mr.created_at,
    u.userid as other_user_id,
    u.username as other_username,
    u.avatar as other_avatar
  from public.match_requests mr
  join public.users u
    on u.userid = case
      when direction = 'inbound' then mr.from_user_id
      when direction = 'outbound' then mr.to_user_id
      else null
    end
  where (
    direction = 'inbound' and mr.to_user_id = auth.uid()
    or direction = 'outbound' and mr.from_user_id = auth.uid()
  )
  order by mr.created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 50);
$$;

create or replace function public.rpc_accept_match_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.match_requests%rowtype;
  a uuid;
  b uuid;
begin
  -- Verify user is authenticated
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

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

  -- Accept == delete request and create match
  delete from public.match_requests
  where id = request_id;

  a := least(r.from_user_id, r.to_user_id);
  b := greatest(r.from_user_id, r.to_user_id);
  insert into public.user_matches (user_a, user_b)
  values (a, b)
  on conflict (user_a, user_b) do nothing;
end;
$$;

-- Decline == delete request (recipient-only)
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

create or replace function public.rpc_list_connections(
  start_index integer default 0,
  limit_count integer default 50
)
returns table (
  id uuid,
  connection_username text,
  connection_user_id uuid,
  connection_avatar text,
  created_at timestamptz,
  is_new_connection boolean
)
language sql
security invoker
as $$
  select
    um.id,
    u.username as connection_username,
    u.userid as connection_user_id,
    u.avatar as connection_avatar,
    um.created_at,
    not exists (
      select 1
      from public.messages m
      where m.match_id = um.id
      limit 1
    ) as is_new_connection
  from public.user_matches um
  join public.users u
    on u.userid = case
      when um.user_a = auth.uid() then um.user_b
      else um.user_a
    end
  where um.user_a = auth.uid() or um.user_b = auth.uid()
  order by um.created_at desc
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
-- Create Storage Bucket for images
insert into storage.buckets (id, name, public) 
values ('images', 'images', true)
on conflict (id) do nothing;

-- Storage Policies (Allow public read, authenticated insert/update/delete)
-- Note: In a real app, you'd want stricter policies.
drop policy if exists "Public Access" on storage.objects;
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'images' );

-- Allow only authenticated users, and only within their own folder: <auth.uid()>/...
drop policy if exists "Authenticated Upload" on storage.objects;
create policy "Authenticated Upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Authenticated Update" on storage.objects;
create policy "Authenticated Update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Authenticated Delete" on storage.objects;
create policy "Authenticated Delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- ==============================================================================
-- CHAT & PUSH NOTIFICATIONS (Added 2024-12-24)
-- ==============================================================================

-- 1. Store FCM Tokens for Push Notifications
create table if not exists public.user_push_tokens (
  user_id uuid references public.users(userid) on delete cascade not null,
  token text not null,
  platform text check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz default now(),
  primary key (user_id, token)
);

alter table public.user_push_tokens enable row level security;

drop policy if exists "Users manage their own tokens" on public.user_push_tokens;
create policy "Users manage their own tokens" on public.user_push_tokens
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 2. Messages Table
create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references public.user_matches(id) on delete cascade not null,
  sender_id uuid references public.users(userid) on delete cascade not null,
  -- The other participant in the match. Filled automatically when NULL (see trigger below).
  receiver_id uuid references public.users(userid) on delete cascade,
  content text, -- Text content
  media_url text, -- Optional for images/audio
  created_at timestamptz default now()
);

-- Ensure receiver_id is set for inserts (supports legacy clients that don't send receiver_id)
create or replace function public.set_message_receiver_id()
returns trigger
language plpgsql
as $$
declare
  a uuid;
  b uuid;
begin
  if new.receiver_id is not null then
    return new;
  end if;

  select user_a, user_b into a, b
  from public.user_matches
  where id = new.match_id;

  if not found then
    return new;
  end if;

  if new.sender_id = a then
    new.receiver_id := b;
  elsif new.sender_id = b then
    new.receiver_id := a;
  end if;

  return new;
end;
$$;

drop trigger if exists messages_set_receiver_id on public.messages;
create trigger messages_set_receiver_id
before insert on public.messages
for each row
execute function public.set_message_receiver_id();

-- RLS: Allow any authenticated user to read and send messages (MVP Loose Mode)
alter table public.messages enable row level security;

drop policy if exists "Participants can read messages" on public.messages;
drop policy if exists "Authenticated can read all messages" on public.messages;
drop policy if exists "Public can read all messages" on public.messages;
create policy "Public can read all messages" on public.messages
  for select
  to public
  using (true);

drop policy if exists "Participants can send messages" on public.messages;
drop policy if exists "Authenticated can send messages" on public.messages;
drop policy if exists "Public can send messages" on public.messages;
create policy "Public can send messages" on public.messages
  for insert
  to public
  with check (true);

-- RPC: Get messages for a match with pagination
create or replace function public.rpc_get_messages(
  match_id uuid,
  start_index integer default 0,
  limit_count integer default 50
)
returns setof public.messages
language sql
security invoker
as $$
  select *
  from public.messages
  where messages.match_id = rpc_get_messages.match_id
  order by created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 100);
$$;

-- RPC: Send a message (Wrapper for INSERT, simplified for MVP)
-- Populates receiver_id automatically from user_matches.
create or replace function public.rpc_send_message(
  match_id uuid,
  content text default null,
  media_url text default null,
  sender_id uuid default null,
  receiver_id uuid default null
)
returns public.messages
language plpgsql
security invoker
as $$
declare
  msg public.messages;
  final_sender uuid;
  final_receiver uuid;
  a uuid;
  b uuid;
begin
  if match_id is null then
    raise exception 'match_id is required';
  end if;
  if content is null and media_url is null then
    raise exception 'content or media_url is required';
  end if;

  -- Determine sender: provided id > auth.uid()
  final_sender := coalesce(sender_id, auth.uid());
  
  if final_sender is null then
     raise exception 'sender_id required (not logged in)';
  end if;

  -- Determine receiver from match participants (or use explicit receiver_id if provided)
  select user_a, user_b into a, b
  from public.user_matches
  where id = match_id;

  if not found then
    raise exception 'match not found';
  end if;

  final_receiver := coalesce(
    receiver_id,
    case
      when final_sender = a then b
      when final_sender = b then a
      else null
    end
  );

  if final_receiver is null then
    raise exception 'sender not in match';
  end if;
  if final_receiver = final_sender then
    raise exception 'cannot message self';
  end if;

  insert into public.messages (match_id, sender_id, receiver_id, content, media_url)
  values (match_id, final_sender, final_receiver, content, media_url)
  returning * into msg;

  return msg;
end;
$$;

-- RPC: Fetch connection chat metadata (last message + unread count)
create or replace function public.rpc_fetch_connections_chat_metas(
  params jsonb
)
returns table (
  match_id uuid,
  message text,
  created_at timestamptz,
  sender_id uuid,
  receiver_id uuid,
  unread_count bigint,
  media_url text,
  message_id uuid
)
language plpgsql
security invoker
as $$
begin
  return query
  with input_data as (
    select
      (e->>'match_id')::uuid as m_id,
      (e->>'last_read_time')::timestamptz as lrt
    from jsonb_array_elements(params) as e
  ),
  match_ids as (
    select distinct m_id from input_data
  ),
  last_msgs as (
    select distinct on (m.match_id)
      m.match_id,
      m.content,
      m.created_at,
      m.sender_id,
      m.receiver_id,
      m.media_url,
      m.id
    from public.messages m
    join match_ids mi on m.match_id = mi.m_id
    order by m.match_id, m.created_at desc
  ),
  my_last_sent as (
    select
      m.match_id,
      max(m.created_at) as last_sent_at
    from public.messages m
    where m.sender_id = auth.uid()
    and m.match_id in (select m_id from match_ids)
    group by m.match_id
  ),
  unread_calc as (
    select
      i.m_id,
      count(m.id) as cnt
    from input_data i
    left join my_last_sent mls on mls.match_id = i.m_id
    left join public.messages m on m.match_id = i.m_id
    where
      m.sender_id <> auth.uid() -- Only count incoming messages
      and (
        case
          when i.lrt is not null then m.created_at > i.lrt
          when mls.last_sent_at is not null then m.created_at > mls.last_sent_at
          else true -- If no last_read_time and I haven't sent anything, count all incoming
        end
      )
    group by i.m_id
  )
  select
    lm.match_id,
    lm.content as message,
    lm.created_at,
    lm.sender_id,
    lm.receiver_id,
    coalesce(uc.cnt, 0) as unread_count,
    lm.media_url,
    lm.id as message_id
  from last_msgs lm
  left join unread_calc uc on uc.m_id = lm.match_id;
end;
$$;

-- Enable Realtime for messages (Required for chat subscriptions)
alter publication supabase_realtime add table public.messages;

-- ==============================================================================
-- DIGITAL HUMAN AUTOMATION (Added for automated digital human interactions)
-- ==============================================================================

-- 1. Track invites sent from digital humans to real users
create table if not exists public.digital_human_invites_tracking (
  user_id uuid references public.users(userid) on delete cascade not null primary key,
  invite_count integer not null default 0,
  updated_at timestamptz default now()
);

drop trigger if exists digital_human_invites_tracking_set_updated_at on public.digital_human_invites_tracking;
create trigger digital_human_invites_tracking_set_updated_at
before update on public.digital_human_invites_tracking
for each row
execute function public.set_updated_at();

-- 2. Configuration table for digital human automation parameters
create table if not exists public.digital_human_config (
  key text primary key,
  value text not null,
  description text
);

-- Insert default configuration values
insert into public.digital_human_config (key, value, description)
values
  ('max_invites_per_user', '5', 'Maximum invites a real user can receive from digital humans'),
  ('invites_per_cron_run', '5', 'How many invites to send per cron execution'),
  ('accept_rate_percentage', '30', 'Percentage of requests digital humans accept (0-100)'),
  ('active_hour_start', '5', 'Start hour for digital human activity in PST (0-23, 5 = 5 AM)'),
  ('active_hour_end', '23', 'End hour for digital human activity in PST (0-23, 23 = 11:59 PM)')
on conflict (key) do nothing;

-- 3. Function: Send match invites from digital humans to real users
create or replace function public.send_digital_human_invites()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  current_hour_pst integer;
  active_start integer;
  active_end integer;
  max_invites integer;
  invites_per_run integer;
  invites_sent integer := 0;
  digital_human_id uuid;
  real_user_id uuid;
  existing_count integer;
  invite_count integer;
begin
  -- Check if we're within active hours (5 AM - 11:59 PM PST)
  select extract(hour from (now() AT TIME ZONE 'America/Los_Angeles'))::integer into current_hour_pst;
  select value::integer into active_start from public.digital_human_config where key = 'active_hour_start';
  select value::integer into active_end from public.digital_human_config where key = 'active_hour_end';
  
  -- Default values if config is missing
  active_start := coalesce(active_start, 5);
  active_end := coalesce(active_end, 23);
  
  -- Return early if outside active hours
  if current_hour_pst < active_start or current_hour_pst > active_end then
    return 0;
  end if;
  
  -- Get configuration
  select value::integer into max_invites from public.digital_human_config where key = 'max_invites_per_user';
  select value::integer into invites_per_run from public.digital_human_config where key = 'invites_per_cron_run';
  
  -- Default values if config is missing
  max_invites := coalesce(max_invites, 5);
  invites_per_run := coalesce(invites_per_run, 5);
  
  -- Loop to send invites
  for i in 1..invites_per_run loop
    -- Select a random digital human
    select userid into digital_human_id
    from public.users
    where is_digital_human = true
      and deleted_at is null
    order by random()
    limit 1;
    
    -- If no digital humans exist, exit
    if digital_human_id is null then
      exit;
    end if;
    
    -- Select a real user who:
    -- 1. Hasn't exceeded max invites
    -- 2. Doesn't already have a pending request with this digital human
    -- 3. Isn't already matched with this digital human
    -- 4. Isn't blocked by or blocking this digital human
    -- Prioritize older users first (newer users last) by ordering by created_at ASC
    select u.userid into real_user_id
    from public.users u
    left join public.digital_human_invites_tracking dt on dt.user_id = u.userid
    where u.is_digital_human = false
      and u.deleted_at is null
      and coalesce(dt.invite_count, 0) < max_invites
      and not exists (
        select 1 from public.match_requests mr
        where (mr.from_user_id = digital_human_id and mr.to_user_id = u.userid)
           or (mr.from_user_id = u.userid and mr.to_user_id = digital_human_id)
      )
      and not exists (
        select 1 from public.user_matches um
        where (um.user_a = least(digital_human_id, u.userid) and um.user_b = greatest(digital_human_id, u.userid))
      )
      and not exists (
        select 1 from public.blocks b
        where (b.blocker_id = digital_human_id and b.blocked_id = u.userid)
           or (b.blocker_id = u.userid and b.blocked_id = digital_human_id)
      )
    order by u.created_at asc
    limit 1;
    
    -- If no eligible real user found, continue to next iteration
    if real_user_id is null then
      continue;
    end if;
    
    -- Insert match request
    insert into public.match_requests (from_user_id, to_user_id)
    values (digital_human_id, real_user_id)
    on conflict (from_user_id, to_user_id) do nothing;
    
    -- Update or insert tracking
    insert into public.digital_human_invites_tracking (user_id, invite_count)
    values (real_user_id, 1)
    on conflict (user_id) do update
    set invite_count = digital_human_invites_tracking.invite_count + 1;
    
    invites_sent := invites_sent + 1;
  end loop;
  
  return invites_sent;
end;
$$;

-- 4. Function: Process match requests for digital humans (accept/reject)
create or replace function public.process_digital_human_requests()
returns table(accepted integer, rejected integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_hour_pst integer;
  active_start integer;
  active_end integer;
  accept_rate numeric;
  request_record record;
  accepted_count integer := 0;
  rejected_count integer := 0;
  a uuid;
  b uuid;
begin
  -- Check if we're within active hours (5 AM - 11:59 PM PST)
  select extract(hour from (now() AT TIME ZONE 'America/Los_Angeles'))::integer into current_hour_pst;
  select value::integer into active_start from public.digital_human_config where key = 'active_hour_start';
  select value::integer into active_end from public.digital_human_config where key = 'active_hour_end';
  
  -- Default values if config is missing
  active_start := coalesce(active_start, 5);
  active_end := coalesce(active_end, 23);
  
  -- Return early if outside active hours
  if current_hour_pst < active_start or current_hour_pst > active_end then
    return query select 0::integer, 0::integer;
    return;
  end if;
  
  -- Get accept rate configuration
  select value::numeric into accept_rate from public.digital_human_config where key = 'accept_rate_percentage';
  accept_rate := coalesce(accept_rate, 30) / 100.0; -- Convert percentage to decimal
  
  -- Process up to 3 pending requests where to_user_id is a digital human
  -- Random selection makes it more realistic (not all digital humans respond instantly)
  for request_record in
    select mr.id, mr.from_user_id, mr.to_user_id
    from public.match_requests mr
    join public.users u on u.userid = mr.to_user_id
    where u.is_digital_human = true
      and u.deleted_at is null
    order by random()
    limit 3
    for update skip locked
  loop
    -- Randomly decide: accept (30%) or reject (70%)
    if random() < accept_rate then
      -- Accept: delete request and create match
      delete from public.match_requests
      where id = request_record.id;
      
      a := least(request_record.from_user_id, request_record.to_user_id);
      b := greatest(request_record.from_user_id, request_record.to_user_id);
      
      insert into public.user_matches (user_a, user_b)
      values (a, b)
      on conflict (user_a, user_b) do nothing;
      
      accepted_count := accepted_count + 1;
    else
      -- Reject: delete the request
      delete from public.match_requests
      where id = request_record.id;
      
      rejected_count := rejected_count + 1;
    end if;
  end loop;
  
  return query select accepted_count, rejected_count;
end;
$$;

-- 5. Enable pg_cron extension and schedule jobs
-- Note: pg_cron may not be available in all Supabase plans. If unavailable, use Supabase Edge Functions
-- with scheduled invocations or an external cron service.
create extension if not exists pg_cron;

-- Schedule job to send invites from digital humans (every 1 hour)
do $$
declare
  job_exists boolean;
begin
  -- Check if job already exists
  select exists(
    select 1 from cron.job where jobname = 'send-digital-human-invites'
  ) into job_exists;
  
  if job_exists then
    -- Unschedule existing job
    perform cron.unschedule('send-digital-human-invites');
  end if;
  
  -- Schedule the job
  perform cron.schedule(
    'send-digital-human-invites',
    '0 * * * *', -- Every 1 hour
    $cmd$select public.send_digital_human_invites()$cmd$
  );
end $$;

-- Schedule job to process digital human match requests (every 5 minutes)
do $$
declare
  job_exists boolean;
begin
  -- Check if job already exists
  select exists(
    select 1 from cron.job where jobname = 'process-digital-human-requests'
  ) into job_exists;
  
  if job_exists then
    -- Unschedule existing job
    perform cron.unschedule('process-digital-human-requests');
  end if;
  
  -- Schedule the job
  perform cron.schedule(
    'process-digital-human-requests',
    '*/5 * * * *', -- Every 5 minutes
    $cmd$select public.process_digital_human_requests()$cmd$
  );
end $$;

-- ==============================================================================
-- AI RESPONSE ORCHESTRATION (Added for robust digital human responses)
-- ==============================================================================

create table if not exists public.user_match_ai_state (
  match_id uuid primary key references public.user_matches(id) on delete cascade,
  
  -- Concurrency control
  ai_locked_until timestamptz,
  
  -- State tracking
  last_message_id uuid,          -- The most recent message in the convo
  last_message_at timestamptz,   -- When that message occurred (for debouncing)
  last_message_sender_id uuid,   -- Who sent it (to filter for USER messages)
  
  -- Progress tracking
  ai_last_processed_message_id uuid, -- The last message the AI has already responded to/ingested
  
  updated_at timestamptz default now()
);

alter table public.user_match_ai_state enable row level security;

create policy "Authenticated read ai state" on public.user_match_ai_state
  for select to authenticated using (true);

-- Trigger to auto-update state on new message
create or replace function public.handle_new_message_ai_state()
returns trigger
language plpgsql
security definer
as $$
begin
  -- Upsert into tracking table
  insert into public.user_match_ai_state (
    match_id, 
    last_message_id, 
    last_message_at, 
    last_message_sender_id,
    updated_at
  )
  values (
    new.match_id, 
    new.id, 
    new.created_at, 
    new.sender_id,
    now()
  )
  on conflict (match_id) do update
  set 
    last_message_id = excluded.last_message_id,
    last_message_at = excluded.last_message_at,
    last_message_sender_id = excluded.last_message_sender_id,
    updated_at = now();
    
  return new;
end;
$$;

drop trigger if exists on_message_created_update_ai_state on public.messages;
create trigger on_message_created_update_ai_state
after insert on public.messages
for each row
execute function public.handle_new_message_ai_state();

