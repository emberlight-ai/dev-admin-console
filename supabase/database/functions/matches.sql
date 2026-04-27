
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
  target_is_digital_human boolean;
  target_gender text;
  target_personality text;
  immediate_enabled boolean := false;
begin
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot match with self';
  end if;
  if exists (
    select 1
    from public.blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = target_user_id)
       or (b.blocker_id = target_user_id and b.blocked_id = auth.uid())
  ) then
    raise exception 'cannot match: one of the users has blocked the other';
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

  -- If target is a digital human and their SystemPrompt template enables immediate match,
  -- directly create the match (no pending request).
  select u.is_digital_human, u.gender, u.personality
    into target_is_digital_human, target_gender, target_personality
  from public.users u
  where u.userid = target_user_id
    and u.deleted_at is null
  limit 1;

  if coalesce(target_is_digital_human, false) then
    -- Resolve newest template for (gender, personality), fallback to (gender, 'General')
    select sp.immediate_match_enabled
      into immediate_enabled
    from public."SystemPrompts" sp
    where sp.gender = coalesce(nullif(trim(target_gender), ''), 'Female')
      and sp.personality = coalesce(nullif(trim(target_personality), ''), 'General')
    order by sp.created_at desc
    limit 1;

    if immediate_enabled is null then
      select sp.immediate_match_enabled
        into immediate_enabled
      from public."SystemPrompts" sp
      where sp.gender = coalesce(nullif(trim(target_gender), ''), 'Female')
        and sp.personality = 'General'
      order by sp.created_at desc
      limit 1;
    end if;

    if coalesce(immediate_enabled, false) then
      delete from public.match_requests
      where (from_user_id = auth.uid() and to_user_id = target_user_id)
         or (from_user_id = target_user_id and to_user_id = auth.uid());

      insert into public.user_matches (user_a, user_b)
      values (a, b)
      on conflict (user_a, user_b) do update set created_at = public.user_matches.created_at
      returning id into match_id;

      return match_id;
    end if;
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
  and not exists (
    select 1
    from public.blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = u.userid)
       or (b.blocker_id = u.userid and b.blocked_id = auth.uid())
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
  where (um.user_a = auth.uid() or um.user_b = auth.uid())
    and not exists (
      select 1
      from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = u.userid)
         or (b.blocker_id = u.userid and b.blocked_id = auth.uid())
    )
  order by um.created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 200);
$$;

-- RPC: Get matching candidates (filtering enabled digital humans)
create or replace function public.rpc_get_matching_candidates(
  viewer_user_id uuid,
  limit_count integer,
  gender_filter text default null,
  digital_humans_only boolean default false
)
returns setof public.users
language sql
security invoker
as $$
  select u.*
  from public.users u
  left join lateral (
    select sp.matching_enabled
    from public."SystemPrompts" sp
    where sp.gender = u.gender
      and sp.personality = u.personality
    order by sp.created_at desc
    limit 1
  ) sp_config on true
  where u.deleted_at is null
    and u.userid <> viewer_user_id
    and (nullif(btrim(gender_filter), '') is null or u.gender = btrim(gender_filter))
    and (not digital_humans_only or coalesce(u.is_digital_human, false) = true)
    and not exists (
      select 1
      from public.blocks b
      where (b.blocker_id = viewer_user_id and b.blocked_id = u.userid)
         or (b.blocker_id = u.userid and b.blocked_id = viewer_user_id)
    )
    and not exists (
      select 1
      from public.swipe s
      where s.swiper_user_id = viewer_user_id
        and s.target_user_id = u.userid
    )
    and (
      coalesce(u.is_digital_human, false) = false
      or
      coalesce(sp_config.matching_enabled, true) = true
    )
  order by u.created_at desc
  limit limit_count;
$$;

-- Digital Humans RPCs

-- 3. Function: Send match invites from digital humans to real users
create or replace function public.send_digital_human_invites(p_limit integer default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  invites_per_run integer;
  invites_sent integer := 0;
  digital_human_id uuid;
  real_user_id uuid;
  max_invites integer;
begin
  -- Get configuration for max invites per user
  select value::integer into max_invites from public.digital_human_config where key = 'max_invites_per_user';
  max_invites := coalesce(max_invites, 5);

  -- Determine how many to send: use p_limit if provided, otherwise fallback to config
  if p_limit is not null then
    invites_per_run := p_limit;
  else
    select value::integer into invites_per_run from public.digital_human_config where key = 'invites_per_cron_run';
    invites_per_run := coalesce(invites_per_run, 5);
  end if;
  
  -- Loop to send invites
  
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
create or replace function public.process_digital_human_requests(p_limit integer default 3)
returns table(accepted integer, rejected integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  accept_rate numeric;
  request_record record;
  accepted_count integer := 0;
  rejected_count integer := 0;
  a uuid;
  b uuid;
begin
  -- Get accept rate configuration
  select value::numeric into accept_rate from public.digital_human_config where key = 'accept_rate_percentage';
  accept_rate := coalesce(accept_rate, 30) / 100.0; -- Convert percentage to decimal
  
  -- Process up to p_limit pending requests where to_user_id is a digital human
  -- Random selection makes it more realistic (not all digital humans respond instantly)
  for request_record in
    select mr.id, mr.from_user_id, mr.to_user_id
    from public.match_requests mr
    join public.users u on u.userid = mr.to_user_id
    where u.is_digital_human = true
      and u.deleted_at is null
    order by random()
    limit p_limit
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
