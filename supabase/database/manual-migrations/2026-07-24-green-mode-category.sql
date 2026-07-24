-- 2026-07-24 · Green Mode as an admin-only category/interest + enabled switch
--
-- Green mode used to be a personality allowlist: digital_human_config.
-- green_mode_personalities (JSON array; non-empty = on), edited from the config
-- page's Matching tab. It is now — like Whitelist (2026-07-13) — a taggable
-- internal category plus an explicit switch:
--
--   • interest_categories('green_mode') + interests('green_mode'):
--     user_interests('green_mode') membership IS the green pool, curated from
--     /admin/categories (assign dialog) or /admin/digital-humans/[id] (Tags).
--   • digital_human_config('green_mode_enabled') = 'true' | 'false':
--     the switch, toggled on the Green Mode category card on /admin/categories.
--
-- When enabled, every matching surface (swipe deck + Explore decks via
-- rpc_get_matching_candidates, inbound invitation list via
-- rpc_list_match_requests, cron invites via send_digital_human_invites, boost
-- invites via schedule_boost_invites) only serves tagged DHs. Disabled = normal
-- matching, tags stay put.
--
-- Live state carries over: enabled iff the old set was non-empty, and every DH
-- whose personality was in the old set gets the tag. The old config row is then
-- deleted. Canonical function sources: database/functions/matches.sql.

-- 1. The category (kanban column; never an iOS Explore tile — active = false,
--    admin_only = true). sort_order -2 keeps it left of Whitelist (-1).
insert into interest_categories (key, name, asset, sort_order, active, admin_only)
values ('green_mode', 'Green Mode', 'explore_featured', -2, false, true)
on conflict (key) do update
  set name = excluded.name, admin_only = true;

-- 2. The interest (the taggable thing). active = true so the admin tagging UIs
--    list it; admin_only hides it from the iOS picker and match-card chips.
insert into interests (key, name, asset, sort_order, active, admin_only, category_key)
values ('green_mode', 'Green Mode', 'explore_featured', -2, true, true, 'green_mode')
on conflict (key) do update
  set name = excluded.name, admin_only = true, category_key = 'green_mode', active = true;

-- 3. The switch, seeded from the old personality set (non-empty = on) so the
--    live behavior doesn't flip during the migration.
insert into digital_human_config (key, value, description)
select
  'green_mode_enabled',
  case when exists (
    select 1 from digital_human_config cfg
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(cfg.value::jsonb) = 'array' then cfg.value::jsonb else '[]'::jsonb end
    ) as green_value(personality)
    where cfg.key = 'green_mode_personalities'
      and nullif(btrim(green_value.personality), '') is not null
  ) then 'true' else 'false' end,
  'When true, matching surfaces (deck, invitations, boosts) only serve digital humans tagged Green Mode.'
on conflict (key) do nothing;

-- 4. Backfill: every live DH whose personality was in the old set gets the tag.
insert into user_interests (user_id, interest_key)
select u.userid, 'green_mode'
from users u
where u.is_digital_human = true
  and u.deleted_at is null
  and lower(btrim(coalesce(u.personality, ''))) in (
    select lower(btrim(green_value.personality))
    from digital_human_config cfg
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(cfg.value::jsonb) = 'array' then cfg.value::jsonb else '[]'::jsonb end
    ) as green_value(personality)
    where cfg.key = 'green_mode_personalities'
      and nullif(btrim(green_value.personality), '') is not null
  )
on conflict (user_id, interest_key) do nothing;

-- 5. Old key retired (all readers below now consult green_mode_enabled + tag).
delete from digital_human_config where key = 'green_mode_personalities';

-- 6. rpc_list_match_requests — hide inbound invitations from untagged DHs.
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
  other_avatar text,
  greeting text
)
language sql
security invoker
as $$
  -- Green mode: a config switch + the user_interests('green_mode') tag. When
  -- enabled, inbound DH invitations from untagged DHs are hidden (not deleted).
  with green_mode as (
    select coalesce((
      select lower(btrim(cfg.value)) = 'true'
      from public.digital_human_config cfg
      where cfg.key = 'green_mode_enabled'
      limit 1
    ), false) as enabled
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
    select 1
    from public.blocks b
    where (b.blocker_id = auth.uid() and b.blocked_id = u.userid)
       or (b.blocker_id = u.userid and b.blocked_id = auth.uid())
  )
  and (
    direction <> 'inbound'
    or not coalesce(u.is_digital_human, false)
    or not (select enabled from green_mode)
    or exists (
      select 1 from public.user_interests ui
      where ui.user_id = u.userid and ui.interest_key = 'green_mode'
    )
  )
  order by mr.created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 50);
$$;


-- 7. rpc_get_matching_candidates — deck + Explore decks serve only tagged DHs.
create or replace function public.rpc_get_matching_candidates(
  viewer_user_id uuid,
  limit_count integer,
  gender_filter text default null,
  digital_humans_only boolean default false,
  interest_filter text[] default null
)
returns setof public.users
language sql
security invoker
as $$
  -- Green mode: a config switch + the user_interests('green_mode') tag,
  -- curated on /admin/categories. When enabled, only tagged DHs are served.
  with green_mode as (
    select coalesce((
      select lower(btrim(cfg.value)) = 'true'
      from public.digital_human_config cfg
      where cfg.key = 'green_mode_enabled'
      limit 1
    ), false) as enabled
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
        interest_filter is null
        or cardinality(interest_filter) = 0
        or exists (
          select 1 from public.user_interests ui
          where ui.user_id = u.userid
            and ui.interest_key = any(interest_filter)
        )
      )
      and (
        not (select enabled from green_mode)
        or exists (
          select 1 from public.user_interests ui
          where ui.user_id = u.userid and ui.interest_key = 'green_mode'
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
  -- deck doesn't feel like a wall of the same curated cards: a configurable share
  -- whitelisted (image-rich, can send selfies) and the rest random non-whitelisted
  -- DHs. The split is driven by the `whitelisted_deck_ratio` config key (a 0-100
  -- percentage, default 90) editable from the admin System Prompts page. Each
  -- bucket backfills from the other when short, so the deck still fills.
  dh_candidates as (
    select ec.*
    from eligible_candidates ec
    where coalesce(ec.is_digital_human, false) = true
  ),
  deck_size as (select greatest(coalesce(limit_count, 0), 0) as total),
  -- Percentage of the deck reserved for whitelisted DHs. Defensive: only casts a
  -- well-formed number (else falls back to 90) and clamps to [0,100], so a bad
  -- config value can never break the matching path.
  deck_config as (
    select least(greatest(
      coalesce(
        (select case
                  when btrim(value) ~ '^[0-9]+(\.[0-9]+)?$' then btrim(value)::numeric
                  else null
                end
         from public.digital_human_config
         where key = 'whitelisted_deck_ratio'
         limit 1),
        90
      ),
      0), 100) as whitelisted_pct
  ),
  picked_whitelisted as (
    select dc.userid
    from dh_candidates dc
    where coalesce(dc.whitelisted, false) = true
    order by random()
    limit (
      select ceil(total * (select whitelisted_pct from deck_config) / 100.0)::int
      from deck_size
    )
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

-- 8. send_digital_human_invites — only tagged DHs send cron invites.
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
    -- Green mode: when enabled, only DHs tagged 'green_mode' send invites.
    and (
      not coalesce((
        select lower(btrim(cfg.value)) = 'true'
        from public.digital_human_config cfg
        where cfg.key = 'green_mode_enabled'
        limit 1
      ), false)
      or exists (
        select 1 from public.user_interests ui
        where ui.user_id = u.userid and ui.interest_key = 'green_mode'
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
    
    -- Create the match directly so the DH greets first (no pending "like" to accept).
    -- This fires the same AFTER INSERT triggers as rpc_accept_match_request:
    -- on_user_match_created_init_ai_state (seeds ai_state) and
    -- on_user_match_created_notify_dh_greeting (sends the opener via dh-greeting).
    insert into public.user_matches (user_a, user_b)
    values (least(digital_human_id, real_user_id), greatest(digital_human_id, real_user_id))
    on conflict (user_a, user_b) do nothing;
    
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

-- 9. schedule_boost_invites — boost likes only come from tagged DHs.
create or replace function public.schedule_boost_invites(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled      boolean;
  v_total        integer;
  v_interval_s   integer;
  v_pref_gender  text;
  v_eligible     uuid[];
  v_dh           uuid;
  v_idx          integer := 0;
  v_count        integer := 0;
begin
  if p_user_id is null then return 0; end if;

  select (value = 'true') into v_enabled from digital_human_config where key = 'enable_boost_invites';
  if not coalesce(v_enabled, true) then return 0; end if;

  select value::integer into v_total from digital_human_config where key = 'boost_invites_total';
  v_total := greatest(coalesce(v_total, 7), 0);
  select value::integer into v_interval_s from digital_human_config where key = 'boost_invite_interval_seconds';
  v_interval_s := greatest(coalesce(v_interval_s, 120), 10);

  if v_total <= 0 then return 0; end if;

  if not exists (
    select 1 from users where userid = p_user_id and is_digital_human = false and deleted_at is null
  ) then
    return 0;
  end if;

  -- Who should like them? Infer the user's preferred gender from their own
  -- like history; fall back to the opposite of their gender; else any.
  -- (Check female/woman FIRST everywhere: 'female' contains 'male' and
  -- 'woman' contains 'man', so the male branch must come second.)
  select case
           when lower(coalesce(tu.gender, '')) like '%female%' or lower(coalesce(tu.gender, '')) like '%woman%' then 'female'
           when lower(coalesce(tu.gender, '')) like '%male%' or lower(coalesce(tu.gender, '')) like '%man%' then 'male'
         end
    into v_pref_gender
  from swipe s
  join users tu on tu.userid = s.target_user_id
  where s.swiper_user_id = p_user_id and s.reaction = 'like'
    -- Only targets with a recognizable gender ('%male%' also matches 'female',
    -- '%man%' also matches 'woman' — together they cover all four tokens).
    and (lower(coalesce(tu.gender, '')) like '%male%' or lower(coalesce(tu.gender, '')) like '%man%')
  group by 1
  order by count(*) desc
  limit 1;

  if v_pref_gender is null then
    select case
             when lower(coalesce(gender, '')) like '%female%' or lower(coalesce(gender, '')) like '%woman%' then 'male'
             when lower(coalesce(gender, '')) like '%male%' or lower(coalesce(gender, '')) like '%man%' then 'female'
           end
      into v_pref_gender
    from users where userid = p_user_id;
  end if;

  -- Eligible DHs: green mode respected, preferred gender when known,
  -- whitelisted (curated, image-rich) profiles first — these are the cards the
  -- user will actually SEE on the Likes page. Same dedup as nearby invites.
  with green_mode as (
    select coalesce((
      select lower(btrim(cfg.value)) = 'true'
      from digital_human_config cfg
      where cfg.key = 'green_mode_enabled'
      limit 1
    ), false) as enabled
  ),
  candidates as (
    select u.userid, u.whitelisted
    from users u
    where u.is_digital_human = true
      and u.deleted_at is null
      and u.avatar is not null
      and (
        not (select enabled from green_mode)
        or exists (
          select 1 from user_interests ui
          where ui.user_id = u.userid and ui.interest_key = 'green_mode'
        )
      )
      and (
        v_pref_gender is null
        or (v_pref_gender = 'female' and (lower(coalesce(u.gender, '')) like '%female%' or lower(coalesce(u.gender, '')) like '%woman%'))
        or (v_pref_gender = 'male'
            and (lower(coalesce(u.gender, '')) like '%male%' or lower(coalesce(u.gender, '')) like '%man%')
            and not (lower(coalesce(u.gender, '')) like '%female%' or lower(coalesce(u.gender, '')) like '%woman%'))
      )
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
           or (b.blocker_id = p_user_id and b.blocked_id = u.userid))
  )
  select array_agg(userid) into v_eligible
  from (
    select userid from candidates
    order by whitelisted desc, random()
    limit v_total
  ) picked;

  if v_eligible is null or array_length(v_eligible, 1) is null then return 0; end if;

  -- One like per interval: first at +interval, then steadily (±15s jitter so
  -- arrivals don't feel metronomic).
  foreach v_dh in array v_eligible loop
    insert into scheduled_dh_invites (user_id, dh_user_id, run_at)
    values (
      p_user_id,
      v_dh,
      now() + make_interval(secs => (v_idx + 1) * v_interval_s + round((random() * 30 - 15))::integer)
    );
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
