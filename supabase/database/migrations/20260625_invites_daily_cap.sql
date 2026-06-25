-- Cap nearby invitations to at most `max_invites_per_day` (rolling 24h) per user, so
-- a user who opens the map repeatedly doesn't accumulate an unrealistic pile of invites.

insert into public.digital_human_config (key, value) values ('max_invites_per_day', '3')
on conflict (key) do nothing;

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
  v_cap_per_day     integer;
  v_used_today      integer;
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
  select value::integer into v_cap_per_day from digital_human_config where key = 'max_invites_per_day';
  v_cap_per_day := greatest(coalesce(v_cap_per_day, 3), 0);
  select value::integer into v_win_min from digital_human_config where key = 'nearby_invite_window_min_seconds';
  v_win_min := greatest(coalesce(v_win_min, 60), 1);
  select value::integer into v_win_max from digital_human_config where key = 'nearby_invite_window_max_seconds';
  v_win_max := greatest(coalesce(v_win_max, 180), v_win_min);

  select created_at into v_user_created
    from users where userid = p_user_id and is_digital_human = false and deleted_at is null;
  if v_user_created is null then return 0; end if;
  if v_user_created > now() - make_interval(mins => v_min_age_minutes) then return 0; end if;

  -- Daily cap: no more than max_invites_per_day actual invitations in any rolling 24h.
  -- ('skipped' rows never became an invitation, so they don't count.)
  select count(*) into v_used_today
  from scheduled_dh_invites
  where user_id = p_user_id
    and status <> 'skipped'
    and created_at > now() - interval '24 hours';
  if v_used_today >= v_cap_per_day then
    return 0;
  end if;

  -- cooldown: one batch per window (avoids map-refresh spam)
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

  -- fluctuate around the average, clamp to [0, max], to eligible count, and to the day's remaining quota
  v_n := round(v_avg + (random() * 2 - 1) * 0.75)::integer;
  v_n := greatest(0, least(v_n, v_max));
  v_n := least(v_n, array_length(v_eligible, 1));
  v_n := least(v_n, greatest(v_cap_per_day - v_used_today, 0));
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

  insert into digital_human_invites_tracking (user_id, invite_count)
  values (p_user_id, v_count)
  on conflict (user_id) do update
    set invite_count = digital_human_invites_tracking.invite_count + v_count;

  return v_count;
end;
$$;
