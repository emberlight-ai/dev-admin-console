-- ============================================================
-- Migration: Intimacy state (Adam-style momentum) + selfie config
-- ============================================================
-- Adds a per-conversation intimacy signal to user_match_ai_state. A "referee"
-- LLM scores closeness 0-100 each turn; we keep an Adam-style momentum
-- (1st moment m = velocity, 2nd moment v = variance) so cadence and selfie
-- sends can react to the *trend*, not just the level.

alter table public.user_match_ai_state
  add column if not exists intimacy_score double precision,                 -- latest critic score 0..100
  add column if not exists intimacy_m double precision not null default 0,  -- Adam 1st moment (EMA of gradient)
  add column if not exists intimacy_v double precision not null default 0,  -- Adam 2nd moment (EMA of gradient^2)
  add column if not exists intimacy_updated_at timestamptz,
  add column if not exists last_selfie_sent_at timestamptz;                 -- selfie cooldown per match

-- Admin-tunable knobs for the selfie feature (same table as other DH config).
insert into public.digital_human_config (key, value, description) values
  ('enable_digital_human_selfies', 'true', 'Allow DHs to send preserved selfies when intimacy is high enough'),
  ('selfie_intimacy_threshold', '55', 'Min intimacy score (0-100) before a DH may send a selfie'),
  ('selfie_cooldown_hours', '3', 'Min hours between selfies a DH sends within one conversation')
on conflict (key) do nothing;
