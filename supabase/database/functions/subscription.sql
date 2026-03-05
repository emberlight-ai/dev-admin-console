-- Helper: set is_premium = false for current user when expires_at is in the past (lazy expiration).
-- Called before reading premium status so refill and get_premium_info see up-to-date state.
create or replace function public.expire_subscription_if_needed()
returns void
language plpgsql
security invoker
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update public.user_subscription
  set is_premium = false
  where userid = auth.uid()
    and is_premium = true
    and expires_at is not null
    and expires_at < current_timestamp;
end;
$$;

-- RPC: Get user's premium information (is_premium, plan_id, expires_at).
-- Expires subscription lazily when expires_at has passed, then returns current row.
create or replace function public.rpc_get_premium_info(
  target_user_id uuid default null
)
returns table (
  is_premium boolean,
  plan_id text,
  expires_at timestamp without time zone
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

  perform public.expire_subscription_if_needed();

  return query
  select
    s.is_premium,
    s.plan_id,
    s.expires_at
  from public.user_subscription s
  where s.userid = resolved_user_id;
end;
$$;

-- RPC: Refill daily allowance for current user (idempotent: no-op if already refilled today).
-- Premium: 60 swipes/day; non-premium: 10 swipes/day; everyone: 15 messages/day.
-- Can be called explicitly (e.g. on app open or cron) or implicitly when rpc_get_balance runs (lazy refill).
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
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  perform public.expire_subscription_if_needed();

  select coalesce(s.is_premium, false) into is_prem
  from public.user_subscription s
  where s.userid = auth.uid();

  swipes_today := case when is_prem then 60 else 10 end;

  insert into public.user_balances (
    userid,
    free_msgs_today,
    free_msgs_updated_date,
    free_swipe_today,
    free_swipe_updated_date
  )
  values (auth.uid(), 15, today, swipes_today, today)
  on conflict (userid) do update set
    free_msgs_today = 15,
    free_msgs_updated_date = today,
    free_swipe_today = swipes_today,
    free_swipe_updated_date = today
  where user_balances.free_msgs_updated_date is null
     or user_balances.free_msgs_updated_date < today;

  select * into result from public.user_balances where userid = auth.uid();
  return result;
end;
$$;

-- RPC: Get user's remaining balance and dates.
-- If balance row is missing or *_updated_date is before today, refills for today first (lazy refill),
-- then returns the row. So the first "get balance" of the day effectively triggers the daily refill.
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

  -- Lazy refill: if not yet refilled today, refill then return
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

-- RPC: Update user's balance (upsert; null param = do not change)
create or replace function public.rpc_update_balance(
  free_msgs_today integer default null,
  free_swipe_today integer default null,
  free_msgs_updated_date date default null,
  free_swipe_updated_date date default null
)
returns public.user_balances
language plpgsql
security invoker
as $$
declare
  result public.user_balances;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  insert into public.user_balances (
    userid,
    free_msgs_today,
    free_msgs_updated_date,
    free_swipe_today,
    free_swipe_updated_date
  )
  values (
    auth.uid(),
    coalesce(free_msgs_today, 0),
    free_msgs_updated_date,
    coalesce(free_swipe_today, 0),
    free_swipe_updated_date
  )
  on conflict (userid) do update set
    free_msgs_today = coalesce(excluded.free_msgs_today, user_balances.free_msgs_today),
    free_msgs_updated_date = coalesce(excluded.free_msgs_updated_date, user_balances.free_msgs_updated_date),
    free_swipe_today = coalesce(excluded.free_swipe_today, user_balances.free_swipe_today),
    free_swipe_updated_date = coalesce(excluded.free_swipe_updated_date, user_balances.free_swipe_updated_date)
  returning * into result;

  return result;
end;
$$;

-- RPC: Purchase premium (upsert subscription for current user)
create or replace function public.rpc_purchase_premium(
  plan_id text,
  expires_at timestamp without time zone
)
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
  if plan_id is null or trim(plan_id) = '' then
    raise exception 'plan_id is required';
  end if;
  if expires_at is null then
    raise exception 'expires_at is required';
  end if;

  insert into public.user_subscription (userid, is_premium, plan_id, expires_at)
  values (auth.uid(), true, plan_id, expires_at)
  on conflict (userid) do update set
    is_premium = true,
    plan_id = excluded.plan_id,
    expires_at = excluded.expires_at
  returning * into result;

  return result;
end;
$$;
