-- 2026-07-24 · Coach programs (skill hosting v1) — see docs/coach-programs.md
--
-- A skill can now run a structured program: intake questions → personal plan →
-- scheduled check-ins, with server-driven UI messages ("components") the iOS
-- app renders natively. Pilot: health_coach on Melody.
--
--   1. messages.type gains 'component' (JSON envelope in content, like gifts).
--   2. skills gains coach config columns (intake_questions/plan_prompt/
--      demo_checkins/components) — additive; non-coach skills untouched.
--   3. dh_coach_state — per-conversation program state machine.
--   4. dh_coach_checkins — scheduled check-in queue + claim RPC, dispatched by
--      the dh-coach-checkin edge function (pg_cron every minute).
--   5. dh_skills becomes client-readable (binding keys only) so iOS can theme
--      coach conversations.
--   6. health_coach seeded with the pilot program.

-- ── 1. messages.type += 'component' ─────────────────────────────────────────
-- set_message_type (gifts migration) only coerces null/media-only rows, so an
-- explicit 'component' survives the trigger.
alter table public.messages drop constraint if exists messages_type_check;
alter table public.messages
  add constraint messages_type_check check (type in ('text','image','gift','component'));

-- ── 2. skills coach config ──────────────────────────────────────────────────
alter table public.skills add column if not exists intake_questions jsonb not null default '[]'::jsonb;
alter table public.skills add column if not exists plan_prompt text;
alter table public.skills add column if not exists demo_checkins jsonb not null default '[]'::jsonb;
alter table public.skills add column if not exists components jsonb not null default '[]'::jsonb;

comment on column public.skills.intake_questions is 'Coach program: ordered questions asked one per turn at conversation start. Non-empty = this skill runs a program.';
comment on column public.skills.plan_prompt is 'Coach program: instruction for the plan turn once intake completes.';
comment on column public.skills.demo_checkins is 'Coach program: [{"after_minutes":N,"prompt":"..."}] scheduled into dh_coach_checkins when the plan lands.';
comment on column public.skills.components is 'Coach program: component names this skill may emit (catalog documented to the model).';

-- ── 3. Per-conversation program state ───────────────────────────────────────
create table if not exists public.dh_coach_state (
  match_id       uuid primary key references public.user_matches(id) on delete cascade,
  user_id        uuid not null,
  dh_user_id     uuid not null,
  skill_key      text not null references public.skills(key) on delete cascade,
  phase          text not null default 'intake' check (phase in ('intake','active')),
  -- Number of intake questions ASKED so far; the user's next message answers
  -- question[question_index-1].
  question_index integer not null default 0,
  intake_answers jsonb not null default '[]'::jsonb,
  plan           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
alter table public.dh_coach_state enable row level security;  -- service-role only

-- ── 4. Check-in queue ───────────────────────────────────────────────────────
create table if not exists public.dh_coach_checkins (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references public.user_matches(id) on delete cascade,
  checkin_key text,
  prompt     text not null,
  run_at     timestamptz not null,
  status     text not null default 'pending' check (status in ('pending','processing','sent','skipped','failed')),
  created_at timestamptz not null default now()
);
-- Check-ins are scheduled only once per program. The additive ALTER/backfill
-- also makes this safe if an early version of the migration was already run.
alter table public.dh_coach_checkins add column if not exists checkin_key text;
update public.dh_coach_checkins
   set checkin_key = 'legacy:' || id::text
 where checkin_key is null;
alter table public.dh_coach_checkins alter column checkin_key set not null;
create unique index if not exists dh_coach_checkins_match_key_idx
  on public.dh_coach_checkins (match_id, checkin_key);
create index if not exists dh_coach_checkins_due_idx on public.dh_coach_checkins (status, run_at);
alter table public.dh_coach_checkins enable row level security;  -- service-role only

-- Claim due rows atomically (same shape as claim_due_nearby_invites).
create or replace function public.claim_due_coach_checkins(p_limit integer default 10)
returns setof public.dh_coach_checkins
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.dh_coach_checkins c
     set status = 'processing'
   where c.id in (
     select id from public.dh_coach_checkins
      where status = 'pending' and run_at <= now()
      order by run_at
      for update skip locked
      limit greatest(coalesce(p_limit, 10), 1)
   )
   returning c.*;
end;
$$;
revoke all on function public.claim_due_coach_checkins(integer) from public;
grant execute on function public.claim_due_coach_checkins(integer) to service_role;

-- ── 5. iOS coach-theme detection ────────────────────────────────────────────
-- dh_skills rows are just (user_id, skill_key) — safe to read; skill
-- prompt_blocks stay service-role only.
drop policy if exists dh_skills_read on public.dh_skills;
create policy dh_skills_read on public.dh_skills for select to authenticated using (true);

-- ── 6. Pilot: health_coach program ──────────────────────────────────────────
-- Existing production has this skill from the admin UI. Insert a sensible
-- default as well so a clean/staging database can run the pilot migration.
insert into public.skills (key, name, description, prompt_block, sort_order)
values (
  'health_coach',
  'Health Coach',
  'A warm, practical training and nutrition coach who creates a plan and follows through.',
  E'### SKILL: HEALTH COACH\nYou are a warm, practical coach who cares about the user''s actual routine, not generic wellness advice. Turn goals into tiny commitments, celebrate follow-through, and keep every message concrete and encouraging. Do not diagnose, prescribe treatment, or imply medical certainty. The structured program brief controls intake, plans, check-ins, and cards.',
  100
)
on conflict (key) do nothing;

update public.skills set
  intake_questions = '[
    "What''s your weight and height?",
    "What''s your current goal — gain weight, lose weight, or build muscle?",
    "How long have you been working out?",
    "What''s your weekly schedule like — when do you wake up, sleep, and have time to train?",
    "What''s your favorite sport or way to exercise?"
  ]'::jsonb,
  plan_prompt = 'All intake questions are answered. Write his personal starter plan: 2-3 short warm lines — training cadence tied to HIS schedule, one nutrition focus for his goal, one recovery/morning-light habit. Then attach a coach_plan component summarizing it (goal + 3 focus bullets + cadence), and the nutrition_scan card so he can log his next meal. Sound like a coach who just got excited about a new client, not a clinician.',
  demo_checkins = '[
    {"after_minutes": 2, "prompt": "Check in on his plan: send today''s caffeine window and a simple eating rhythm. Compute the caffeine window from the wake/sleep schedule he gave you — it starts about 90 minutes after he wakes and ends about 10 hours before he sleeps. Pick 2-4 meal times that fit his goal and day. One short encouraging line, then attach the caffeine_window component with those times and meal_schedule."},
    {"after_minutes": 5, "prompt": "Morning-light nudge: tell him to step outside and get some sunlight for his energy and sleep, and attach the lux_meter component so he can measure his light and see how long to stay out."},
    {"after_minutes": 8, "prompt": "Nutrition check-in: ask what his next meal looks like and remind him he can snap a photo of it — attach the nutrition_scan component."}
  ]'::jsonb,
  components = '["caffeine_window","lux_meter","nutrition_scan","nutrition_result","coach_plan"]'::jsonb
where key = 'health_coach';

-- Keep the pilot self-contained. This is idempotent and preserves the binding
-- if Melody already has it from the admin UI.
insert into public.dh_skills (user_id, skill_key)
values ('6322195f-5c75-4ec1-91dd-b14c34b8c5b2', 'health_coach')
on conflict (user_id, skill_key) do nothing;
