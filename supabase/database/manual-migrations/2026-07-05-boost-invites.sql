-- Boost invitations — manual migration (2026-07-05).
-- Run once against production (SQL editor / psql). Idempotent.
-- Source of truth: database/functions/matches.sql + schema.sql defaults.

-- ============================================================================
-- BOOST INVITATIONS — "get seen first" made true.
--
-- While a boost is active the app promises up-to-×10 attention, so digital
-- humans keep reaching out for the whole window: one invitation every
-- boost_invite_interval_seconds, boost_invites_total in all (defaults 120s × 7
-- ≈ the 15-minute boost). Called once by POST /api/ios/me/boost on activation;
-- each row is delivered by the same dh-nearby-dispatch cron as organic nearby
-- invites (Gemini opener + match_requests.greeting + push), so boost likes are
-- indistinguishable from organic ones on the Likes page.
--
-- Deliberately IGNORES the nearby gates (daily cap, cooldown, account age,
-- active_greeting_enabled): a boost is an explicit purchase of attention.
-- Green mode IS respected — rpc_list_match_requests hides invitations from
-- personalities outside the set, so scheduling them would waste the boost.
-- ============================================================================
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
  with green_mode_personalities as (
    select lower(btrim(green_value.personality)) as personality
    from digital_human_config cfg
    cross join lateral jsonb_array_elements_text(
      case when jsonb_typeof(cfg.value::jsonb) = 'array' then cfg.value::jsonb else '[]'::jsonb end
    ) as green_value(personality)
    where cfg.key = 'green_mode_personalities'
      and nullif(btrim(green_value.personality), '') is not null
  ),
  candidates as (
    select u.userid, u.whitelisted
    from users u
    where u.is_digital_human = true
      and u.deleted_at is null
      and u.avatar is not null
      and (
        not exists (select 1 from green_mode_personalities)
        or lower(btrim(coalesce(u.personality, ''))) in (select personality from green_mode_personalities)
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

revoke all on function public.schedule_boost_invites(uuid) from public;
grant execute on function public.schedule_boost_invites(uuid) to service_role;

insert into public.digital_human_config (key, value, description)
values
  ('enable_boost_invites', 'true', 'While a boost is active, digital humans keep reaching out with invitations'),
  ('boost_invites_total', '7', 'How many DH invitations a boost schedules across its 15-minute window'),
  ('boost_invite_interval_seconds', '120', 'Seconds between boost invitations (120 = one like every 2 minutes)')
on conflict (key) do nothing;
