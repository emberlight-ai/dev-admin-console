-- ============================================================
-- Migration: Per-tier daily RECEIVED-image limit (image_per_day)
--            + authoritative per-message "locked" resolver
-- ============================================================
-- Adds a per-tier cap on how many chat images a user may RECEIVE per UTC day.
-- Free tier = 1; premium tiers effectively unlimited (1,000,000, mirroring
-- messages_per_day). Images received beyond the cap render blurred + locked in
-- the iOS client until the user upgrades.
--
-- The lock decision is GLOBAL per day (across all of a user's conversations) and
-- backend-authoritative: rpc_locked_received_image_ids() ranks the viewer's
-- received images for the day and returns, for one match, the message ids that
-- fall beyond their quota. The client reads that set and blurs those bubbles.

-- 1. Column -------------------------------------------------------------------
alter table public.subscription_catalog
  add column if not exists image_per_day integer;   -- null = unlimited; free = 1

-- 2. Tier values --------------------------------------------------------------
update public.subscription_catalog set image_per_day = 1
  where apple_product_id = 'amber.subscription.free';
update public.subscription_catalog set image_per_day = 1000000
  where apple_product_id in ('amber.premium.monthly.0.0', 'amber.premium.yearly.0.0');

-- 3. Supporting index for the daily received-image scan -----------------------
create index if not exists messages_receiver_media_day_idx
  on public.messages (receiver_id, created_at)
  where media_url is not null;

-- 4. Authoritative locked-image resolver --------------------------------------
-- Returns the ids of messages IN p_match_id that are images the caller RECEIVED
-- and that exceed the caller's daily received-image quota. Runs as the caller
-- (security invoker) so auth.uid() is the viewer and RLS applies.
create or replace function public.rpc_locked_received_image_ids(p_match_id uuid)
returns table (message_id uuid)
language plpgsql
security invoker
stable
as $$
declare
  v_viewer uuid := auth.uid();
  v_limit  int;
  -- UTC day window, matching the entitlement API's utcDayBoundsIso().
  v_day_start timestamptz := (date_trunc('day', (now() at time zone 'utc'))) at time zone 'utc';
  v_day_end   timestamptz := v_day_start + interval '1 day';
begin
  if v_viewer is null then
    return;  -- unauthenticated (e.g. service role): nothing is "locked"
  end if;

  -- Resolve the viewer's daily received-image limit: active plan's catalog,
  -- else the free-tier catalog row, else a hard default of 1.
  select c.image_per_day
    into v_limit
  from public.subscription s
  join public.subscription_catalog c on c.id = s.subscription_catalog_id
  where s.user_id = v_viewer
    and s.status = 'ACTIVE'
    and (s.current_period_end is null or s.current_period_end > now())
  order by s.current_period_end desc nulls first
  limit 1;

  if v_limit is null then
    select c.image_per_day
      into v_limit
    from public.subscription_catalog c
    where c.apple_product_id = 'amber.subscription.free'
    limit 1;
  end if;

  v_limit := coalesce(v_limit, 1);

  return query
  with day_imgs as (
    select m.id,
           m.match_id,
           row_number() over (order by m.created_at asc, m.id asc) as rn
    from public.messages m
    where m.receiver_id = v_viewer
      and m.media_url is not null
      and m.created_at >= v_day_start
      and m.created_at <  v_day_end
  )
  select di.id
  from day_imgs di
  where di.match_id = p_match_id
    and di.rn > v_limit;
end;
$$;

grant execute on function public.rpc_locked_received_image_ids(uuid) to authenticated;
