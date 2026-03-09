-- Ensure auto_renewal column exists (for existing deployments).
alter table public.user_subscription add column if not exists auto_renewal boolean not null default true;

-- Helper: when expires_at is in the past, either auto-renew (extend expires_at) or expire (set is_premium = false).
-- If auto_renewal = true, extend expires_at by plan duration (monthly 1 month, yearly 12 months).
-- If auto_renewal = false, set is_premium = false. Called before reading premium status.
create or replace function public.expire_subscription_if_needed()
returns void
language plpgsql
security invoker
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  update public.user_subscription s
  set
    is_premium = case when s.auto_renewal then true else false end,
    expires_at = case
      when not s.auto_renewal then s.expires_at
      when s.plan_id = 'yearly' then s.expires_at + interval '12 months'
      when s.plan_id = 'monthly' then s.expires_at + interval '1 month'
      else s.expires_at + interval '1 month'
    end
  where s.userid = auth.uid()
    and s.is_premium = true
    and s.expires_at is not null
    and s.expires_at < current_timestamp;
end;
$$;

-- RPC: Get user's premium information (is_premium, plan_id, expires_at, auto_renewal).
-- Expires or auto-renews lazily when expires_at has passed, then returns current row.
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

  perform public.expire_subscription_if_needed();

  return query
  select
    s.is_premium,
    s.plan_id,
    s.expires_at,
    coalesce(s.auto_renewal, true)
  from public.user_subscription s
  where s.userid = resolved_user_id;
end;
$$;

-- RPC: Refill daily allowance for current user (idempotent: no-op if already refilled today).
-- Premium: 60 swipes/day; non-premium: 15 swipes/day; everyone: 5 messages/day.
-- Can be called explicitly (e.g. on app open or cron) or implicitly when rpc_get_balance runs (lazy refill).
-- If row exists but free_msgs_updated_date is null (e.g. created by update_balance without dates),
-- we only set the date columns to today so refill won't keep resetting counts on every get.
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

  perform public.expire_subscription_if_needed();

  select b.free_msgs_updated_date into existing_date
  from public.user_balances b
  where b.userid = auth.uid();

  -- Already refilled today: do nothing (don't overwrite consumed balance)
  if existing_date is not null and existing_date >= today then
    select * into result from public.user_balances where userid = auth.uid();
    return result;
  end if;

  select coalesce(s.is_premium, false) into is_prem
  from public.user_subscription s
  where s.userid = auth.uid();

  swipes_today := case when is_prem then 60 else 15 end;

  -- No row, or date is null / before today: insert or full refill
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

-- RPC: Update user's balance (upsert). Missing (null) params leave that field untouched.
-- Only provided fields are updated; backend sets the corresponding *_updated_date to today when a count is updated.
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

  -- Ensure row exists (insert defaults if missing)
  insert into public.user_balances (userid, free_msgs_today, free_msgs_updated_date, free_swipe_today, free_swipe_updated_date)
  values (
    uid,
    coalesce(rpc_update_balance.free_msgs_today, 0),
    case when rpc_update_balance.free_msgs_today is not null then today else null end,
    coalesce(rpc_update_balance.free_swipe_today, 0),
    case when rpc_update_balance.free_swipe_today is not null then today else null end
  )
  on conflict (userid) do nothing;

  -- Update only the fields that were provided (non-null); set corresponding date to today when count is updated
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

-- RPC: Admin get balance for any user (no refill). Service role only (security definer).
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

-- RPC: Admin update balance for any user. Same partial-update semantics as rpc_update_balance. Service role only.
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

-- RPC: Grant premium (upsert user_subscription). Decoupled from recording purchase.
-- Backend passes expires_at from its plan config: null = lifetime, else subscription end time.
drop function if exists public.rpc_purchase_premium(text);
create or replace function public.rpc_purchase_premium(
  plan_id text,
  expires_at timestamp without time zone default null
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

  insert into public.user_subscription (userid, is_premium, plan_id, auto_renewal, expires_at)
  values (auth.uid(), true, plan_id, true, expires_at)
  on conflict (userid) do update set
    is_premium = true,
    plan_id = excluded.plan_id,
    auto_renewal = true,
    expires_at = excluded.expires_at
  returning * into result;

  return result;
end;
$$;

-- RPC: Set auto-renewal for current user (false = cancel at end of period; premium lasts until expires_at).
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

-- RPC: Record a subscription purchase only (insert into subscription_purchases). Does not grant premium.
-- Caller records purchase then calls rpc_purchase_premium separately with expires_at from plan config.
create or replace function public.rpc_record_purchase(
  plan_id text,
  amount_cents integer
)
returns public.subscription_purchases
language plpgsql
security invoker
as $$
declare
  result public.subscription_purchases;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if plan_id is null or trim(plan_id) = '' then
    raise exception 'plan_id is required';
  end if;
  if amount_cents is null or amount_cents < 0 then
    raise exception 'amount_cents must be a non-negative integer';
  end if;

  insert into public.subscription_purchases (userid, plan_id, amount_cents)
  values (auth.uid(), plan_id, amount_cents)
  returning * into result;

  return result;
end;
$$;

-- RPC: Aggregate earnings from subscription_purchases (for admin dashboard).
-- Returns total_cents (all time) and this_month_cents (current calendar month in UTC).
-- Called by admin API with service role.
drop function if exists public.rpc_purchase_earnings_stats();
create or replace function public.rpc_purchase_earnings_stats()
returns table (total_cents bigint, this_month_cents bigint)
language sql
security definer
set search_path = public
as $$
  select
    coalesce(sum(amount_cents), 0)::bigint as total_cents,
    coalesce(
      sum(amount_cents) filter (
        where created_at >= (date_trunc('month', (current_timestamp at time zone 'UTC')::date)::timestamp at time zone 'UTC')
          and created_at < (date_trunc('month', (current_timestamp at time zone 'UTC')::date) + interval '1 month')::timestamp at time zone 'UTC'
      ),
      0
    )::bigint as this_month_cents
  from public.subscription_purchases;
$$;
