-- User content archive on delete — manual migration (2026-07-07).
-- Run once against production (SQL editor / psql). Idempotent (create if not exists).
-- Source of truth: database/schema.sql (same block, kept in sync).

-- ==============================================================================
-- USER ARCHIVE — full content preserved on delete, out of the live app's reach
-- ==============================================================================
-- Business decision: this app is not GDPR-scoped and every user costs real
-- acquisition spend, so account deletion PRESERVES content (posts + photos,
-- matches, full chat transcripts) instead of destroying it. `account-reset.ts`
-- COPIES rows here (relational, not just the JSONB snapshot above) and moves
-- the underlying storage objects into an `archived/` folder in the same
-- bucket, BEFORE purgeUserContent() clears the live tables — so a returning
-- sign-in with the same identity still gets a genuinely blank account (the
-- live tables are empty), while the admin console can browse everything that
-- ever happened on it. Service-role only; never read by the app.
create table if not exists public.archived_user_posts (
  id uuid primary key,                 -- original user_posts.id
  deleted_user_id uuid not null,
  photos text[] not null default '{}', -- rewritten to the archived/ storage path
  description text,
  location_name text,
  longitude double precision,
  latitude double precision,
  altitude double precision,
  occurred_at timestamptz,
  created_at timestamptz,
  archived_at timestamptz not null default now()
);
create index if not exists archived_user_posts_deleted_user_id_idx
  on public.archived_user_posts (deleted_user_id);

create table if not exists public.archived_user_matches (
  id uuid primary key,                 -- original user_matches.id
  deleted_user_id uuid not null,       -- whose deletion triggered this archive
  other_user_id uuid,                  -- the counterpart in the match
  other_username text,                 -- snapshot, in case they later delete/change too
  other_avatar text,
  created_at timestamptz,
  archived_at timestamptz not null default now()
);
create index if not exists archived_user_matches_deleted_user_id_idx
  on public.archived_user_matches (deleted_user_id);

create table if not exists public.archived_messages (
  id uuid primary key,                 -- original messages.id
  match_id uuid not null,              -- references archived_user_matches.id informally
  deleted_user_id uuid not null,
  sender_id uuid,
  receiver_id uuid,
  content text,
  media_url text,                      -- rewritten to the archived/ storage path
  image_desc text,
  intimacy_score double precision,
  created_at timestamptz,
  archived_at timestamptz not null default now()
);
create index if not exists archived_messages_deleted_user_id_idx
  on public.archived_messages (deleted_user_id);
create index if not exists archived_messages_match_id_idx
  on public.archived_messages (match_id);

alter table public.archived_user_posts enable row level security;
alter table public.archived_user_matches enable row level security;
alter table public.archived_messages enable row level security;
-- No policies by default: service-role/admin tooling only, same as user_deletion_audit.
