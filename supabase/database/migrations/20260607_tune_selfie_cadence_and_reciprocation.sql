-- ============================================================
-- Migration: Tune selfie cadence + reciprocate on user images
-- ============================================================
-- The old `selfie_cooldown_hours` (3h) meant a DH sent at most ONE selfie per
-- conversation: after the first send, `last_selfie_sent_at` is set and the 3h
-- gate blocked every later selfie even as the user kept chatting. (In prod,
-- 6 of 7 matches that ever got a selfie were stuck at exactly 1, all with more
-- images still available.)
--
-- Fix, in dh-auto-reply:
--   • Spontaneous (intimacy-driven) selfies are now paced in MINUTES, so they
--     keep trickling out as the chat continues.
--   • A new "reciprocate" path lets the DH answer a user's photo with one of its
--     own (bypasses the intimacy threshold; short anti-spam gap only).
-- Progressive release (never repeat an image in a match) is still the hard cap,
-- so neither path can spam — a DH only has a handful of selfies.
--
-- NOTE: the code defaults to these values even if the rows are absent, so the
-- behaviour change ships with the function deploy; these rows just make the
-- knobs admin-tunable.

insert into public.digital_human_config (key, value, description) values
  ('selfie_cooldown_minutes', '30',
   'Min minutes between spontaneous (intimacy-driven) selfies a DH sends within one conversation. Replaces selfie_cooldown_hours.'),
  ('enable_selfie_reciprocation', 'true',
   'When the user sends a photo/selfie, let the DH reply with one of its own (bypasses the intimacy threshold).'),
  ('selfie_reciprocate_gap_minutes', '2',
   'Min minutes between selfies on the strong-cue path (user sent a pic or asked to see them) — just enough to avoid back-to-back sends.')
on conflict (key) do nothing;

-- Mark the legacy knob deprecated (kept for history; no longer read by code).
update public.digital_human_config
  set description = 'DEPRECATED 2026-06-07 — no longer read by dh-auto-reply. Replaced by selfie_cooldown_minutes.'
  where key = 'selfie_cooldown_hours';
