-- ============================================================
-- Migration: Personality-level digital human config overrides
-- ============================================================
-- Stores optional per-personality overrides for keys in digital_human_config.
-- When a personality has no row for a key, runtime falls back to the global
-- digital_human_config value and then to code defaults.

create table if not exists public.digital_human_personality_config (
  personality text not null,
  key text not null,
  value text not null,
  description text,
  updated_at timestamptz not null default now(),
  primary key (personality, key)
);

create index if not exists digital_human_personality_config_personality_idx
  on public.digital_human_personality_config (personality);

drop trigger if exists digital_human_personality_config_set_updated_at
  on public.digital_human_personality_config;
create trigger digital_human_personality_config_set_updated_at
before update on public.digital_human_personality_config
for each row
execute function public.set_updated_at();
