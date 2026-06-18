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
  with green_mode_personalities as (
    select lower(btrim(green_value.personality)) as personality
    from public.digital_human_config cfg
    cross join lateral jsonb_array_elements_text(
      case
        when jsonb_typeof(cfg.value::jsonb) = 'array' then cfg.value::jsonb
        else '[]'::jsonb
      end
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
  and (
    direction <> 'inbound'
    or not coalesce(u.is_digital_human, false)
    or not exists (select 1 from green_mode_personalities)
    or lower(btrim(coalesce(u.personality, ''))) in (
      select personality from green_mode_personalities
    )
  )
  order by mr.created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 50);
$$;

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
  digital_human_gender text;
  target_real_user_gender text;
  real_user_id uuid;
  max_invites integer;
  min_user_age_minutes integer;
begin
  -- Get configuration for max invites per user
  select value::integer into max_invites from public.digital_human_config where key = 'max_invites_per_user';
  max_invites := coalesce(max_invites, 5);

  -- Avoid inviting users immediately after signup.
  select value::integer into min_user_age_minutes from public.digital_human_config where key = 'min_user_age_minutes_for_invites';
  min_user_age_minutes := greatest(coalesce(min_user_age_minutes, 10), 0);

  -- Determine how many to send: use p_limit if provided, otherwise fallback to config
  if p_limit is not null then
    invites_per_run := p_limit;
  else
    select value::integer into invites_per_run from public.digital_human_config where key = 'invites_per_cron_run';
    invites_per_run := coalesce(invites_per_run, 1);
  end if;

  -- Loop to send invites
  for i in 1..invites_per_run loop
    -- Select a random digital human
    select userid, lower(trim(gender)) into digital_human_id, digital_human_gender
    from public.users u
    where u.is_digital_human = true
    and u.deleted_at is null
    and lower(trim(coalesce(u.gender, ''))) in ('female', 'male')
    and (
      not exists (
        select 1
        from public.digital_human_config cfg
        cross join lateral jsonb_array_elements_text(
          case
            when jsonb_typeof(cfg.value::jsonb) = 'array' then cfg.value::jsonb
            else '[]'::jsonb
          end
        ) as green_value(personality)
        where cfg.key = 'green_mode_personalities'
          and nullif(btrim(green_value.personality), '') is not null
      )
      or lower(btrim(coalesce(u.personality, ''))) in (
        select lower(btrim(green_value.personality))
        from public.digital_human_config cfg
        cross join lateral jsonb_array_elements_text(
          case
            when jsonb_typeof(cfg.value::jsonb) = 'array' then cfg.value::jsonb
            else '[]'::jsonb
          end
        ) as green_value(personality)
        where cfg.key = 'green_mode_personalities'
          and nullif(btrim(green_value.personality), '') is not null
      )
    )
    order by random()
    limit 1;

    -- If no digital humans exist, exit
    if digital_human_id is null then
      exit;
    end if;

    target_real_user_gender := case
      when digital_human_gender = 'female' then 'male'
      when digital_human_gender = 'male' then 'female'
      else null
    end;

    if target_real_user_gender is null then
      continue;
    end if;

    -- Select a real user who:
    -- 1. Hasn't exceeded max invites
    -- 2. Doesn't already have a pending request with this digital human
    -- 3. Isn't already matched with this digital human
    -- 4. Isn't blocked by or blocking this digital human
    -- 5. Has the opposite gender for this digital human
    -- Prioritize older users first (newer users last) by ordering by created_at ASC
    select u.userid into real_user_id
    from public.users u
    left join public.digital_human_invites_tracking dt on dt.user_id = u.userid
    where u.is_digital_human = false
      and u.deleted_at is null
      and lower(trim(coalesce(u.gender, ''))) = target_real_user_gender
      and u.created_at <= now() - make_interval(mins => min_user_age_minutes)
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
