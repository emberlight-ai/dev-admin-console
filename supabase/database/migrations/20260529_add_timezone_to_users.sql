-- ============================================================
-- Migration: Add timezone to users
-- ============================================================
-- Stores the IANA timezone (e.g. America/Chicago) derived from the user's
-- lat/long. Lets DH edge functions compute the user's *local* time + apply
-- per-user quiet hours, instead of asking the model to convert UTC via zipcode
-- (which is only ~25% populated and unreliable for an LLM to reason about).
--
-- Backfill is done out-of-band (lat/long -> IANA via tz-lookup). Edge functions
-- fall back to a runtime lat/long lookup when this column is null, so it is
-- safe for this to be sparse.

alter table public.users add column if not exists timezone text;

comment on column public.users.timezone is
  'IANA timezone (e.g. America/Chicago), derived from lat/long. Used for local-time-aware DH messaging + quiet hours.';
