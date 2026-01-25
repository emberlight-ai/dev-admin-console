
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

  -- Block enforcement: do not allow sending if either side blocked the other.
  if exists (
    select 1
    from public.blocks bl
    where (bl.blocker_id = final_sender and bl.blocked_id = final_receiver)
       or (bl.blocker_id = final_receiver and bl.blocked_id = final_sender)
  ) then
    raise exception 'cannot send message: blocked';
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

-- Trigger to auto-update state on new message
create or replace function public.handle_new_message_ai_state()
returns trigger
language plpgsql
security definer
as $$
declare
  sender_is_digital_human boolean;
begin
  select coalesce(u.is_digital_human, false) into sender_is_digital_human
  from public.users u
  where u.userid = new.sender_id;

  -- Upsert into tracking table
  insert into public.user_match_ai_state (
    match_id, 
    last_message_id, 
    last_message_at, 
    last_message_sender_id,
    ai_last_processed_message_id,
    scheduled_response_at,
    updated_at,
    ai_state
  )
  values (
    new.match_id, 
    new.id, 
    new.created_at, 
    new.sender_id,
    case when sender_is_digital_human then new.id else null end,
    null,
    now(),
    case 
       -- If sender is DH, state = 2 (DH Sent)
       when sender_is_digital_human then 2 
       -- If sender is User, state = 3 (User Sent)
       else 3 
    end
  )
  on conflict (match_id) do update
  set 
    last_message_id = excluded.last_message_id,
    last_message_at = excluded.last_message_at,
    last_message_sender_id = excluded.last_message_sender_id,
    -- If the latest message was sent by a digital human, mark it as already processed so
    -- auto-reply workers only react to real user messages.
    ai_last_processed_message_id = case
      when sender_is_digital_human then excluded.last_message_id
      else public.user_match_ai_state.ai_last_processed_message_id
    end,
    scheduled_response_at = case
      when sender_is_digital_human then null
      else public.user_match_ai_state.scheduled_response_at
    end,
    updated_at = now(),
    ai_state = excluded.ai_state;
    
  return new;
end;
$$;

drop trigger if exists on_message_created_update_ai_state on public.messages;
create trigger on_message_created_update_ai_state
after insert on public.messages
for each row
execute function public.handle_new_message_ai_state();

-- Trigger to ensure ai-state row exists as soon as a match is created (even before any messages)
create or replace function public.handle_new_match_ai_state()
returns trigger
language plpgsql
security definer
as $$
declare
  u_a uuid;
  u_b uuid;
  is_a_dh boolean;
  is_b_dh boolean;
  dh_id uuid;
  real_id uuid;
  dh_gender text;
  dh_personality text;
  should_greet boolean;
  initial_state integer;
begin
  u_a := new.user_a;
  u_b := new.user_b;
  
  -- Determine who is Digital Human
  select is_digital_human, gender, personality into is_a_dh, dh_gender, dh_personality from public.users where userid = u_a;
  select is_digital_human into is_b_dh from public.users where userid = u_b;
  
  if is_a_dh then
    dh_id := u_a;
    real_id := u_b;
  elsif is_b_dh then
    dh_id := u_b;
    real_id := u_a;
    select gender, personality into dh_gender, dh_personality from public.users where userid = u_b;
  else
    -- Both human or something else, default behavior (no DH logic)
    insert into public.user_match_ai_state (match_id, updated_at) values (new.id, now()) on conflict (match_id) do nothing;
    return new;
  end if;

  -- Check System Prompt for greeting config
  -- Fallback logic matches what is in TS scripts (Specific -> Generic -> False)
  select active_greeting_enabled into should_greet
  from public."SystemPrompts"
  where gender = coalesce(nullif(trim(dh_gender), ''), 'Female')
    and personality = coalesce(nullif(trim(dh_personality), ''), 'General')
  order by created_at desc
  limit 1;
  
  if should_greet is null then
    select active_greeting_enabled into should_greet
    from public."SystemPrompts"
    where gender = coalesce(nullif(trim(dh_gender), ''), 'Female')
      and personality = 'General'
    order by created_at desc
    limit 1;
  end if;
  
  -- If greeting enabled -> State 0 (Matched), waiting for greeting script
  -- If greeting disabled -> State 1 (Greeting "Sent"/Skipped), waiting for user to message first
  if coalesce(should_greet, false) then
    initial_state := 0;
  else
    initial_state := 1;
  end if;

  insert into public.user_match_ai_state (
    match_id,
    updated_at,
    dh_user_id,
    real_user_id,
    ai_state
  )
  values (
    new.id,
    now(),
    dh_id,
    real_id,
    initial_state
  )
  on conflict (match_id) do update
  set updated_at = now(),
      dh_user_id = excluded.dh_user_id,
      real_user_id = excluded.real_user_id,
      ai_state = excluded.ai_state;

  return new;
end;
$$;

drop trigger if exists on_user_match_created_init_ai_state on public.user_matches;
create trigger on_user_match_created_init_ai_state
after insert on public.user_matches
for each row
execute function public.handle_new_match_ai_state();
