-- 2026-08-06 · Premium gift shelf
--
-- Only the Lollipop stays free. Every other gift becomes a perk of the
-- membership: the tray shows it with a PREMIUM badge, and rpc_send_gift
-- refuses it with 'premium_required' for anyone without an ACTIVE
-- subscription.
--
-- The free/paid split lives on the CATALOG ROW (`free_for_all`), not in the
-- app: one admin toggle changes which gift is the free sample, and the same
-- source of truth backs both the tray's lock state and the server's refusal.
-- A client-side gate alone would be cosmetic — the RPC is callable directly.
--
-- This file also folds in the free-gift state that was applied straight to
-- production when the consumable token IAP was pulled for App Review
-- (cost_tokens forced to 0, the pre-free price preserved in
-- cost_tokens_paid). That change never made it back into
-- functions/tokens.sql, so the function body below — not that file — was the
-- only accurate record of what production ran.

-- ── 1. The free/premium split ────────────────────────────────────────────────

alter table public.gift_catalog
  add column if not exists free_for_all boolean not null default false;

comment on column public.gift_catalog.free_for_all is
  'True = anyone can send this gift. False = membership only; rpc_send_gift raises premium_required. Independent of cost_tokens, which is 0 for every gift while the token IAP is out.';

-- Assignment, not an OR: re-running this must not silently widen the free set.
update public.gift_catalog set free_for_all = (key = 'lollipop');

-- ── 2. rpc_send_gift — membership gate ───────────────────────────────────────

-- Atomic gift send: membership + block checks, the premium gate, wallet debit
-- (row lock, balance >= cost), gift message insert (type='gift', content =
-- JSON {gift,name,cost} snapshotted at send time), ledger row, intimacy bump.
-- Raises 'insufficient_tokens' (→ 402) and 'premium_required' (→ 403) so the
-- client can branch to the right paywall.
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

  -- Membership gate. Mirrors /api/ios/me/entitlement's definition of premium
  -- (an ACTIVE row that has not lapsed) so the tray's lock and this refusal
  -- can never disagree. Only the `free_for_all` gift skips it.
  if not v_gift.free_for_all then
    if not exists (
      select 1 from public.subscription s
      where s.user_id = v_sender
        and s.status = 'ACTIVE'
        and (s.current_period_end is null or s.current_period_end > now())
    ) then
      raise exception 'premium_required';
    end if;
  end if;

  if v_gift.cost_tokens > 0 then
    update public.user_wallet
       set balance = balance - v_gift.cost_tokens,
           updated_at = now()
     where user_id = v_sender
       and balance >= v_gift.cost_tokens
    returning balance into v_balance;

    if not found then
      raise exception 'insufficient_tokens';
    end if;
  else
    -- Free gift: report the current balance without moving it.
    select balance into v_balance from public.user_wallet where user_id = v_sender;
    v_balance := coalesce(v_balance, 0);
  end if;

  insert into public.messages (match_id, sender_id, receiver_id, content, type)
  values (
    p_match_id, v_sender, v_receiver,
    jsonb_build_object('gift', v_gift.key, 'name', v_gift.name, 'cost', v_gift.cost_tokens)::text,
    'gift'
  )
  returning * into v_msg;

  if v_gift.cost_tokens > 0 then
    insert into public.token_ledger (user_id, delta, balance_after, reason, ref)
    values (v_sender, -v_gift.cost_tokens, v_balance, 'gift_send', v_msg.id::text);
  end if;

  -- Intimacy previously scaled with the gift's price; with free gifts that would
  -- always be 0, so a flat bump keeps the signal alive.
  update public.user_match_ai_state
     set intimacy_score      = least(100, coalesce(intimacy_score, 0)
                                        + greatest(v_gift.cost_tokens, 5)),
         intimacy_updated_at = now()
   where match_id = p_match_id;

  return jsonb_build_object('message', to_jsonb(v_msg), 'balance', v_balance);
end;
$$;

revoke execute on function public.rpc_send_gift(uuid, text) from public;
grant execute on function public.rpc_send_gift(uuid, text) to authenticated;
