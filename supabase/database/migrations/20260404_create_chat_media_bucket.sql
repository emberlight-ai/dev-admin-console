-- ============================================================
-- Migration: Create chat_media bucket
-- ============================================================

-- 1. Create the bucket
insert into storage.buckets (id, name, public)
values ('chat_media', 'chat_media', true)
on conflict (id) do nothing;

-- 2. Restrict access (RLS)
-- Enable RLS on storage.objects for this bucket
-- (It's already enabled by default in Supabase, but strictly applying our policies)
create policy "chat_media_select_all"
on storage.objects for select
using ( bucket_id = 'chat_media' );

create policy "chat_media_insert_auth"
on storage.objects for insert
with check (
  bucket_id = 'chat_media' and
  auth.uid() is not null
);

-- Note: No update/delete policies added for now. Images are immutable.
