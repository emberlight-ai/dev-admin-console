-- ============================================================
-- Migration: Proactive double-text config
-- ============================================================
-- When intimacy momentum (Adam drive = m/sqrt(v)) is hot, dh-followup reaches
-- out again sooner and is allowed more messages (eager); when cold it backs off.

insert into public.digital_human_config (key, value, description) values
  ('enable_proactive_double_text', 'true', 'Allow DHs to proactively double-text (reach out again before the user replies) when intimacy momentum is hot'),
  ('proactive_intimacy_drive_threshold', '0.3', 'Momentum "drive" (m/sqrt(v), ~-1..1) at/above which a conversation counts as hot for proactive outreach'),
  ('proactive_delay_minutes', '90', 'How soon a hot conversation gets a proactive double-text after the DH''s last message (minutes)'),
  ('proactive_extra_followups', '2', 'Extra follow-up messages granted beyond the per-bot max when a conversation is hot')
on conflict (key) do nothing;
