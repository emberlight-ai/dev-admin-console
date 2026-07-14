-- ============================================================
-- pg_cron: ALL JOBS SETUP (run this to register everything at once)
--
-- SECURITY (2026-07-14): this file previously embedded the service-role JWT
-- in the Authorization headers. Treat that key as EXPOSED (it is in git
-- history) and rotate it: Dashboard → Project Settings → API → service_role →
-- Roll. All DH functions are deployed with verify_jwt = false (config.toml +
-- `npm run functions:deploy`), so cron calls need NO Authorization header at
-- all — the jobs below carry none, and no secret ever belongs in this file.
--
-- Order of operations for the fix:
--   1. Redeploy dh-nearby-dispatch once (it now has verify_jwt = false in
--      config.toml; its old deployment verified JWTs):
--        supabase functions deploy dh-nearby-dispatch --no-verify-jwt \
--          --project-ref wvcwvjlmnjnvyblrycxj
--   2. Re-run THIS file (replaces the header-carrying jobs).
--   3. Rotate the service_role key in the dashboard.
--
-- This file is idempotent — safe to re-run anytime.
-- Project: wvcwvjlmnjnvyblrycxj
-- ============================================================

-- 1. Extensions
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---- Unschedule any existing jobs (idempotent re-run) ------
select cron.unschedule('dh-followup')          where exists (select 1 from cron.job where jobname = 'dh-followup');
select cron.unschedule('dh-outbound')          where exists (select 1 from cron.job where jobname = 'dh-outbound');
select cron.unschedule('dh-matching')          where exists (select 1 from cron.job where jobname = 'dh-matching');
select cron.unschedule('dh-nearby-dispatch')   where exists (select 1 from cron.job where jobname = 'dh-nearby-dispatch');
select cron.unschedule('dh-scheduled-replies') where exists (select 1 from cron.job where jobname = 'dh-scheduled-replies');
select cron.unschedule('dh-nightly-debrief')   where exists (select 1 from cron.job where jobname = 'dh-nightly-debrief');

-- ---- 1. dh-outbound: every 5 minutes -----------------------
-- The unified proactive scheduler (composition Phase 3): follow-up ladders +
-- time-of-day check-ins, idempotent via dh_outbound_events. Replaced
-- dh-followup (2026-07-14).
select cron.schedule(
  'dh-outbound',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://wvcwvjlmnjnvyblrycxj.supabase.co/functions/v1/dh-outbound',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- ---- 2. dh-matching: every 5 min, tiny batches (offset) -----
select cron.schedule(
  'dh-matching',
  '1-59/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://wvcwvjlmnjnvyblrycxj.supabase.co/functions/v1/dh-matching',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- ---- 3. dh-nearby-dispatch: every minute, deliver due nearby invites -----
-- Per-invite run_at (set when find-nearby-people schedules them) is what makes
-- arrivals feel random across a 1–3 min window; this is just the poll loop.
-- (Folds into dh-outbound in the composition redesign, Phase 3.)
select cron.schedule(
  'dh-nearby-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://wvcwvjlmnjnvyblrycxj.supabase.co/functions/v1/dh-nearby-dispatch',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body    := '{}'::jsonb
  );
  $$
);

-- ---- 4. dh-scheduled-replies: REMOVED ----------------------
-- The fixed response-delay mechanism is gone — dh-auto-reply applies a natural
-- typing delay inline. The unschedule near the top drops the old job on re-run.

-- ---- 5. dh-nightly-debrief: REMOVED (L5 retired 2026-07-08) --
-- The unschedule near the top drops the job. Also delete the orphaned remote
-- function:  supabase functions delete dh-nightly-debrief

-- ---- Verify all jobs are registered -------------------------
select jobname, schedule, active from cron.job order by jobname;
