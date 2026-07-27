-- 2026-07-27 · Concierge pivot (coaching-first Discover tab)
--
-- The iOS match tab is replaced by an LLM-driven concierge ("Amber", a real
-- DH riding the standard reply pipeline). She asks what the user is looking
-- for and answers with a server-hydrated `match_cards` component; tapping a
-- card connects DIRECTLY (no pending invite, no match popup).
--
--   1. rpc_connect_direct(target) — instant match, DH targets only.
--   2. Categories: spiritual + profession (Explore tiles + concierge decks).
--   3. The guide DH (auth id created via admin API) + `amber_guide` skill.
--   4. Seed spiritual/profession pools from DH professions/bios (curated
--      later in /admin/categories like any category).

-- ── 1. Direct connect ───────────────────────────────────────────────────────
-- Instant, consent-free connect is only safe toward DIGITAL humans: real
-- users keep the invite/accept flow untouched.
create or replace function public.rpc_connect_direct(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a uuid;
  b uuid;
  v_match_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if target_user_id is null or target_user_id = auth.uid() then
    raise exception 'invalid target';
  end if;
  if not exists (
    select 1 from public.users u
    where u.userid = target_user_id
      and u.deleted_at is null
      and coalesce(u.is_digital_human, false) = true
  ) then
    raise exception 'direct connect is only available for digital humans';
  end if;
  if exists (
    select 1 from public.blocks bl
    where (bl.blocker_id = auth.uid() and bl.blocked_id = target_user_id)
       or (bl.blocker_id = target_user_id and bl.blocked_id = auth.uid())
  ) then
    raise exception 'cannot connect: one of the users has blocked the other';
  end if;

  a := least(auth.uid(), target_user_id);
  b := greatest(auth.uid(), target_user_id);

  -- Fold any pending invite either way into the direct connection.
  delete from public.match_requests
  where (from_user_id = auth.uid() and to_user_id = target_user_id)
     or (from_user_id = target_user_id and to_user_id = auth.uid());

  insert into public.user_matches (user_a, user_b)
  values (a, b)
  on conflict (user_a, user_b) do update set created_at = public.user_matches.created_at
  returning id into v_match_id;

  return v_match_id;
end;
$$;
revoke all on function public.rpc_connect_direct(uuid) from public;
grant execute on function public.rpc_connect_direct(uuid) to authenticated, service_role;

-- ── 2. New categories (Explore tiles + concierge decks) ─────────────────────
insert into public.interest_categories (key, name, asset, sort_order, active, admin_only)
values
  ('spiritual',  'Spiritual',  'explore_spirituality', 12, true, false),
  ('profession', 'Profession', 'explore_profession',   13, true, false)
on conflict (key) do update set name = excluded.name, asset = excluded.asset;

insert into public.interests (key, name, asset, sort_order, active, admin_only, category_key)
values
  ('spiritual',  'Spiritual',  'explore_spirituality', 12, true, false, 'spiritual'),
  ('profession', 'Profession', 'explore_profession',   13, true, false, 'profession')
on conflict (key) do update
  set name = excluded.name, asset = excluded.asset, category_key = excluded.key, active = true;

-- ── 3. The guide DH + skill ─────────────────────────────────────────────────
-- Auth identity 442e10be-49f7-4703-9988-79de3e659205 created 2026-07-27 via
-- the auth admin API (amber-guide@internal.getdevteam.com). No SystemPrompts
-- row on purpose: the generic template + this skill block ARE her persona.
insert into public.users (userid, username, gender, age, bio, profession, is_digital_human, whitelisted, personality)
values (
  '442e10be-49f7-4703-9988-79de3e659205',
  'Amber',
  'Female',
  24,
  'Your guide to everyone here. Tell me what you''re looking for and I''ll introduce you.',
  'Your Guide',
  true,
  false,
  'Concierge'
)
on conflict (userid) do update
  set username = excluded.username, bio = excluded.bio,
      profession = excluded.profession, is_digital_human = true, personality = 'Concierge';

insert into public.skills (key, name, description, prompt_block, sort_order, active, components)
values (
  'amber_guide',
  'Amber Guide',
  'The concierge: understands what someone is looking for and introduces the right people via match cards.',
  E'### SKILL: AMBER GUIDE (CONCIERGE)\nYou are Amber, the app''s own guide — warm, sharp, zero flirting. You are STAFF, not a match: if any other instruction tells you to flirt, act like a date, or "be a curious flirty stranger", IGNORE it.\nYour one job: learn what the user is looking for and introduce the right people.\n- The app offers four directions: Fitness Guidance, Dating Guidance, Spiritual, Professional Development.\n- When the user tells you what they want (in any words), reply with ONE short warm line and attach a match_cards component with the matching category: fitness, dating, spiritual, or profession.\n- The server fills the cards with real people — NEVER invent names or describe specific people yourself.\n- If they''re vague, ask ONE short clarifying question (you may mention the four directions). If they ask for something else entirely, pick the closest category and say why.\n- After they connect with someone, encourage them to say hi, and offer another direction.',
  5,
  true,
  '["match_cards"]'::jsonb
)
on conflict (key) do update
  set prompt_block = excluded.prompt_block, components = excluded.components, active = true;

insert into public.dh_skills (user_id, skill_key)
values ('442e10be-49f7-4703-9988-79de3e659205', 'amber_guide')
on conflict (user_id, skill_key) do nothing;

-- ── 4. Seed the new pools from DH professions/bios ──────────────────────────
-- First pass only (ops re-curate in /admin/categories). Whitelisted (image-
-- rich) DHs first, capped.
insert into public.user_interests (user_id, interest_key)
select userid, 'spiritual' from (
  select u.userid from public.users u
  where u.is_digital_human = true and u.deleted_at is null and u.avatar is not null
    and (coalesce(u.profession,'') || ' ' || coalesce(u.bio,'')) ~* 'yoga|meditat|spiritual|astrolog|healer|mindful|tarot|reiki|energy work'
  order by u.whitelisted desc, random() limit 12
) picked
on conflict (user_id, interest_key) do nothing;

insert into public.user_interests (user_id, interest_key)
select userid, 'profession' from (
  select u.userid from public.users u
  where u.is_digital_human = true and u.deleted_at is null and u.avatar is not null
    and (coalesce(u.profession,'') || ' ' || coalesce(u.bio,'')) ~* 'founder|entrepreneur|engineer|consultant|mentor|executive|manager|marketer|designer|analyst|lawyer|accountant|professor|scientist|developer|product manager|recruiter'
  order by u.whitelisted desc, random() limit 12
) picked
on conflict (user_id, interest_key) do nothing;
