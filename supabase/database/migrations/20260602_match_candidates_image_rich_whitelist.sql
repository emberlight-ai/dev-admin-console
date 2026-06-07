-- ============================================================
-- Migration: feature image-rich digital humans in the match deck
-- ============================================================
-- Replaces the hardcoded 15-UUID whitelist in rpc_get_matching_candidates with a
-- data-driven, self-maintaining one: digital humans that have >= 3 active chat
-- images are preferred at the top of the deck, so the cards users see can actually
-- send selfies (dh-auto-reply releases them as intimacy grows).
--
-- The function becomes SECURITY DEFINER so it can read dh_chat_images (RLS-locked
-- to the service role). Safe: it is param-driven (viewer_user_id), not auth.uid().

create or replace function public.rpc_get_matching_candidates(
  viewer_user_id uuid,
  limit_count integer,
  gender_filter text default null,
  digital_humans_only boolean default false
)
returns setof public.users
language sql
security definer
set search_path = public
as $$
  with whitelisted_users(userid) as (
    select i.dh_user_id
    from public.dh_chat_images i
    join public.users u on u.userid = i.dh_user_id
    where i.active
      and coalesce(u.is_digital_human, false) = true
      and u.deleted_at is null
    group by i.dh_user_id
    having count(*) >= 3
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
