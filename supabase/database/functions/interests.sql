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
  asset      text not null default 'explore_gothic',   -- iOS asset name (must match a bundled imageset)
  sort_order integer not null default 0,
  active     boolean not null default true,
  -- Admin-only interests (e.g. 'featured') render on Explore like any other,
  -- but rpc_set_my_interests refuses them — only the service role assigns
  -- members (curated categories).
  admin_only boolean not null default false,
  created_at timestamptz not null default now()
);

-- asset is code-coupled (bundled iOS imageset names, case-sensitive) — the
-- upsert keeps it in sync with this seed. Prod synced 2026-07-12.
insert into public.interests (key, name, asset, sort_order, admin_only) values
  ('featured',    'Featured',     'explore_featured',     0, true)
on conflict (key) do update
  set name = excluded.name, asset = excluded.asset,
      sort_order = excluded.sort_order, admin_only = excluded.admin_only;

insert into public.interests (key, name, asset, sort_order) values
  ('travel',      'Travel',       'explore_travel',       1),
  ('gothic',      'Gothic',       'explore_gothic',       2),
  ('music_lover', 'Music Lover',  'explore_music_lover',  3),
  ('gamers',      'Gamers',       'explore_gamers',       4),
  ('long_term',   'Long Term',    'explore_long_term',    5),
  ('short_term',  'Short Term',   'explore_short_term',   6),
  ('fitness',     'Fitness',      'explore_fitness',      7),
  ('foodie',      'Foodie',       'explore_foodie',       8),
  ('animal',      'Animal Lover', 'explore_animal_lover', 9),
  ('diy',         'DIY',          'explore_diy',          10),
  ('gardener',    'Gardener',     'explore_gardener',     11)
on conflict (key) do update
  set name = excluded.name, asset = excluded.asset, sort_order = excluded.sort_order;

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

-- Replace-all save of the caller's SELF-SELECTABLE interests. Atomic,
-- validates keys against the active catalog, silently drops unknowns and
-- admin-only keys (a tampered client can't add itself to 'featured');
-- admin-granted admin-only memberships survive the replace.
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

  -- Preserve any admin-granted admin-only memberships across the replace-all.
  delete from public.user_interests ui
  using public.interests i
  where ui.user_id = v_user
    and i.key = ui.interest_key
    and not i.admin_only;

  insert into public.user_interests (user_id, interest_key)
  select distinct v_user, i.key
  from unnest(coalesce(p_keys, '{}')) as wanted(key)
  join public.interests i on i.key = wanted.key and i.active and not i.admin_only
  on conflict (user_id, interest_key) do nothing;

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
