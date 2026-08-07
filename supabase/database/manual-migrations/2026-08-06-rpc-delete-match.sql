-- 2026-08-06 · rpc_delete_match — the function the app has always called
--
-- ConnectionService.deleteConnection has called `rpc_delete_match` since it
-- was written, and the function has never existed — not in this repo, not in
-- production. PostgREST answered 404, ConnectionsStore caught it and only
-- printed, and because the row had already been removed optimistically the
-- delete LOOKED like it worked. It came back on the next server refresh —
-- i.e. as soon as you left the tab and returned.
--
-- Semantics: an unmatch, not a per-user hide. `user_matches` has no
-- soft-delete column and every dependent table already cascades from it, so
-- removing the row is what the schema is built for; adding a hidden flag
-- would mean teaching every reader about it. The conversation therefore goes
-- for BOTH participants — the standard unmatch behaviour, and the reason the
-- app now confirms before calling this.
--
-- Cascades from user_matches (all ON DELETE CASCADE): messages,
-- user_match_ai_state, dh_coach_state, dh_coach_checkins, dh_sent_images.
--
-- Deliberately NOT cleaned up:
--   · archived_messages   — the deletion audit trail; wiping it would defeat
--                           the point of having one.
--   · shared_image_sends  — the per-USER photo dedup ledger. Keeping it stops
--     dh_opener_ledger      a DH re-sending the same photo or the same opener
--                           to someone who deleted the chat and matched again.
--   · dh_outbound_events  — append-only analytics.
--   · swipe rows          — someone you removed should not reappear in the deck.

create or replace function public.rpc_delete_match(match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  -- The membership predicate is the authorization check: a caller who is not
  -- in the match deletes nothing. It is silent by design — raising here would
  -- let anyone probe whether an arbitrary match id exists. A no-op is also the
  -- right answer for a retry or a second device that already deleted it: the
  -- caller's goal (this match not existing) holds either way.
  delete from public.user_matches um
   where um.id = match_id
     and (um.user_a = v_caller or um.user_b = v_caller);
end;
$$;

revoke execute on function public.rpc_delete_match(uuid) from public;
grant execute on function public.rpc_delete_match(uuid) to authenticated;
