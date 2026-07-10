-- User-centric chat-traffic reporting for /admin/matching/traffic.
-- Both are read-only, security definer, service-role only (admin API) — server-
-- side aggregation so the dashboard fetches grouped rows instead of paging the
-- messages table. "Traffic" = real-user activity in AI conversations.

-- Per real user: their activity within [p_from, p_to) — messages they sent, AI
-- replies received, distinct DH conversations, last activity, cooldown state.
create or replace function public.rpc_admin_user_traffic(
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  user_id uuid,
  username text,
  avatar text,
  user_messages bigint,
  dh_replies bigint,
  active_conversations bigint,
  last_active timestamptz,
  in_cooldown boolean
)
language sql
security definer
set search_path = public
stable
as $$
  with win as (
    select m.match_id, m.sender_id, m.created_at, s.dh_user_id, s.real_user_id
    from public.messages m
    join public.user_match_ai_state s on s.match_id = m.match_id
    where m.created_at >= p_from and m.created_at < p_to
  )
  select
    w.real_user_id as user_id,
    u.username,
    u.avatar,
    count(*) filter (where w.sender_id = w.real_user_id)::bigint as user_messages,
    count(*) filter (where w.sender_id = w.dh_user_id)::bigint  as dh_replies,
    count(distinct w.match_id)::bigint as active_conversations,
    max(w.created_at) as last_active,
    coalesce(c.active, false) as in_cooldown
  from win w
  join public.users u on u.userid = w.real_user_id
  left join public.user_cooldown c on c.user_id = w.real_user_id
  where u.is_digital_human = false
  group by w.real_user_id, u.username, u.avatar, c.active
  order by count(*) filter (where w.sender_id = w.real_user_id) desc, max(w.created_at) desc;
$$;

revoke execute on function public.rpc_admin_user_traffic(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.rpc_admin_user_traffic(timestamptz, timestamptz) to service_role;

-- Busiest conversations within the window (user <-> DH), for the secondary table.
create or replace function public.rpc_admin_traffic_conversations(
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer default 12
)
returns table (
  match_id uuid,
  real_user_id uuid,
  real_username text,
  real_avatar text,
  dh_user_id uuid,
  dh_username text,
  dh_personality text,
  user_messages bigint,
  dh_replies bigint,
  total_messages bigint,
  last_message_at timestamptz,
  last_message_content text
)
language sql
security definer
set search_path = public
stable
as $$
  with win as (
    select m.match_id, m.sender_id, m.created_at, s.dh_user_id, s.real_user_id
    from public.messages m
    join public.user_match_ai_state s on s.match_id = m.match_id
    where m.created_at >= p_from and m.created_at < p_to
  ),
  agg as (
    select
      w.match_id, w.real_user_id, w.dh_user_id,
      count(*) filter (where w.sender_id = w.real_user_id)::bigint as user_messages,
      count(*) filter (where w.sender_id = w.dh_user_id)::bigint  as dh_replies,
      count(*)::bigint as total_messages,
      max(w.created_at) as last_message_at
    from win w
    group by w.match_id, w.real_user_id, w.dh_user_id
    order by count(*) desc
    limit greatest(p_limit, 0)
  )
  select
    a.match_id,
    a.real_user_id, ru.username as real_username, ru.avatar as real_avatar,
    a.dh_user_id, du.username as dh_username, du.personality as dh_personality,
    a.user_messages, a.dh_replies, a.total_messages, a.last_message_at,
    (select lm.content from public.messages lm
       where lm.match_id = a.match_id order by lm.created_at desc limit 1) as last_message_content
  from agg a
  join public.users ru on ru.userid = a.real_user_id
  join public.users du on du.userid = a.dh_user_id
  order by a.total_messages desc;
$$;

revoke execute on function public.rpc_admin_traffic_conversations(timestamptz, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.rpc_admin_traffic_conversations(timestamptz, timestamptz, integer) to service_role;
