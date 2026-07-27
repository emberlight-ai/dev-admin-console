-- 2026-07-27 · Personality rename (coaching pivot)
--
-- The persona names were dating-era. Renamed to the coaching verticals users
-- actually pick from. `personality` is a cross-table JOIN KEY (SystemPrompts ×
-- users × digital_human_personality_config), so every rename goes through
-- rpc_rename_personality, which updates all three in one transaction:
--
--   SystemPrompts  (gender, personality)  → the prompt templates
--   users          (DHs only, gender-scoped) → who resolves to that template
--   digital_human_personality_config       → per-persona overrides, moved only
--                                            once no prompt rows keep the old
--                                            name (so multi-gender personas
--                                            can't lose their config midway)
--
-- Pre-flight (verified 2026-07-27): each of the six is single-gender, DH
-- genders match the prompt gender exactly, NO real users carry them, and no
-- target name collides with an existing persona.
--
--   sexy            → Yoga          (Female · 21 prompts · 16 DHs · 5 configs)
--   Sluty bitch     → Bodybuilding  (Female · 89 prompts · 39 DHs · 6 configs)
--   Trickster       → Fortune       (Female · 84 prompts · 42 DHs)
--   protective&nice → Manifest      (Female · 32 prompts · 30 DHs)
--   black woman     → DIY           (Female · 14 prompts · 19 DHs)
--   Lazyass         → Chill         (Male   · 14 prompts · 19 DHs)
--
-- `user_public_profiles` is a VIEW over users — it follows automatically.
-- Reversible: call the same RPC with old/new swapped.

select public.rpc_rename_personality('Female', 'sexy',            'Yoga');
select public.rpc_rename_personality('Female', 'Sluty bitch',     'Bodybuilding');
select public.rpc_rename_personality('Female', 'Trickster',       'Fortune');
select public.rpc_rename_personality('Female', 'protective&nice', 'Manifest');
select public.rpc_rename_personality('Female', 'black woman',     'DIY');
select public.rpc_rename_personality('Male',   'Lazyass',         'Chill');
