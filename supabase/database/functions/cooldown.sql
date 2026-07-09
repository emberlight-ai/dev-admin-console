-- Cooldown mode: cap token spend for unlimited-membership users. Once a user
-- has sent `cooldown_message_threshold` messages (digital_human_config, default
-- 200), only their top-N (default 2) busiest DH conversations keep replying;
-- the rest are muted per-match via user_match_ai_state.dh_muted, which
-- dh-auto-reply, dh-followup and dh-greeting all read.
--
-- Entry/exit policy:
--   * Auto-entry (edge function) only fires for users with NO user_cooldown row,
--     so an admin exiting a user from cooldown sticks — no auto re-entry.
--   * Admins can enter/exit any user and mute/unmute individual matches from
--     the console; both go through the same RPC / column below.

-- ── The one entry/exit path (edge function, admin button, backfill) ──────────
create or replace function public.rpc_set_user_cooldown(
  p_user_id uuid,
  p_active boolean,
  p_reason text default 'manual',
  p_keep_count integer default 2
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer;
  v_kept uuid[];
begin
  if not p_active then
    update public.user_cooldown
      set active = false, exited_at = now(), updated_at = now()
      where user_id = p_user_id;
    update public.user_match_ai_state
      set dh_muted = false
      where real_user_id = p_user_id and dh_muted;
    return jsonb_build_object('active', false);
  end if;

  select count(*) into v_total from public.messages where sender_id = p_user_id;

  insert into public.user_cooldown (user_id, active, reason, message_count_at_entry, entered_at, exited_at, updated_at)
  values (p_user_id, true, p_reason, v_total, now(), null, now())
  on conflict (user_id) do update
    set active = true,
        reason = excluded.reason,
        message_count_at_entry = excluded.message_count_at_entry,
        entered_at = now(),
        exited_at = null,
        updated_at = now();

  -- Keep the busiest DH conversations (total messages in the match), mute the rest.
  select coalesce(array_agg(match_id), '{}') into v_kept from (
    select s.match_id
    from public.user_match_ai_state s
    left join public.messages m on m.match_id = s.match_id
    where s.real_user_id = p_user_id
    group by s.match_id
    order by count(m.id) desc, s.match_id
    limit greatest(p_keep_count, 0)
  ) top_matches;

  update public.user_match_ai_state s
    set dh_muted = (s.match_id <> all (v_kept))
    where s.real_user_id = p_user_id;

  return jsonb_build_object('active', true, 'kept_match_ids', to_jsonb(v_kept), 'message_count', v_total);
end;
$$;

revoke execute on function public.rpc_set_user_cooldown(uuid, boolean, text, integer) from public, anon, authenticated;
grant execute on function public.rpc_set_user_cooldown(uuid, boolean, text, integer) to service_role;

-- ── Admin: conversations with message counts (user detail history tab) ────────
create or replace function public.rpc_admin_user_conversations(p_user_id uuid)
returns table (
  match_id uuid,
  partner_id uuid,
  username text,
  avatar text,
  is_digital_human boolean,
  message_count bigint,
  dh_muted boolean
)
language sql
security definer
set search_path = public
as $$
  select
    um.id as match_id,
    p.userid as partner_id,
    p.username,
    p.avatar,
    p.is_digital_human,
    count(m.id) as message_count,
    coalesce(s.dh_muted, false) as dh_muted
  from public.user_matches um
  join public.users p
    on p.userid = case when um.user_a = p_user_id then um.user_b else um.user_a end
  left join public.messages m on m.match_id = um.id
  left join public.user_match_ai_state s on s.match_id = um.id
  where um.user_a = p_user_id or um.user_b = p_user_id
  group by um.id, p.userid, p.username, p.avatar, p.is_digital_human, s.dh_muted
  order by count(m.id) desc, um.id;
$$;

revoke execute on function public.rpc_admin_user_conversations(uuid) from public, anon, authenticated;
grant execute on function public.rpc_admin_user_conversations(uuid) to service_role;

-- ── New matches made DURING cooldown start muted ──────────────────────────────
-- Nearby invites etc. keep creating matches; without this they'd leak chatter
-- around the cooldown. Fires BEFORE INSERT on user_match_ai_state (the init
-- trigger in chat.sql always inserts with real_user_id set).
create or replace function public.set_ai_state_cooldown_mute()
returns trigger
language plpgsql
as $$
begin
  if new.real_user_id is not null and exists (
    select 1 from public.user_cooldown c where c.user_id = new.real_user_id and c.active
  ) then
    new.dh_muted := true;
  end if;
  return new;
end;
$$;

drop trigger if exists ai_state_cooldown_mute on public.user_match_ai_state;
create trigger ai_state_cooldown_mute
before insert on public.user_match_ai_state
for each row
execute function public.set_ai_state_cooldown_mute();
