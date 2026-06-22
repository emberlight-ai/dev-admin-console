-- ============================================================
-- Migration: Per-personality reply pacing + human-like silence
-- ============================================================
-- Adds two groups of knobs to SystemPrompts, both read by the dh-auto-reply
-- edge function:
--   1. Reply pacing — how long a digital human "takes" to send a reply, scaled
--      by the reply length (min floor so it's never instant, max cap, and a
--      chars/second rate that controls how much length stretches the wait).
--   2. Human-like silence — a chance the DH chooses not to reply at all,
--      elevated when the user's message dropped the conversation's intimacy.

alter table public."SystemPrompts"
  add column if not exists reply_min_delay_seconds integer default 2,
  add column if not exists reply_max_delay_seconds integer default 18,
  add column if not exists reply_chars_per_second numeric default 15,
  add column if not exists skip_reply_enabled boolean not null default false,
  add column if not exists skip_reply_base_chance numeric default 0.10,
  add column if not exists skip_reply_intimacy_drop_chance numeric default 0.50,
  add column if not exists skip_reply_intimacy_drop_delta numeric default 5,
  add column if not exists skip_reply_max_consecutive integer default 1;
