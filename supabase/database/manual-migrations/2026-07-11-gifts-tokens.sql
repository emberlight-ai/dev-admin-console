-- ═══════════════════════════════════════════════════════════════════════════
-- Gifts & Tokens (ARPPU layer)
-- Applied: 2026-07-11 via Supabase MCP (project wvcwvjlmnjnvyblrycxj)
--
-- Adds:
--   1. messages.type ('text' | 'image' | 'gift') + backfill + derive-on-insert
--   2. gift_catalog          — server-authoritative gift pricing
--   3. user_wallet           — cached token balance (fast, row-locked debits)
--      token_ledger          — append-only audit trail (source of truth)
--   4. fn_token_credit       — idempotent credit primitive (service-role/triggers)
--   5. token_catalog         — consumable IAP packs (+ bonus for promos)
--   6. subscription_catalog.tokens_granted + per-period grant trigger
--   7. signup grant trigger + one-time backfill for existing real users
--   8. rpc_send_gift         — atomic debit + gift message + intimacy bump
--   9. rpc_get_token_balance
--  10. user_match_ai_state.intimacy_drive (generated) + column docs
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. messages.type ─────────────────────────────────────────────────────────
alter table public.messages
  add column if not exists type text not null default 'text';

do $$ begin
  alter table public.messages
    add constraint messages_type_check check (type in ('text','image','gift'));
exception when duplicate_object then null; end $$;

-- Backfill: image = media only (no caption); everything else stays 'text'.
update public.messages
   set type = 'image'
 where media_url is not null
   and (content is null or btrim(content) = '')
   and type = 'text';

-- Derive type on every insert path (legacy clients, edge fns) without touching
-- callers. 'gift' is only ever set explicitly by rpc_send_gift.
create or replace function public.set_message_type()
returns trigger
language plpgsql
as $$
begin
  if new.type is null then
    new.type := 'text';
  end if;
  if new.type <> 'gift'
     and new.media_url is not null
     and (new.content is null or btrim(new.content) = '') then
    new.type := 'image';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_set_type on public.messages;
create trigger messages_set_type
before insert on public.messages
for each row
execute function public.set_message_type();

-- ── 2. gift_catalog ──────────────────────────────────────────────────────────
create table if not exists public.gift_catalog (
  key         text primary key,
  name        text not null,
  asset       text not null,               -- iOS asset name
  cost_tokens integer not null check (cost_tokens > 0),
  sort_order  integer not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

insert into public.gift_catalog (key, name, asset, cost_tokens, sort_order) values
  ('lollipop',    'Lollipop',     'gift-lolipop',     10,   1),
  ('macarons',    'Macarons',     'gift-macarons',    20,   2),
  ('single_rose', 'Rose',         'gift-single-rose', 20,   3),
  ('teddy_bear',  'Teddy Bear',   'gift-teddybear',   50,   4),
  ('roses',       'Rose Bouquet', 'gift-roses',       200,  5),
  ('ring',        'Diamond Ring', 'gift-ring',        1000, 6)
on conflict (key) do update
  set name = excluded.name, asset = excluded.asset,
      cost_tokens = excluded.cost_tokens, sort_order = excluded.sort_order;

alter table public.gift_catalog enable row level security;
drop policy if exists gift_catalog_read on public.gift_catalog;
create policy gift_catalog_read on public.gift_catalog
  for select to authenticated using (true);

-- ── 3. wallet + ledger ───────────────────────────────────────────────────────
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

-- ── 4. fn_token_credit ───────────────────────────────────────────────────────
-- The single credit primitive. Idempotent on (reason, ref): re-crediting the
-- same ref is a no-op returning the current balance (Apple retries, webhook
-- replays, backfills). Debits live in rpc_send_gift (needs balance>=cost lock).
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
    -- (reason, ref) already credited: whole nested block rolls back, wallet
    -- untouched. Return current balance.
    select balance into v_balance from public.user_wallet where user_id = p_user;
  end;

  return coalesce(v_balance, 0);
end;
$$;

revoke execute on function public.fn_token_credit(uuid, integer, text, text) from public;
grant execute on function public.fn_token_credit(uuid, integer, text, text) to service_role;

-- ── 5. token_catalog (consumable IAP packs) ──────────────────────────────────
-- price_cents is the reference/list price (StoreKit's live price is what the
-- client displays). bonus_tokens > 0 renders as "N + bonus" — the launch promo
-- matches the "200+200 (50% off)" framing; zero it to end the promo.
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

insert into public.token_catalog (apple_product_id, name, tokens, bonus_tokens, price_cents, sort_order) values
  ('200_amber_tokens',  '200 Tokens',  200,  200,  199,  1),
  ('500_amber_tokens',  '500 Tokens',  500,  500,  499,  2),
  ('1000_amber_tokens', '1000 Tokens', 1000, 1000, 999,  3),
  ('2000_amber_tokens', '2000 Tokens', 2000, 2000, 1999, 4),
  ('3000_amber_tokens', '3000 Tokens', 3000, 3000, 2999, 5),
  ('5000_amber_tokens', '5000 Tokens', 5000, 5000, 4999, 6)
on conflict (apple_product_id) do update
  set tokens = excluded.tokens, name = excluded.name, sort_order = excluded.sort_order;

alter table public.token_catalog enable row level security;
drop policy if exists token_catalog_read on public.token_catalog;
create policy token_catalog_read on public.token_catalog
  for select to authenticated using (true);

-- ── 6. subscription token grants ─────────────────────────────────────────────
alter table public.subscription_catalog
  add column if not exists tokens_granted integer not null default 0;

update public.subscription_catalog set tokens_granted = 20
  where apple_product_id = 'amber.subscription.free';
update public.subscription_catalog set tokens_granted = 100
  where apple_product_id = 'amber.premium.monthly.0.0';
update public.subscription_catalog set tokens_granted = 5000
  where apple_product_id = 'amber.premium.yearly.0.0';

-- Grant on activation and on each renewal: ref = subscription id + period
-- start, so re-verifies of the same period are no-ops but every new period
-- grants once.
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

-- ── 7. signup grant (free tier) ──────────────────────────────────────────────
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

-- One-time backfill: every existing real user gets the free-tier grant
-- (idempotent — ref is the userid).
select public.fn_token_credit(u.userid, 20, 'signup_grant', u.userid::text)
from public.users u
where coalesce(u.is_digital_human, false) = false
  and u.deleted_at is null;

-- ── 8. rpc_send_gift ─────────────────────────────────────────────────────────
-- Atomic: validates membership + blocks, debits the wallet (row lock,
-- balance >= cost), inserts the gift message (type='gift', content = JSON
-- {gift,name,cost}), writes the ledger row, bumps intimacy by the token cost
-- (clamped to 100). Raises 'insufficient_tokens' for the client paywall branch.
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

-- ── 9. rpc_get_token_balance ─────────────────────────────────────────────────
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

-- ── 10. intimacy cleanup ─────────────────────────────────────────────────────
-- intimacy_score stays THE canonical value. m/v are the internal state of the
-- trend estimator (Adam moments) — consumers should read the derived
-- intimacy_drive instead of recomputing m/(sqrt(v)+eps) by hand.
alter table public.user_match_ai_state
  add column if not exists intimacy_drive double precision
  generated always as (
    case
      when intimacy_m is null or intimacy_v is null then 0
      else intimacy_m / (sqrt(greatest(intimacy_v, 0)) + 0.001)
    end
  ) stored;

comment on column public.user_match_ai_state.intimacy_score is
  'CANONICAL closeness, 0-100. Written by the dh-auto-reply critic each turn and bumped by rpc_send_gift (+token cost, clamped). All product logic (selfie tiers, tool gating) reads this.';
comment on column public.user_match_ai_state.intimacy_m is
  'INTERNAL trend-estimator state: EMA of score deltas (Adam 1st moment). Written by adamStep in dh-auto-reply. Do not read directly — use intimacy_drive.';
comment on column public.user_match_ai_state.intimacy_v is
  'INTERNAL trend-estimator state: EMA of squared score deltas (Adam 2nd moment). Written by adamStep in dh-auto-reply. Do not read directly — use intimacy_drive.';
comment on column public.user_match_ai_state.intimacy_drive is
  'DERIVED trend, ~[-1,1]: m/(sqrt(v)+0.001). Positive = conversation warming, negative = cooling. Generated column — read this instead of intimacy_m/intimacy_v (dh-followup cadence uses it).';
comment on column public.messages.intimacy_score is
  'Snapshot of the critic''s intimacy at the time a DH message was sent (audit trail). NULL for real-user messages.';
