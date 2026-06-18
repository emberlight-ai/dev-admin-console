insert into public.digital_human_config (key, value, description)
values (
  'green_mode_personalities',
  '[]',
  'When non-empty, matching feed candidates are limited to these personalities.'
)
on conflict (key) do nothing;

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
  ),
  whitelisted_users(userid) as (
    -- Admin-curated featured digital humans (users.whitelisted, toggled from the DH
    -- detail page). Shown first in the match deck. users.whitelisted is readable by
    -- the invoker via the "Public read profiles" policy, so no definer needed.
    select u.userid
    from public.users u
    where coalesce(u.whitelisted, false) = true
      and coalesce(u.is_digital_human, false) = true
      and u.deleted_at is null
  ),
  eligible_candidates as (
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
      and (
        not exists (select 1 from green_mode_personalities)
        or lower(btrim(coalesce(u.personality, ''))) in (
          select personality from green_mode_personalities
        )
      )
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
  ),
  whitelisted_candidates as (
    select ec.*
    from eligible_candidates ec
    join whitelisted_users wu on wu.userid = ec.userid
  ),
  candidate_pool as (
    -- Prefer image-rich digital humans (the whitelist above) so the cards users
    -- see can actually send selfies. Gender, block, digital-human, and swipe
    -- filters are applied before this, so only eligible image-rich cards appear.
    select wc.*
    from whitelisted_candidates wc

    union all

    -- Once every eligible image-rich card has been swiped/filtered out for this
    -- viewer, fall back to the normal randomized match-card pool.
    select ec.*
    from eligible_candidates ec
    where not exists (select 1 from whitelisted_candidates)
  )
  select candidate_pool.*
  from candidate_pool
  order by random()
  limit limit_count;
$$;
