-- ============================================================
-- Migration: DH chat image inventory + per-conversation sent ledger
-- ============================================================
-- Some digital humans have preserved selfies in storage under
--   images/{dh_user_id}/chat_images/pic_N.{jpg,png}
-- These tables let a DH send those selfies into a conversation as intimacy
-- grows, releasing them in order (pic_1, pic_2, ...) and never repeating one
-- within the same match.

-- 1. Inventory (one row per storage object)
create table if not exists public.dh_chat_images (
  id uuid primary key default gen_random_uuid(),
  dh_user_id uuid not null references public.users(userid) on delete cascade,
  storage_path text not null unique,
  public_url text not null,
  ordinal int not null default 0,        -- release order, parsed from pic_N
  caption text,                          -- vision-generated at ingest (nullable; backfilled later)
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists dh_chat_images_dh_idx on public.dh_chat_images (dh_user_id, ordinal);

-- 2. Per-conversation ledger: guarantees a DH never sends the same selfie twice
--    in a match (PK on match_id + image_id).
create table if not exists public.dh_sent_images (
  match_id uuid not null references public.user_matches(id) on delete cascade,
  image_id uuid not null references public.dh_chat_images(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  sent_at timestamptz not null default now(),
  primary key (match_id, image_id)
);
create index if not exists dh_sent_images_match_idx on public.dh_sent_images (match_id);

-- 3. Lock down: only the service role (bypasses RLS) reads/writes these.
alter table public.dh_chat_images enable row level security;
alter table public.dh_sent_images enable row level security;

-- 4. Backfill / sync inventory from storage (idempotent — safe to re-run as
--    admins add more selfies). ordinal parsed from the digits in pic_N.
insert into public.dh_chat_images (dh_user_id, storage_path, public_url, ordinal)
select
  split_part(o.name, '/', 1)::uuid as dh_user_id,
  o.name as storage_path,
  'https://wvcwvjlmnjnvyblrycxj.supabase.co/storage/v1/object/public/images/' || o.name as public_url,
  coalesce(nullif(regexp_replace(split_part(o.name, '/', 3), '[^0-9]', '', 'g'), ''), '0')::int as ordinal
from storage.objects o
join public.users u on u.userid::text = split_part(o.name, '/', 1)
where o.bucket_id = 'images'
  and o.name like '%/chat_images/%'
  and u.is_digital_human = true
on conflict (storage_path) do nothing;
