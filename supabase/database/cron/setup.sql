-- ============================================================
-- pg_cron: ALL JOBS SETUP (run this to register everything at once)
--
-- Before running:
--   Replace ALL occurrences of <your-service-role-key> in this file
--   with your actual key from:
--   Supabase Dashboard → Project Settings → API → service_role (secret)
--
-- This file is idempotent — safe to re-run anytime.
-- Project: wvcwvjlmnjnvyblrycxj
-- ============================================================

-- 1. Extensions
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- ---- Unschedule any existing jobs (idempotent re-run) ------
select cron.unschedule('dh-followup')          where exists (select 1 from cron.job where jobname = 'dh-followup');
select cron.unschedule('dh-matching')          where exists (select 1 from cron.job where jobname = 'dh-matching');
select cron.unschedule('dh-scheduled-replies') where exists (select 1 from cron.job where jobname = 'dh-scheduled-replies');

-- ---- 1. dh-followup: every 5 minutes -----------------------
select cron.schedule(
  'dh-followup',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := 'https://wvcwvjlmnjnvyblrycxj.supabase.co/functions/v1/dh-followup',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2Y3d2amxtbmpudnlibHJ5Y3hqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTgzNjcyMCwiZXhwIjoyMDgxNDEyNzIwfQ.9oeRPz5_q3DrPy-T3LZm5Fsdt-o-ZbKiqI1bqGzhqiI'
    ),
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
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2Y3d2amxtbmpudnlibHJ5Y3hqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTgzNjcyMCwiZXhwIjoyMDgxNDEyNzIwfQ.9oeRPz5_q3DrPy-T3LZm5Fsdt-o-ZbKiqI1bqGzhqiI'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ---- 3. dh-scheduled-replies: every minute ------------------
-- Fans out one dh-auto-reply call per match with a past-due
-- scheduled_response_at (handles the response-delay feature).
select cron.schedule(
  'dh-scheduled-replies',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://wvcwvjlmnjnvyblrycxj.supabase.co/functions/v1/dh-auto-reply',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind2Y3d2amxtbmpudnlibHJ5Y3hqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTgzNjcyMCwiZXhwIjoyMDgxNDEyNzIwfQ.9oeRPz5_q3DrPy-T3LZm5Fsdt-o-ZbKiqI1bqGzhqiI'
    ),
    body    := jsonb_build_object(
      'type',   'INSERT',
      'table',  'messages',
      'schema', 'public',
      'record', jsonb_build_object(
        'id',         '__scheduled__',
        'match_id',   s.match_id,
        'sender_id',  s.real_user_id,
        'created_at', now()
      )
    )
  )
  from user_match_ai_state s
  where s.scheduled_response_at is not null
    and s.scheduled_response_at <= now()
    and s.ai_locked_until is null;
  $$
);

-- ---- Verify all jobs are registered -------------------------
select jobname, schedule, active from cron.job order by jobname;
