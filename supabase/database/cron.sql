
-- 5. Enable pg_cron extension and schedule jobs
-- Note: pg_cron may not be available in all Supabase plans. If unavailable, use Supabase Edge Functions
-- with scheduled invocations or an external cron service.
create extension if not exists pg_cron;

-- Schedule job to send invites from digital humans (every 1 hour)
do $$
declare
  job_exists boolean;
begin
  -- Check if job already exists
  select exists(
    select 1 from cron.job where jobname = 'send-digital-human-invites'
  ) into job_exists;
  
  if job_exists then
    -- Unschedule existing job
    perform cron.unschedule('send-digital-human-invites');
  end if;
  
  -- Schedule the job
  perform cron.schedule(
    'send-digital-human-invites',
    '0 * * * *', -- Every 1 hour
    $cmd$select public.send_digital_human_invites()$cmd$
  );
end $$;

-- Schedule job to process digital human match requests (every 5 minutes)
do $$
declare
  job_exists boolean;
begin
  -- Check if job already exists
  select exists(
    select 1 from cron.job where jobname = 'process-digital-human-requests'
  ) into job_exists;
  
  if job_exists then
    -- Unschedule existing job
    perform cron.unschedule('process-digital-human-requests');
  end if;
  
  -- Schedule the job
  perform cron.schedule(
    'process-digital-human-requests',
    '*/5 * * * *', -- Every 5 minutes
    $cmd$select public.process_digital_human_requests()$cmd$
  );
end $$;
