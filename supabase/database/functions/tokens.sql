-- ═══════════════════════════════════════════════════════════════════════════
-- Tokens & Gifts — the ARPPU layer.
--
-- Design:
--   user_wallet   cached balance, one row per user. Debits row-lock it with a
--                 `balance >= cost` guard so overspends are impossible.
--   token_ledger  append-only audit trail (every credit/debit, with
--                 balance_after). Source of truth for disputes/reconciliation.
--                 UNIQUE (reason, ref) makes credits idempotent: Apple webhook
--                 replays / client retries credit exactly once.
--   gift_catalog  server-authoritative gift pricing (client renders assets by
--                 key, price can change without an app release).
--   token_catalog consumable IAP packs. bonus_tokens > 0 renders as "N + bonus"
--                 (promo); StoreKit's live price is the displayed price,
--                 price_cents is the reference/list price.
--
-- Grants:
--   signup            free-tier tokens_granted on users insert (real users only)
--   subscription      tokens_granted per billing period (ref = sub id + period
--                     start, so renewals grant again but re-verifies don't)
--   iap_purchase      via /api/ios/me/tokens/purchase (service role,
--                     ref = environment:transactionId)
--
-- Spend: rpc_send_gift — the only debit path today.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.gift_catalog (
  key         text primary key,
  name        text not null,
  asset       text not null,               -- iOS asset name
  cost_tokens integer not null check (cost_tokens > 0),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.gift_catalog enable row level security;
drop policy if exists gift_catalog_read on public.gift_catalog;
create policy gift_catalog_read on public.gift_catalog
  for select to authenticated using (true);

create table if not exists public.user_wallet (
  user_id    uuid primary key references public.users(userid) on delete cascade,
  balance    integer not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.token_ledger (
  id            bigint generated always as identity primary key,
  user_id       uuid not null references public.users(userid) on delete cascade,
  delta         integer not null,
  balance_after integer not null,
  reason        text not null check (reason in
                  ('signup_grant','subscription_grant','iap_purchase','gift_send','admin_adjust')),
  ref           text,          -- idempotency key: txn id / message id / period key
  created_at    timestamptz not null default now()
);

create unique index if not exists token_ledger_reason_ref_uniq
  on public.token_ledger (reason, ref) where ref is not null;
create index if not exists token_ledger_user_idx
  on public.token_ledger (user_id, id desc);

alter table public.user_wallet enable row level security;
alter table public.token_ledger enable row level security;

drop policy if exists user_wallet_read_own on public.user_wallet;
create policy user_wallet_read_own on public.user_wallet
  for select to authenticated using (user_id = auth.uid());

drop policy if exists token_ledger_read_own on public.token_ledger;
create policy token_ledger_read_own on public.token_ledger
  for select to authenticated using (user_id = auth.uid());
-- No insert/update policies: all writes go through security-definer functions.

create table if not exists public.token_catalog (
  id               uuid primary key default gen_random_uuid(),
  apple_product_id text unique not null,
  name             text not null,
  tokens           integer not null check (tokens > 0),
  bonus_tokens     integer not null default 0 check (bonus_tokens >= 0),
  price_cents      integer not null default 0,
  currency         text not null default 'USD',
  sort_order       integer not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.token_catalog enable row level security;
drop policy if exists token_catalog_read on public.token_catalog;
create policy token_catalog_read on public.token_catalog
  for select to authenticated using (true);

-- The single credit primitive. Idempotent on (reason, ref): re-crediting the
-- same ref is a no-op returning the current balance.
create or replace function public.fn_token_credit(
  p_user   uuid,
  p_amount integer,
  p_reason text,
  p_ref    text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'credit must be positive';
  end if;

  begin
    insert into public.user_wallet as w (user_id, balance)
    values (p_user, p_amount)
    on conflict (user_id) do update
      set balance = w.balance + excluded.balance, updated_at = now()
    returning balance into v_balance;

    insert into public.token_ledger (user_id, delta, balance_after, reason, ref)
    values (p_user, p_amount, v_balance, p_reason, p_ref);
  exception when unique_violation then
    -- (reason, ref) already credited: nested block rolls back, wallet untouched.
    select balance into v_balance from public.user_wallet where user_id = p_user;
  end;

  return coalesce(v_balance, 0);
end;
$$;

revoke execute on function public.fn_token_credit(uuid, integer, text, text) from public;
grant execute on function public.fn_token_credit(uuid, integer, text, text) to service_role;

-- Grant tokens on subscription activation and each renewal.
create or replace function public.grant_subscription_tokens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens integer;
  v_ref text;
begin
  if new.status <> 'ACTIVE' or new.subscription_catalog_id is null then
    return new;
  end if;

  select tokens_granted into v_tokens
  from public.subscription_catalog
  where id = new.subscription_catalog_id;

  if coalesce(v_tokens, 0) <= 0 then
    return new;
  end if;

  v_ref := new.id::text || ':' || coalesce(new.current_period_start::text, 'once');

  -- Token accounting must NEVER abort the purchase-verify / webhook transaction
  -- that fired this trigger. Swallow + log any failure; the entitlement fetch
  -- reconciles later if a grant is ever missed.
  begin
    perform public.fn_token_credit(new.user_id, v_tokens, 'subscription_grant', v_ref);
  exception when others then
    raise warning 'grant_subscription_tokens failed for sub %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists on_subscription_active_grant_tokens on public.subscription;
create trigger on_subscription_active_grant_tokens
after insert or update of status, current_period_start on public.subscription
for each row
execute function public.grant_subscription_tokens();

-- Free-tier grant for every new real user.
create or replace function public.grant_signup_tokens()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens integer;
begin
  if coalesce(new.is_digital_human, false) then
    return new;
  end if;

  select tokens_granted into v_tokens
  from public.subscription_catalog
  where apple_product_id = 'amber.subscription.free';

  -- This runs INSIDE the auth-signup transaction (public.users is created by
  -- the on_auth_user_created trigger). A failure here would abort signup, so
  -- swallow + log — a missing grant is recoverable, a blocked signup is not.
  if coalesce(v_tokens, 0) > 0 then
    begin
      perform public.fn_token_credit(new.userid, v_tokens, 'signup_grant', new.userid::text);
    exception when others then
      raise warning 'grant_signup_tokens failed for user %: %', new.userid, sqlerrm;
    end;
  end if;
  return new;
end;
$$;

drop trigger if exists on_user_created_grant_tokens on public.users;
create trigger on_user_created_grant_tokens
after insert on public.users
for each row
execute function public.grant_signup_tokens();

-- Atomic gift send: membership + block checks, wallet debit (row lock,
-- balance >= cost), gift message insert (type='gift', content = JSON
-- {gift,name,cost} snapshotted at send time), ledger row, intimacy bump by the
-- token cost (clamped to 100). Raises 'insufficient_tokens' so the client can
-- branch to the token paywall.
create or replace function public.rpc_send_gift(
  p_match_id uuid,
  p_gift_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender   uuid := auth.uid();
  v_receiver uuid;
  a uuid;
  b uuid;
  v_gift    public.gift_catalog;
  v_balance integer;
  v_msg     public.messages;
begin
  if v_sender is null then
    raise exception 'not authenticated';
  end if;

  select user_a, user_b into a, b
  from public.user_matches
  where id = p_match_id;

  if not found then
    raise exception 'match not found';
  end if;

  if v_sender = a then
    v_receiver := b;
  elsif v_sender = b then
    v_receiver := a;
  else
    raise exception 'sender not in match';
  end if;

  if exists (
    select 1 from public.blocks bl
    where (bl.blocker_id = v_sender and bl.blocked_id = v_receiver)
       or (bl.blocker_id = v_receiver and bl.blocked_id = v_sender)
  ) then
    raise exception 'cannot send gift: blocked';
  end if;

  select * into v_gift
  from public.gift_catalog
  where key = p_gift_key and active;

  if not found then
    raise exception 'unknown gift';
  end if;

  update public.user_wallet
     set balance = balance - v_gift.cost_tokens,
         updated_at = now()
   where user_id = v_sender
     and balance >= v_gift.cost_tokens
  returning balance into v_balance;

  if not found then
    raise exception 'insufficient_tokens';
  end if;

  insert into public.messages (match_id, sender_id, receiver_id, content, type)
  values (
    p_match_id, v_sender, v_receiver,
    jsonb_build_object('gift', v_gift.key, 'name', v_gift.name, 'cost', v_gift.cost_tokens)::text,
    'gift'
  )
  returning * into v_msg;

  insert into public.token_ledger (user_id, delta, balance_after, reason, ref)
  values (v_sender, -v_gift.cost_tokens, v_balance, 'gift_send', v_msg.id::text);

  update public.user_match_ai_state
     set intimacy_score      = least(100, coalesce(intimacy_score, 0) + v_gift.cost_tokens),
         intimacy_updated_at = now()
   where match_id = p_match_id;

  return jsonb_build_object('message', to_jsonb(v_msg), 'balance', v_balance);
end;
$$;

revoke execute on function public.rpc_send_gift(uuid, text) from public;
grant execute on function public.rpc_send_gift(uuid, text) to authenticated;

create or replace function public.rpc_get_token_balance()
returns integer
language sql
security invoker
stable
as $$
  select coalesce(
    (select balance from public.user_wallet where user_id = auth.uid()),
    0
  );
$$;

grant execute on function public.rpc_get_token_balance() to authenticated;
