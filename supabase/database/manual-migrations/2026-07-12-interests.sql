-- ═══════════════════════════════════════════════════════════════════════════
-- Interests & Explore categories
-- Applied: 2026-07-12 via Supabase MCP (project wvcwvjlmnjnvyblrycxj)
-- Canonical sources: database/functions/interests.sql + matches.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- Interests — the Explore-page category system.
--
--   interests       admin-managed catalog (key, display name, iOS asset).
--   user_interests  many-to-many: users (real AND digital humans) ↔ interests.
--                   Real users self-select (rpc_set_my_interests); DHs are
--                   assigned from /admin/digital-humans/[id] (service role).
--
-- Read model: interests are PUBLIC-ish profile data — every authenticated
-- user can read everyone's rows (they render as tags on match cards and feed
-- the Explore category counts). Writes only via the RPC (own rows) or the
-- service role.
--
-- Matching: rpc_get_matching_candidates (matches.sql) takes an optional
-- interest_filter text[] — NULL keeps the exact pre-interests behavior, so
-- old app builds and the un-parameterized web path are unaffected.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.interests (
  key        text primary key,
  name       text not null,
  asset      text not null default 'explore_gothic',   -- iOS asset name (placeholder art for now)
  sort_order integer not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.interests (key, name, asset, sort_order) values
  ('featured',    'Featured',     'explore_gothic', 0),
  ('travel',      'Travel',       'explore_gothic', 1),
  ('gothic',      'Gothic',       'explore_gothic', 2),
  ('music_lover', 'Music Lover',  'explore_gothic', 3),
  ('gamers',      'Gamers',       'explore_gothic', 4),
  ('long_term',   'Long Term',    'explore_gothic', 5),
  ('short_term',  'Short Term',   'explore_gothic', 6),
  ('fitness',     'Fitness',      'explore_gothic', 7),
  ('foodie',      'Foodie',       'explore_gothic', 8),
  ('animal',      'Animal Lover', 'explore_gothic', 9),
  ('diy',         'DIY',          'explore_gothic', 10),
  ('gardener',    'Gardener',     'explore_gothic', 11)
on conflict (key) do update
  set name = excluded.name, sort_order = excluded.sort_order;

create table if not exists public.user_interests (
  user_id      uuid not null references public.users(userid) on delete cascade,
  interest_key text not null references public.interests(key) on delete cascade,
  created_at   timestamptz not null default now(),
  primary key (user_id, interest_key)
);

create index if not exists user_interests_interest_idx
  on public.user_interests (interest_key);

alter table public.interests enable row level security;
alter table public.user_interests enable row level security;

drop policy if exists interests_read on public.interests;
create policy interests_read on public.interests
  for select to authenticated using (true);

drop policy if exists user_interests_read on public.user_interests;
create policy user_interests_read on public.user_interests
  for select to authenticated using (true);
-- No direct insert/update/delete policies: writes go through
-- rpc_set_my_interests (own rows) or the service role (admin).

-- Replace-all save of the caller's interests. Atomic, validates keys against
-- the active catalog, silently drops unknowns (a stale client after a catalog
-- rename shouldn't error the whole save).
create or replace function public.rpc_set_my_interests(p_keys text[])
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_saved text[];
begin
  if v_user is null then
    raise exception 'not authenticated';
  end if;

  delete from public.user_interests where user_id = v_user;

  insert into public.user_interests (user_id, interest_key)
  select distinct v_user, i.key
  from unnest(coalesce(p_keys, '{}')) as wanted(key)
  join public.interests i on i.key = wanted.key and i.active;

  select coalesce(array_agg(interest_key order by interest_key), '{}')
    into v_saved
  from public.user_interests
  where user_id = v_user;

  return v_saved;
end;
$$;

revoke execute on function public.rpc_set_my_interests(text[]) from public;
grant execute on function public.rpc_set_my_interests(text[]) to authenticated;

-- Explore-page counts: non-deleted members per interest (DHs included — they
-- ARE the discoverable pool).
create or replace function public.rpc_interest_counts()
returns table (interest_key text, user_count bigint)
language sql
security invoker
stable
as $$
  select ui.interest_key, count(*)::bigint
  from public.user_interests ui
  join public.users u on u.userid = ui.user_id
  where u.deleted_at is null
  group by ui.interest_key;
$$;

grant execute on function public.rpc_interest_counts() to authenticated;


-- ── rpc_get_matching_candidates: + interest_filter ──────────────────────────
-- interest_filter (optional): restrict the deck to users tagged with ANY of
-- the given interest keys (Explore category pages). NULL = original behavior,
-- so pre-interests clients are untouched. NOTE: adding a parameter changes the
-- function signature — drop the old one first (CREATE OR REPLACE can't).
drop function if exists public.rpc_get_matching_candidates(uuid, integer, text, boolean);

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
        interest_filter is null
        or cardinality(interest_filter) = 0
        or exists (
          select 1 from public.user_interests ui
          where ui.user_id = u.userid
            and ui.interest_key = any(interest_filter)
        )
      )
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
