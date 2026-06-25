-- ============================================================================
-- Nearby invitations: DHs the user just saw on the map reach out with a pending
-- match request + an opener message. It only becomes a match when the user
-- accepts (which seeds the conversation with the opener).
--
--   find-nearby-people  --schedule_nearby_invites-->  scheduled_dh_invites (queue)
--   pg_cron (~1 min)    --dh-nearby-dispatch (edge)-> match_requests(+greeting) + push
--   user accepts        --rpc_accept_match_request-> user_matches + first message
-- ============================================================================

-- 1. Opener carried by the pending invitation.
alter table public.match_requests
  add column if not exists greeting text,
  add column if not exists greeting_generated_at timestamptz;

-- 2. Staggered schedule queue (the only new state). Service-role only.
create table if not exists public.scheduled_dh_invites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(userid) on delete cascade,  -- real user (recipient)
  dh_user_id uuid not null references public.users(userid) on delete cascade,  -- who reaches out
  run_at     timestamptz not null,
  status     text not null default 'pending',   -- pending | processing | done | skipped
  created_at timestamptz not null default now()
);
create index if not exists scheduled_dh_invites_due_idx  on public.scheduled_dh_invites (status, run_at);
create index if not exists scheduled_dh_invites_user_idx on public.scheduled_dh_invites (user_id, created_at);
alter table public.scheduled_dh_invites enable row level security;  -- no policies: service-role only

-- 3. Config defaults (key is unique).
insert into public.digital_human_config (key, value) values
  ('enable_nearby_invites',            'true'),
  ('avg_invites_per_nearby_call',      '2'),
  ('max_invites_per_nearby_call',      '3'),
  ('nearby_invite_cooldown_seconds',   '1800'),
  ('nearby_invite_window_min_seconds', '60'),
  ('nearby_invite_window_max_seconds', '180'),
  ('nearby_opener_styles',
   '["keep it to 2-6 words","react to noticing they''re nearby","ask one tiny question","match the time of day","playful and casual","warm and low-key"]')
on conflict (key) do nothing;

-- 4. Scheduler — called by the find-nearby route with the DHs it just showed.
create or replace function public.schedule_nearby_invites(
  p_user_id uuid,
  p_dh_user_ids uuid[]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled         boolean;
  v_min_age_minutes integer;
  v_cooldown_secs   integer;
  v_avg             numeric;
  v_max             integer;
  v_win_min         integer;
  v_win_max         integer;
  v_user_created    timestamptz;
  v_eligible        uuid[];
  v_n               integer;
  v_count           integer := 0;
  v_dh              uuid;
  v_idx             integer := 0;
  v_span            numeric;
  v_offset          numeric;
begin
  if p_user_id is null or p_dh_user_ids is null or array_length(p_dh_user_ids, 1) is null then
    return 0;
  end if;

  select (value = 'true') into v_enabled from digital_human_config where key = 'enable_nearby_invites';
  if not coalesce(v_enabled, false) then return 0; end if;

  select value::integer into v_min_age_minutes from digital_human_config where key = 'min_user_age_minutes_for_invites';
  v_min_age_minutes := greatest(coalesce(v_min_age_minutes, 3), 0);
  select value::integer into v_cooldown_secs from digital_human_config where key = 'nearby_invite_cooldown_seconds';
  v_cooldown_secs := greatest(coalesce(v_cooldown_secs, 1800), 0);
  select value::numeric into v_avg from digital_human_config where key = 'avg_invites_per_nearby_call';
  v_avg := coalesce(v_avg, 2);
  select value::integer into v_max from digital_human_config where key = 'max_invites_per_nearby_call';
  v_max := greatest(coalesce(v_max, 3), 0);
  select value::integer into v_win_min from digital_human_config where key = 'nearby_invite_window_min_seconds';
  v_win_min := greatest(coalesce(v_win_min, 60), 1);
  select value::integer into v_win_max from digital_human_config where key = 'nearby_invite_window_max_seconds';
  v_win_max := greatest(coalesce(v_win_max, 180), v_win_min);

  -- recipient must be a real, non-deleted user old enough for invites
  select created_at into v_user_created
    from users where userid = p_user_id and is_digital_human = false and deleted_at is null;
  if v_user_created is null then return 0; end if;
  if v_user_created > now() - make_interval(mins => v_min_age_minutes) then return 0; end if;

  -- cooldown: one batch per window (avoids map-refresh spam) — the only state we read
  if exists (
    select 1 from scheduled_dh_invites
    where user_id = p_user_id and created_at > now() - make_interval(secs => v_cooldown_secs)
  ) then
    return 0;
  end if;

  -- eligible = provided DHs not already requested / matched / scheduled / blocked with this user
  select array_agg(u.userid) into v_eligible
  from users u
  where u.userid = any(p_dh_user_ids)
    and u.is_digital_human = true
    and u.deleted_at is null
    and not exists (
      select 1 from match_requests mr
      where (mr.from_user_id = u.userid and mr.to_user_id = p_user_id)
         or (mr.from_user_id = p_user_id and mr.to_user_id = u.userid))
    and not exists (
      select 1 from user_matches um
      where um.user_a = least(u.userid, p_user_id) and um.user_b = greatest(u.userid, p_user_id))
    and not exists (
      select 1 from scheduled_dh_invites s
      where s.user_id = p_user_id and s.dh_user_id = u.userid and s.status in ('pending','processing'))
    and not exists (
      select 1 from blocks b
      where (b.blocker_id = u.userid and b.blocked_id = p_user_id)
         or (b.blocker_id = p_user_id and b.blocked_id = u.userid));

  if v_eligible is null or array_length(v_eligible, 1) is null then return 0; end if;

  -- fluctuate around the average, clamp to [0, max] and to how many DHs we have
  v_n := round(v_avg + (random() * 2 - 1) * 0.75)::integer;
  v_n := greatest(0, least(v_n, v_max));
  v_n := least(v_n, array_length(v_eligible, 1));
  if v_n <= 0 then return 0; end if;

  -- spread n arrivals across [win_min, win_max] with jitter (organic, min-gapped)
  v_span := (v_win_max - v_win_min)::numeric;
  for v_dh in (select x from unnest(v_eligible) as t(x) order by random() limit v_n) loop
    v_offset := v_win_min + ((v_idx + random()) * v_span / v_n);
    insert into scheduled_dh_invites (user_id, dh_user_id, run_at)
    values (p_user_id, v_dh, now() + make_interval(secs => round(v_offset)::integer));
    v_idx   := v_idx + 1;
    v_count := v_count + 1;
  end loop;

  -- lifetime invitations received (drives the Me-page popularity tiers)
  insert into digital_human_invites_tracking (user_id, invite_count)
  values (p_user_id, v_count)
  on conflict (user_id) do update
    set invite_count = digital_human_invites_tracking.invite_count + v_count;

  return v_count;
end;
$$;

-- 5. Claim due rows atomically (the dispatcher generates the opener outside any lock).
create or replace function public.claim_due_nearby_invites(p_limit integer default 30)
returns setof public.scheduled_dh_invites
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.scheduled_dh_invites s
     set status = 'processing'
   where s.id in (
     select id from public.scheduled_dh_invites
      where status = 'pending' and run_at <= now()
      order by run_at
      for update skip locked
      limit greatest(coalesce(p_limit, 30), 1)
   )
   returning s.*;
end;
$$;

-- 6. Accept now seeds the conversation with the DH's opener.
create or replace function public.rpc_accept_match_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r        public.match_requests%rowtype;
  a        uuid;
  b        uuid;
  v_match_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into r from public.match_requests where id = request_id for update;
  if not found then
    raise exception 'match request not found';
  end if;
  if r.to_user_id <> auth.uid() then
    raise exception 'only recipient can accept';
  end if;

  delete from public.match_requests where id = request_id;

  a := least(r.from_user_id, r.to_user_id);
  b := greatest(r.from_user_id, r.to_user_id);
  insert into public.user_matches (user_a, user_b)
  values (a, b)
  on conflict (user_a, user_b) do update set created_at = public.user_matches.created_at
  returning id into v_match_id;

  -- Open the conversation with the DH's original opener (seeded in-txn so the async
  -- dh-greeting webhook sees a greeting already sent and no-ops).
  if v_match_id is not null and r.greeting is not null and length(btrim(r.greeting)) > 0 then
    insert into public.messages (match_id, sender_id, content)
    values (v_match_id, r.from_user_id, r.greeting);

    update public.user_match_ai_state
       set ai_greeting_sent    = true,
           ai_greeting_sent_at = now(),
           ai_state            = 1,
           ai_locked_until     = null
     where match_id = v_match_id;
  end if;
end;
$$;

-- 7. Surface the opener in the inbound-requests list (new OUT column → drop+recreate).
drop function if exists public.rpc_list_match_requests(text, integer, integer);
create function public.rpc_list_match_requests(
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
  other_avatar text,
  greeting text
)
language sql
security invoker
as $$
  with green_mode_personalities as (
    select lower(btrim(green_value.personality)) as personality
    from public.digital_human_config cfg
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(cfg.value::jsonb) = 'array' then cfg.value::jsonb else '[]'::jsonb end
    ) as green_value(personality)
    where cfg.key = 'green_mode_personalities'
      and nullif(btrim(green_value.personality), '') is not null
  )
  select
    mr.id as request_id,
    mr.from_user_id,
    mr.to_user_id,
    mr.created_at,
    u.userid as other_user_id,
    u.username as other_username,
    u.avatar as other_avatar,
    mr.greeting
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
    select 1 from public.blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = u.userid)
       or (b.blocker_id = u.userid and b.blocked_id = auth.uid())
  )
  and (
    direction <> 'inbound'
    or not coalesce(u.is_digital_human, false)
    or not exists (select 1 from green_mode_personalities)
    or lower(btrim(coalesce(u.personality, ''))) in (select personality from green_mode_personalities)
  )
  order by mr.created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 50);
$$;

-- 8. Stats for the Me-page popularity tiers + invitation count.
create or replace function public.rpc_get_my_invitation_stats()
returns table (lifetime_received integer, pending integer)
language sql
security invoker
as $$
  select
    coalesce((select t.invite_count from public.digital_human_invites_tracking t
              where t.user_id = auth.uid()), 0)::integer as lifetime_received,
    (select count(*)::integer from public.match_requests mr
      where mr.to_user_id = auth.uid()) as pending;
$$;

-- 9. Grants
revoke all on function public.schedule_nearby_invites(uuid, uuid[]) from public;
grant execute on function public.schedule_nearby_invites(uuid, uuid[]) to service_role;
revoke all on function public.claim_due_nearby_invites(integer) from public;
grant execute on function public.claim_due_nearby_invites(integer) to service_role;
grant execute on function public.rpc_list_match_requests(text, integer, integer) to anon, authenticated, service_role;
grant execute on function public.rpc_get_my_invitation_stats() to anon, authenticated, service_role;
