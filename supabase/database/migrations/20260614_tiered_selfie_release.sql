-- ============================================================
-- Migration: Tiered DH selfie release controls
-- ============================================================
-- DH chat images now have an image_tier (casual -> tease -> reward). These
-- knobs let auto-reply choose the right tier as intimacy changes, and send an
-- early casual image when a new conversation is not warming up.

insert into public.digital_human_config (key, value, description) values
  ('selfie_tease_intimacy_threshold', '45',
   'Min intimacy score (0-100) where DH selfies move from casual to tease.'),
  ('selfie_reward_intimacy_threshold', '75',
   'Min intimacy score (0-100) where DH selfies move from tease to reward.'),
  ('selfie_early_casual_after_messages', '2',
   'Real-user message count after which a cold conversation may receive one proactive casual image.'),
  ('selfie_early_casual_max_intimacy', '45',
   'Max intimacy score for the early-casual image path; at/above this, normal tiered release takes over.'),
  ('intimacy_warmup_rate', 'normal',
   'How quickly the intimacy judge should let relationship score rise: very_low, low, normal, high, very_high, or extreme.')
on conflict (key) do nothing;
