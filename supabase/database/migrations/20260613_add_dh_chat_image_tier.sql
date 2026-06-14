-- ============================================================
-- Migration: DH chat image tier
-- ============================================================
-- Classifies preserved DH chat images so release logic and admin tooling can
-- distinguish ordinary images from higher-intent assets.

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'dh_image_tier'
  ) then
    create type public.dh_image_tier as enum (
      'unspecified',
      'casual',
      'tease',
      'reward'
    );
  end if;
end
$$;

alter table public.dh_chat_images
  add column if not exists image_tier public.dh_image_tier not null default 'unspecified';

create index if not exists dh_chat_images_dh_tier_ordinal_idx
  on public.dh_chat_images (dh_user_id, image_tier, ordinal);
