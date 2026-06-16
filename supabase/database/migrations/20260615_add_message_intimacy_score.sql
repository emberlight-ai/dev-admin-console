-- ============================================================
-- Migration: Store per-message intimacy score
-- ============================================================
-- Captures the current conversation intimacy on generated DH messages so the
-- admin console can show what score the auto-reply logic saw at send time.

alter table public.messages
  add column if not exists intimacy_score double precision;
