-- ============================================================
-- Migration: users.whitelisted (admin-curated match-deck featuring)
-- ============================================================
-- Replaces the hardcoded / image-derived whitelist in rpc_get_matching_candidates
-- with an admin-toggled boolean. Admins flip it from a DH's detail page.

alter table public.users add column if not exists whitelisted boolean not null default false;
comment on column public.users.whitelisted is
  'Admin-curated: featured at the top of the match deck (rpc_get_matching_candidates).';

-- One-time seed (matches the prior image-rich featuring): DHs with >= 3 chat images.
-- Safe/idempotent; admins curate from here via the detail-page toggle.
update public.users
set whitelisted = true
where coalesce(is_digital_human, false) = true
  and deleted_at is null
  and userid in (
    select dh_user_id from public.dh_chat_images where active
    group by dh_user_id having count(*) >= 3
  );
