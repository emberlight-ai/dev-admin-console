-- ============================================================
-- Migration: Mixed match-deck composition (no real users)
-- ============================================================
-- Previously the deck was effectively ALL whitelisted digital humans until they
-- ran out, which felt fake. Now the deck is digital-humans-only (no real users)
-- and split ~2/3 curated whitelisted DHs + ~1/3 random non-whitelisted DHs, with
-- each bucket backfilling from the other so the deck still fills to limit_count.

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
  -- The deck is digital-humans-only (no real users), and DHs are split so the
  -- deck doesn't feel like a wall of the same curated cards: ~2/3 whitelisted
  -- (image-rich, can send selfies) and ~1/3 random non-whitelisted DHs. Each
  -- bucket backfills from the other when short, so the deck still fills.
  dh_candidates as (
    select ec.*
    from eligible_candidates ec
    where coalesce(ec.is_digital_human, false) = true
  ),
  deck_size as (select greatest(coalesce(limit_count, 0), 0) as total),
  picked_whitelisted as (
    select dc.userid
    from dh_candidates dc
    where coalesce(dc.whitelisted, false) = true
    order by random()
    limit (select ceil(total * 2.0 / 3.0)::int from deck_size)
  ),
  picked_random as (
    select dc.userid
    from dh_candidates dc
    where coalesce(dc.whitelisted, false) = false
    order by random()
    limit greatest(
      (select total from deck_size) - (select count(*) from picked_whitelisted),
      0
    )
  ),
  chosen as (
    select userid from picked_whitelisted
    union
    select userid from picked_random
  ),
  backfill as (
    -- If both buckets came up short (e.g. few non-whitelisted DHs), top up from
    -- any remaining eligible DH so the deck still reaches limit_count.
    select dc.userid
    from dh_candidates dc
    where dc.userid not in (select userid from chosen)
    order by random()
    limit greatest((select total from deck_size) - (select count(*) from chosen), 0)
  ),
  final_ids as (
    select userid from chosen
    union
    select userid from backfill
  )
  select dc.*
  from dh_candidates dc
  join final_ids fi on fi.userid = dc.userid
  order by random()
  limit (select total from deck_size);
$$;
