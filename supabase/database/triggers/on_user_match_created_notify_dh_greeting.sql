-- ============================================================
-- Trigger: on_user_match_created_notify_dh_greeting
--
-- Fires AFTER INSERT on user_matches.
-- Only calls the dh-greeting Edge Function when one of the matched
-- users is a digital human — avoiding wasted invocations for
-- human-human matches.
--
-- Uses pg_net for async HTTP (runs after transaction commits).
--
-- Replace <your-service-role-key> before running.
-- ============================================================

-- 1. The trigger function
create or replace function notify_dh_greeting()
returns trigger
language plpgsql
security definer
as $$
declare
  user_a_is_dh boolean;
  user_b_is_dh boolean;
begin
  -- Check if either user is a digital human
  select is_digital_human into user_a_is_dh
    from public.users where userid = NEW.user_a;

  select is_digital_human into user_b_is_dh
    from public.users where userid = NEW.user_b;

  -- Only invoke the Edge Function when a DH is involved
  if coalesce(user_a_is_dh, false) or coalesce(user_b_is_dh, false) then
    perform net.http_post(
      url     := 'https://wvcwvjlmnjnvyblrycxj.supabase.co/functions/v1/dh-greeting',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer <your-service-role-key>'
      ),
      body    := jsonb_build_object(
        'type',   'INSERT',
        'table',  'user_matches',
        'schema', 'public',
        'record', jsonb_build_object(
          'id',         NEW.id,
          'user_a',     NEW.user_a,
          'user_b',     NEW.user_b,
          'created_at', NEW.created_at
        )
      )
    );
  end if;

  return NEW;
end;
$$;

-- 2. Attach the trigger (drop first if re-running)
drop trigger if exists on_user_match_created_notify_dh_greeting on public.user_matches;

create trigger on_user_match_created_notify_dh_greeting
  after insert on public.user_matches
  for each row
  execute function notify_dh_greeting();
