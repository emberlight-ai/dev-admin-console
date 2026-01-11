
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

-- ==============================================================================
-- BLOCKS
-- - Blocks are directional: blocker_id -> blocked_id.
-- - On block: remove pending requests and AI state; keep messages.
--   IMPORTANT: we DO NOT delete user_matches when messages exist because messages.match_id
--   has an ON DELETE CASCADE FK to user_matches(id). If there are no messages, we delete
--   the match row as a cleanup.
-- - On unblock: remove block row and ensure the two users are matched + have ai_state.
-- ==============================================================================

create or replace function public.rpc_block_user(
  target_user_id uuid
)
returns void
language plpgsql
security invoker
as $$
declare
  a uuid;
  b uuid;
  mid uuid;
  msg_cnt bigint := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot block self';
  end if;

  insert into public.blocks (blocker_id, blocked_id)
  values (auth.uid(), target_user_id)
  on conflict (blocker_id, blocked_id) do nothing;

  -- Remove any pending requests between the two users.
  delete from public.match_requests
  where (from_user_id = auth.uid() and to_user_id = target_user_id)
     or (from_user_id = target_user_id and to_user_id = auth.uid());

  -- Remove AI state for this pair's match (if any).
  a := least(auth.uid(), target_user_id);
  b := greatest(auth.uid(), target_user_id);
  select um.id into mid
  from public.user_matches um
  where um.user_a = a and um.user_b = b
  limit 1;

  if mid is not null then
    delete from public.user_match_ai_state
    where match_id = mid;

    select count(*) into msg_cnt
    from public.messages m
    where m.match_id = mid;

    -- Only delete the match if it has no messages (otherwise we'd cascade-delete messages).
    if coalesce(msg_cnt, 0) = 0 then
      delete from public.user_matches
      where id = mid;
    end if;
  end if;
end;
$$;

create or replace function public.rpc_unblock_user(
  target_user_id uuid
)
returns uuid
language plpgsql
security invoker
as $$
declare
  a uuid;
  b uuid;
  mid uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;
  if target_user_id = auth.uid() then
    raise exception 'cannot unblock self';
  end if;

  delete from public.blocks
  where blocker_id = auth.uid()
    and blocked_id = target_user_id;

  -- Restore / ensure a match exists between the two users.
  a := least(auth.uid(), target_user_id);
  b := greatest(auth.uid(), target_user_id);

  insert into public.user_matches (user_a, user_b)
  values (a, b)
  on conflict (user_a, user_b) do update
    set created_at = public.user_matches.created_at
  returning id into mid;

  -- Ensure the AI state row exists again (fresh state).
  insert into public.user_match_ai_state (match_id, updated_at)
  values (mid, now())
  on conflict (match_id) do update
  set updated_at = now();

  return mid;
end;
$$;

create or replace function public.rpc_get_blocking_list(
  start_index integer default 0,
  limit_count integer default 50
)
returns table (
  blocked_id uuid,
  blocked_username text,
  blocked_avatar text,
  created_at timestamptz
)
language sql
security invoker
as $$
  select
    b.blocked_id,
    u.username as blocked_username,
    u.avatar as blocked_avatar,
    b.created_at
  from public.blocks b
  join public.users u on u.userid = b.blocked_id
  where b.blocker_id = auth.uid()
  order by b.created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 200);
$$;
