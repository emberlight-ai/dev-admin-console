-- ============================================================
-- Migration: rpc_get_matching_candidates uses users.whitelisted
-- ============================================================
-- Whitelist is now the admin-toggled users.whitelisted column (no hardcoded UUIDs,
-- no image-count derivation). Reverted to SECURITY INVOKER since users.whitelisted
-- is readable via the "Public read profiles" policy.

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
  with whitelisted_users(userid) as (
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
    select wc.* from whitelisted_candidates wc
    union all
    select ec.* from eligible_candidates ec
    where not exists (select 1 from whitelisted_candidates)
  )
  select candidate_pool.*
  from candidate_pool
  order by random()
  limit limit_count;
$$;
