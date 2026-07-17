-- 2026-07-16 · post_likes (APPLIED to prod)
-- Real post likes: users write their own rows via RLS; display = synthetic
-- (DH popularity) + real count. Future reciprocity feature (DHs liking user
-- posts) inserts here via service role.
create table if not exists public.post_likes (
  post_id uuid not null references public.user_posts(id) on delete cascade,
  user_id uuid not null references public.users(userid) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists post_likes_user_idx on public.post_likes (user_id);
alter table public.post_likes enable row level security;
create policy post_likes_insert_own on public.post_likes
  for insert to authenticated with check (user_id = auth.uid());
create policy post_likes_delete_own on public.post_likes
  for delete to authenticated using (user_id = auth.uid());
create policy post_likes_select_own on public.post_likes
  for select to authenticated using (user_id = auth.uid());
