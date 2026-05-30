-- ============================================================
-- Migration: Drop SystemPrompts.response_delay
-- ============================================================
-- The fixed pre-reply delay is replaced by a NATURAL typing delay computed in
-- dh-auto-reply (response length / ~40 WPM, minus time already spent generating).
-- The old `scheduled_response_at` + per-minute `dh-scheduled-replies` cron
-- mechanism is gone.
--
-- ⚠️  APPLY ONLY AFTER the edge functions + web app are deployed without
--     response_delay in their queries — the previously-deployed code still
--     `select`s this column and would error if it disappears first.

alter table public."SystemPrompts" drop column if exists response_delay;
