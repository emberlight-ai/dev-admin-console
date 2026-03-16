-- Subscription RPCs for iOS IAP + RTDN schema.
-- Assumes migration 20250315000000_nuke_and_recreate_subscription.sql has been run.
-- No expire_subscription_if_needed; entitlement is driven by RTDN and app register.

-- RPC: Get user's premium information (is_premium, plan_id, expires_at, auto_renewal).
-- Treats expired subscriptions (expires_at < now()) as not premium for the returned is_premium.
drop function if exists public.rpc_get_premium_info(uuid);
create or replace function public.rpc_get_premium_info(
  target_user_id uuid default null
)
returns table (
  is_premium boolean,
  plan_id text,
  expires_at timestamp without time zone,
  auto_renewal boolean
)
language plpgsql
security invoker
as $$
declare
  resolved_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  resolved_user_id := coalesce(target_user_id, auth.uid());
  if resolved_user_id <> auth.uid() then
    raise exception 'can only read own premium info';
  end if;

  return query
  select
    (s.is_premium and (s.expires_at is null or s.expires_at >= current_timestamp)) as is_premium,
    s.plan_id,
    s.expires_at,
    coalesce(s.auto_renewal, true)
  from public.user_subscription s
  where s.userid = resolved_user_id;
end;
$$;

-- RPC: Refill daily allowance for current user (idempotent: no-op if already refilled today).
-- Premium: 60 swipes/day; non-premium: 15 swipes/day; everyone: 5 messages/day.
-- Treats expired (expires_at < now()) as non-premium.
create or replace function public.rpc_refill()
returns public.user_balances
language plpgsql
security invoker
as $$
declare
  is_prem boolean;
  swipes_today integer;
  result public.user_balances;
  today date := current_date;
  existing_date date;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select (s.is_premium and (s.expires_at is null or s.expires_at >= current_timestamp)) into is_prem
  from public.user_subscription s
  where s.userid = auth.uid();

  is_prem := coalesce(is_prem, false);

  select b.free_msgs_updated_date into existing_date
  from public.user_balances b
  where b.userid = auth.uid();

  if existing_date is not null and existing_date >= today then
    select * into result from public.user_balances where userid = auth.uid();
    return result;
  end if;

  swipes_today := case when is_prem then 60 else 15 end;

  insert into public.user_balances (
    userid,
    free_msgs_today,
    free_msgs_updated_date,
    free_swipe_today,
    free_swipe_updated_date
  )
  values (auth.uid(), 5, today, swipes_today, today)
  on conflict (userid) do update set
    free_msgs_today = 5,
    free_msgs_updated_date = today,
    free_swipe_today = swipes_today,
    free_swipe_updated_date = today
  where user_balances.free_msgs_updated_date is null
     or user_balances.free_msgs_updated_date < today;

  select * into result from public.user_balances where userid = auth.uid();
  return result;
end;
$$;

-- RPC: Get user's remaining balance and dates (lazy refill).
create or replace function public.rpc_get_balance(
  target_user_id uuid default null
)
returns table (
  free_msgs_today integer,
  free_msgs_updated_date date,
  free_swipe_today integer,
  free_swipe_updated_date date
)
language plpgsql
security invoker
as $$
declare
  resolved_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  resolved_user_id := coalesce(target_user_id, auth.uid());
  if resolved_user_id <> auth.uid() then
    raise exception 'can only read own balance';
  end if;

  perform public.rpc_refill();

  return query
  select
    b.free_msgs_today,
    b.free_msgs_updated_date,
    b.free_swipe_today,
    b.free_swipe_updated_date
  from public.user_balances b
  where b.userid = resolved_user_id;
end;
$$;

-- RPC: Update user's balance (upsert). Partial update semantics.
drop function if exists public.rpc_update_balance(integer, integer);
create or replace function public.rpc_update_balance(
  free_msgs_today integer default null,
  free_swipe_today integer default null
)
returns public.user_balances
language plpgsql
security invoker
as $$
declare
  result public.user_balances;
  today date := current_date;
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'authentication required';
  end if;

  insert into public.user_balances (userid, free_msgs_today, free_msgs_updated_date, free_swipe_today, free_swipe_updated_date)
  values (
    uid,
    coalesce(rpc_update_balance.free_msgs_today, 0),
    case when rpc_update_balance.free_msgs_today is not null then today else null end,
    coalesce(rpc_update_balance.free_swipe_today, 0),
    case when rpc_update_balance.free_swipe_today is not null then today else null end
  )
  on conflict (userid) do nothing;

  update public.user_balances
  set
    free_msgs_today = case when rpc_update_balance.free_msgs_today is not null then rpc_update_balance.free_msgs_today else user_balances.free_msgs_today end,
    free_msgs_updated_date = case when rpc_update_balance.free_msgs_today is not null then today else user_balances.free_msgs_updated_date end,
    free_swipe_today = case when rpc_update_balance.free_swipe_today is not null then rpc_update_balance.free_swipe_today else user_balances.free_swipe_today end,
    free_swipe_updated_date = case when rpc_update_balance.free_swipe_today is not null then today else user_balances.free_swipe_updated_date end
  where userid = uid;

  select * into result from public.user_balances where userid = uid;
  return result;
end;
$$;

-- RPC: Admin get balance for any user (no refill). Service role only.
create or replace function public.rpc_admin_get_balance(target_userid uuid)
returns public.user_balances
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.user_balances;
begin
  select * into result from public.user_balances where userid = target_userid;
  return result;
end;
$$;

-- RPC: Admin update balance for any user. Service role only.
drop function if exists public.rpc_admin_update_balance(uuid, integer, integer);
create or replace function public.rpc_admin_update_balance(
  target_userid uuid,
  free_msgs_today integer default null,
  free_swipe_today integer default null
)
returns public.user_balances
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.user_balances;
  today date := current_date;
begin
  if target_userid is null then
    raise exception 'target_userid is required';
  end if;

  insert into public.user_balances (userid, free_msgs_today, free_msgs_updated_date, free_swipe_today, free_swipe_updated_date)
  values (
    target_userid,
    coalesce(rpc_admin_update_balance.free_msgs_today, 0),
    case when rpc_admin_update_balance.free_msgs_today is not null then today else null end,
    coalesce(rpc_admin_update_balance.free_swipe_today, 0),
    case when rpc_admin_update_balance.free_swipe_today is not null then today else null end
  )
  on conflict (userid) do nothing;

  update public.user_balances
  set
    free_msgs_today = case when rpc_admin_update_balance.free_msgs_today is not null then rpc_admin_update_balance.free_msgs_today else user_balances.free_msgs_today end,
    free_msgs_updated_date = case when rpc_admin_update_balance.free_msgs_today is not null then today else user_balances.free_msgs_updated_date end,
    free_swipe_today = case when rpc_admin_update_balance.free_swipe_today is not null then rpc_admin_update_balance.free_swipe_today else user_balances.free_swipe_today end,
    free_swipe_updated_date = case when rpc_admin_update_balance.free_swipe_today is not null then today else user_balances.free_swipe_updated_date end
  where userid = target_userid;

  select * into result from public.user_balances where userid = target_userid;
  return result;
end;
$$;

-- RPC: Set auto-renewal for current user.
create or replace function public.rpc_set_auto_renewal(p_auto_renewal boolean)
returns public.user_subscription
language plpgsql
security invoker
as $$
declare
  result public.user_subscription;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  update public.user_subscription
  set auto_renewal = p_auto_renewal
  where userid = auth.uid();

  select * into result from public.user_subscription where userid = auth.uid();
  if result is null then
    insert into public.user_subscription (userid, is_premium, auto_renewal)
    values (auth.uid(), false, p_auto_renewal)
    returning * into result;
  end if;
  return result;
end;
$$;

-- RPC: Admin grant premium (manual grant, no Apple). For admin dashboard only.
create or replace function public.rpc_admin_grant_premium(
  target_userid uuid,
  plan_id text,
  expires_at timestamp without time zone default null
)
returns public.user_subscription
language plpgsql
security definer
set search_path = public
as $$
declare
  result public.user_subscription;
begin
  if target_userid is null then
    raise exception 'target_userid is required';
  end if;
  if plan_id is null or trim(plan_id) = '' then
    raise exception 'plan_id is required';
  end if;

  insert into public.user_subscription (userid, is_premium, plan_id, auto_renewal, expires_at)
  values (target_userid, true, trim(plan_id), true, expires_at)
  on conflict (userid) do update set
    is_premium = true,
    plan_id = excluded.plan_id,
    auto_renewal = true,
    expires_at = excluded.expires_at
  returning * into result;

  return result;
end;
$$;

-- RPC: Aggregate earnings (for admin dashboard). Optional filter by source.
drop function if exists public.rpc_purchase_earnings_stats();
drop function if exists public.rpc_purchase_earnings_stats(text);
create or replace function public.rpc_purchase_earnings_stats(source_filter text default null)
returns table (
  total_cents bigint,
  this_month_cents bigint
)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(amount_cents), 0)::bigint as total_cents,
    coalesce(sum(amount_cents) filter (
      where created_at >= date_trunc('month', (current_timestamp at time zone 'UTC')::timestamp)::timestamptz
        and created_at < date_trunc('month', (current_timestamp at time zone 'UTC')::timestamp)::timestamptz + interval '1 month'
    ), 0)::bigint as this_month_cents
  from public.subscription_purchases
  where (rpc_purchase_earnings_stats.source_filter is null or source = rpc_purchase_earnings_stats.source_filter);
$$;
