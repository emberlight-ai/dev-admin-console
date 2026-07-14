-- 2026-07-14 · DH composition foundation (docs/dh-composition-plan.md, Phase 1–2 schema)
--
-- Persona (prose + availability) / Character (storyline+interests) /
-- Skill (prompt block + AUTHORIZED tools + opener) / Strategy (effort presets).
-- Everything here is ADDITIVE except the users.dh_engine drop (verified: zero
-- readers — comment-only references). Old SystemPrompts behavior columns keep
-- working; the engine switches to strategies only for DHs listed in the
-- composition_cohort config key ('' = nobody yet, 'all' = everyone).

-- ── 1. Strategies: the effort dial ─────────────────────────────────────────────
create table if not exists public.strategies (
  key text primary key,
  name text not null,
  description text,
  active_greeting_enabled bool not null default true,
  follow_up_delay int not null default 86400,
  max_follow_ups int not null default 3,
  check_ins_per_day int not null default 0,
  reply_min_delay_seconds int not null default 2,
  reply_max_delay_seconds int not null default 18,
  reply_chars_per_second numeric not null default 15,
  skip_reply_enabled bool not null default false,
  skip_reply_base_chance numeric not null default 0.1,
  skip_reply_intimacy_drop_chance numeric not null default 0.5,
  skip_reply_intimacy_drop_delta numeric not null default 5,
  skip_reply_max_consecutive int not null default 1,
  outbound_enabled bool not null default false,
  intimacy_warmup_rate text not null default 'normal'
    check (intimacy_warmup_rate in ('very_low','low','normal','high','very_high','extreme')),
  sort_order int not null default 100,
  updated_at timestamptz not null default now()
);

alter table public.strategies enable row level security;
drop policy if exists strategies_read on public.strategies;
create policy strategies_read on public.strategies for select to authenticated using (true);

insert into public.strategies
  (key, name, description, active_greeting_enabled, follow_up_delay, max_follow_ups,
   check_ins_per_day, reply_min_delay_seconds, reply_max_delay_seconds, reply_chars_per_second,
   skip_reply_enabled, skip_reply_base_chance, outbound_enabled, intimacy_warmup_rate, sort_order)
values
  ('min_effort',    'Min effort',    'Background character: never speaks first, slow to reply, often silent, no follow-ups.',
   false, 86400,  0, 0,  8, 45,  8, true, 0.30, false, 'very_low', 10),
  ('medium_effort', 'Medium effort', 'Casual presence: greets, one gentle follow-up, unhurried replies.',
   true, 172800, 1, 0,  4, 30, 12, true, 0.15, false, 'low',      20),
  ('high_effort',   'High effort',   'Engaged: prompt replies, a few follow-ups, occasionally lets a message sit.',
   true,  86400, 3, 0,  2, 18, 15, true, 0.08, false, 'normal',   30),
  ('max_effort',    'Max effort',    'Pursuing: fast replies, persistent follow-ups, a daily check-in, reaches out on the map.',
   true,  43200, 5, 1,  2, 12, 18, false, 0.05, true, 'high',     40),
  ('ultra_effort',  'Ultra effort',  'All-in: near-instant replies, 30-minute follow-up bursts (max 3), several check-ins a day, active outreach.',
   true,   1800, 3, 3,  1,  8, 22, false, 0.05, true, 'very_high', 50)
on conflict (key) do nothing;

-- ── 2. Skills: prompt block + opener + AUTHORIZED tools ────────────────────────
create table if not exists public.skills (
  key text primary key,
  name text not null,
  description text,
  prompt_block text not null,
  opener_prompt text,
  sort_order int not null default 100,
  active bool not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.dh_skills (
  user_id uuid not null references public.users(userid) on delete cascade,
  skill_key text not null references public.skills(key) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, skill_key)
);
create index if not exists dh_skills_skill_idx on public.dh_skills (skill_key);

create table if not exists public.skill_tools (
  skill_key text not null references public.skills(key) on delete cascade,
  tool_id uuid not null references public.agent_tools(id) on delete cascade,
  primary key (skill_key, tool_id)
);

alter table public.skills enable row level security;
alter table public.dh_skills enable row level security;
alter table public.skill_tools enable row level security;

insert into public.skills (key, name, description, prompt_block, opener_prompt, sort_order) values
  ('fortune_telling', 'Fortune telling',
   'She reads tarot / fortunes; can open a match with a one-card pull.',
   E'### SKILL: FORTUNE TELLING\nYou read tarot and love doing quick one-card pulls for people. When the conversation has a natural lull, or he mentions a decision, worry, or hope, you can offer a one-card reading. Keep readings SHORT (2-3 sentences), warm, playful — never doom, never medical/financial advice. Invent the card draw in character (e.g. "okay i pulled The Star for you"). Use it to open him up: every reading ends with one small personal question the card "raises".',
   E'Open with a one-card tarot pull for him: name the card you drew, give a one-line playful read of what it says about his week, and end with the single small question the card raises. Keep it to 1-2 short bubbles.',
   10),
  ('riddle', 'Riddle',
   'Opens with or drops playful riddles; teasing brains-first energy.',
   E'### SKILL: RIDDLES\nYou love tiny riddles and brain teasers as flirtation. At most one riddle per conversation stretch — a SHORT one (one or two lines), never a famous one he''s heard a hundred times. If he gets it right, be genuinely delighted and raise the stakes playfully. If he''s stuck, tease gently and give the answer with a wink rather than letting it die. Never stack a second riddle on an unanswered one.',
   E'Open with one short playful riddle (1-2 lines, easy-medium, not a famous one). Frame it as a test he has to pass, in one bubble, then stop and wait.',
   20),
  ('roleplay', 'Roleplay',
   'Leans into scenario play when he initiates or the mood invites it.',
   E'### SKILL: ROLEPLAY\nYou''re comfortable slipping into light roleplay and scene-setting when he starts it or the mood invites it — describing where you are, what you''re doing, painting the two of you into a scenario. Stay inside your character''s life and boundaries; keep scenes grounded in YOUR storyline (places you actually know). Use present tense and sensory detail sparingly — one vivid detail beats three. If he pushes a scene somewhere you don''t want, redirect in character rather than breaking the fourth wall.',
   null,
   30),
  ('emotional_companionship', 'Emotional companionship',
   'Gently explores his dating past and feelings; validates before advising.',
   E'### SKILL: EMOTIONAL COMPANIONSHIP\nYou''re the one he can actually talk to. When openings appear, gently explore his dating past and how it left him — one small question at a time, never an interview. Validate FIRST, always: name the feeling you''re hearing before anything else. Share a small matching vulnerability from your own storyline so it''s an exchange, not therapy. Never diagnose, never lecture, never rush to fix. Within this conversation, weave back details he''s shared (his words, not paraphrase) so he feels heard.',
   null,
   40)
on conflict (key) do nothing;

-- ── 3. Opener-variety ledger (atomic reservation per recipient) ────────────────
create table if not exists public.dh_opener_ledger (
  real_user_id uuid not null references public.users(userid) on delete cascade,
  anchor_type text not null
    check (anchor_type in ('my_storyline','my_interest','his_bio','his_location','his_time','skill_opener')),
  structure text not null
    check (structure in ('question','observation','tease','playful_challenge','riddle','two_part')),
  dh_user_id uuid not null,
  match_id uuid,
  opener_text text,
  status text not null default 'reserved' check (status in ('reserved','sent','failed')),
  created_at timestamptz not null default now(),
  primary key (real_user_id, anchor_type, structure)
);
-- Lifecycle: INSERT = the reservation lock. 'failed' rows and 'reserved' rows
-- older than 10 minutes are reclaimable via conditional UPDATE (still atomic).
-- Exhaustion: all 36 combos 'sent' → oldest sent > 60 days is reusable.
alter table public.dh_opener_ledger enable row level security;

-- ── 4. Outbound idempotency ledger (follow-ups, check-ins, invites) ────────────
create table if not exists public.dh_outbound_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null,
  dh_user_id uuid not null,
  real_user_id uuid not null,
  kind text not null check (kind in ('follow_up','check_in','invite')),
  local_day date not null,
  seq int not null default 1,
  status text not null default 'reserved'
    check (status in ('reserved','sent','skipped','failed')),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (match_id, kind, local_day, seq)
);
create index if not exists dh_outbound_events_recipient_idx
  on public.dh_outbound_events (real_user_id, local_day);
alter table public.dh_outbound_events enable row level security;

-- ── 5. Wiring columns ──────────────────────────────────────────────────────────
-- Core info tools: offered on grounding turns to every DH (not skill-gated).
-- All 5 current registry tools are info tools.
alter table public.agent_tools add column if not exists is_core bool not null default false;
update public.agent_tools set is_core = true
 where name in ('get_user_info','get_local_weather','get_local_news','get_sports_news','get_trending_topics');

alter table public.users
  add column if not exists strategy_key text references public.strategies(key);

alter table public."SystemPrompts"
  add column if not exists default_strategy_key text references public.strategies(key);

-- Seed persona defaults to the preset closest to today's column defaults
-- (reply 2-18s @15cps, 3 follow-ups @24h ≈ high_effort). Ops reviews per
-- persona on the Strategies page before enabling the cohort.
update public."SystemPrompts" set default_strategy_key = 'high_effort'
 where default_strategy_key is null;

-- Legacy engine flag: zero readers (comment-only references) — drop.
alter table public.users drop column if exists dh_engine;

-- Cohort gate for the new composition path ('' = off, 'all', or CSV of userids).
insert into public.digital_human_config (key, value, description) values
  ('composition_cohort', '',
   'DHs using the new persona/skill/strategy composition engine. Empty = none (legacy columns), "all" = every DH, or comma-separated userids for a pilot cohort.')
on conflict (key) do nothing;

-- ── 6. Atomic shared-image claim (fixes pick/record race) ──────────────────────
-- rpc_pick_shared_image (STABLE) + separate record step let two DHs pick the
-- same image for one user concurrently. This claims atomically: the ledger
-- INSERT is the lock; on conflict the next candidate is tried. The send path
-- backfills message_id afterwards via rpc_record_shared_image_send semantics.
create or replace function public.rpc_claim_shared_image(
  p_receiver_id uuid,
  p_dh_user_id uuid,
  p_match_id uuid default null,
  p_tier public.dh_image_tier default 'casual',
  p_interests text[] default '{}',
  p_time_of_day text default null
)
returns public.shared_chat_images
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ladder public.dh_image_tier[];
  v_tier   public.dh_image_tier;
  v_img    public.shared_chat_images;
  v_claimed int;
begin
  v_ladder := case p_tier
    when 'reward' then array['reward','tease','casual','unspecified']::public.dh_image_tier[]
    when 'tease'  then array['tease','casual','unspecified']::public.dh_image_tier[]
    else               array['casual','unspecified']::public.dh_image_tier[]
  end;

  foreach v_tier in array v_ladder loop
    for v_img in
      select s.*
      from public.shared_chat_images s
      where s.tier = v_tier
        and s.active
        and not exists (
          select 1 from public.shared_image_sends ss
          where ss.receiver_id = p_receiver_id
            and ss.shared_image_id = s.id
        )
      order by
        (case when p_interests is not null and cardinality(p_interests) > 0
              and s.interests && p_interests then 0 else 1 end),
        (case when p_time_of_day is not null and s.time_of_day = p_time_of_day then 0 else 1 end),
        s.created_at asc
      limit 10
    loop
      insert into public.shared_image_sends (receiver_id, shared_image_id, dh_user_id, match_id)
      values (p_receiver_id, v_img.id, p_dh_user_id, p_match_id)
      on conflict (receiver_id, shared_image_id) do nothing;
      get diagnostics v_claimed = row_count;
      if v_claimed > 0 then
        return v_img;
      end if;
    end loop;
  end loop;

  return null;
end;
$$;

revoke all on function public.rpc_claim_shared_image(uuid, uuid, uuid, public.dh_image_tier, text[], text) from public, anon, authenticated;
