-- 1. Messages policies (as before)
drop policy if exists "Participants can read messages" on public.messages;
drop policy if exists "Participants can send messages" on public.messages;
drop policy if exists "Authenticated can read all messages" on public.messages;
drop policy if exists "Authenticated can send messages" on public.messages;
drop policy if exists "Public can read all messages" on public.messages;
drop policy if exists "Public can send messages" on public.messages;

-- Allow Anon + Authenticated to read/write for Admin Debugger MVP
create policy "Public can read all messages" on public.messages
  for select
  to public
  using (true);

create policy "Public can send messages" on public.messages
  for insert
  to public
  with check (true);

-- 2. User Matches policies (loosen for Admin/Debug)
drop policy if exists user_matches_select_participants on public.user_matches;
drop policy if exists "Authenticated can read all matches" on public.user_matches;
drop policy if exists "Public can read all matches" on public.user_matches;

create policy "Public can read all matches" on public.user_matches
  for select
  to public
  using (true);

-- 3. Match Requests policies (loosen for Admin/Debug)
drop policy if exists match_requests_select_participants on public.match_requests;
drop policy if exists "Authenticated can read all match requests" on public.match_requests;
drop policy if exists "Public can read all match requests" on public.match_requests;

create policy "Public can read all match requests" on public.match_requests
  for select
  to public
  using (true);

-- 4. Users (Profiles)
-- Ensure public can read profiles for the dropdowns to work fully even if not logged in
drop policy if exists users_read_authenticated on public.users;
drop policy if exists "Public read profiles" on public.users;

create policy "Public read profiles" on public.users
  for select
  to public
  using (deleted_at is null);

-- 5. Update RPCs to remove participant checks
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

create or replace function public.rpc_send_message(
  match_id uuid,
  content text default null,
  media_url text default null
)
returns public.messages
language plpgsql
security invoker
as $$
declare
  msg public.messages;
begin
  if match_id is null then
    raise exception 'match_id is required';
  end if;
  if content is null and media_url is null then
    raise exception 'content or media_url is required';
  end if;

  -- Simplified MVP: No check for participant status
  -- Just insert the message (sender_id will be auth.uid() or null if anon, so we might need to trust the client to pass it? 
  -- actually auth.uid() is null for anon. 
  -- For the Admin Debugger "User A", we can't easily spoof auth.uid() without a service role or signing a token.
  -- 
  -- UPDATE: Since we are using this for MVP/Admin, we will rely on the CLIENT to pass the sender_id in the RPC?
  -- No, the table has sender_id.
  -- 
  -- If we use RPC, it inserts `values (..., auth.uid(), ...)` which is NULL for anon.
  -- We should update the RPC to ACCEPT a sender_id for debugging purposes, or default to auth.uid().
  
  insert into public.messages (match_id, sender_id, content, media_url)
  values (
    match_id, 
    coalesce(auth.uid(), (select user_a from public.user_matches where id = match_id)), -- Fallback for Anon Debugging: just pick one? No that's bad.
    -- Better: The RPC relies on auth.uid(). If you are Anon, you cannot "send" as someone else via this RPC.
    -- 
    -- FIX: For the Admin tool to work as "User A", we really need to impersonate.
    -- But since we can't easily sign tokens here, let's allow passing sender_id in the RPC *if* the user is Anon? 
    -- Or just update the RPC to accept sender_id explicitly.
    content, 
    media_url
  )
  returning * into msg;

  return msg;
end;
$$;

-- REDEFINE RPC to accept sender_id (for Admin/Debug flexibility)
-- NOTE: In production, you'd want to revert this to enforce auth.uid()!
create or replace function public.rpc_send_message(
  match_id uuid,
  content text default null,
  media_url text default null,
  sender_id uuid default null -- Optional override
)
returns public.messages
language plpgsql
security invoker
as $$
declare
  msg public.messages;
  final_sender uuid;
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

  insert into public.messages (match_id, sender_id, content, media_url)
  values (match_id, final_sender, content, media_url)
  returning * into msg;

  return msg;
end;
$$;
