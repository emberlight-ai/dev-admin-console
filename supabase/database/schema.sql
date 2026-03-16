-- Enable UUID extension
create extension if not exists "uuid-ossp";
-- Enable PostGIS for geospatial queries (range/bbox, distance, etc.)
create extension if not exists postgis;

-- updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Create User table
create table public.users (
  -- Align app user id to Supabase Auth user id for consistent identity + simple RLS.
  userid uuid primary key references auth.users(id) on delete cascade,
  -- Allow bootstrap on signup; app should prompt user to complete profile.
  username text not null default '',
  age integer,
  gender text,
  personality text,
  zipcode text,
  phone text,
  bio text,
  education text,
  profession text,
  avatar text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  is_digital_human boolean default false
);

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row
execute function public.set_updated_at();

-- Note: handle_new_auth_user moved to database/functions/auth_triggers.sql

-- Safe public profile projection for matched users (omit phone/zipcode, etc.)
create or replace view public.user_public_profiles as
select
  userid,
  username,
  age,
  gender,
  personality,
  profession,
  bio,
  education,
  avatar,
  created_at,
  updated_at,
  is_digital_human
from public.users
where deleted_at is null;

-- Create SystemPrompts table (versioned system prompt templates per gender + personality)
create table public."SystemPrompts" (
  id uuid primary key default uuid_generate_v4(),
  gender text not null,
  personality text not null,
  system_prompt text not null,
  response_delay integer default 0,
  immediate_match_enabled boolean not null default false,
  matching_enabled boolean default true,
  follow_up_message_enabled boolean default false,
  follow_up_message_prompt text,
  follow_up_delay integer default 86400, -- 24 hours in seconds
  max_follow_ups integer default 3,
  active_greeting_enabled boolean not null default false,
  active_greeting_prompt text,
  created_at timestamptz default now()
);

-- Fast lookup for newest prompt by (gender, personality)
create index if not exists systemprompts_gender_personality_created_at_idx
on public."SystemPrompts" (gender, personality, created_at desc);

-- Create UserPosts table
create table public.user_posts (
  id uuid primary key default uuid_generate_v4(),
  userid uuid references public.users(userid) on delete cascade not null,
  photos text[] not null default '{}',
  description text,
  location_name text,
  longitude double precision,
  latitude double precision,
  altitude double precision,
  occurred_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

drop trigger if exists user_posts_set_updated_at on public.user_posts;
create trigger user_posts_set_updated_at
before update on public.user_posts
for each row
execute function public.set_updated_at();

-- ==============================================================================
-- USER BALANCES & SUBSCRIPTION
-- ==============================================================================

create table if not exists public.user_balances (
  userid uuid primary key references public.users(userid) on delete cascade,
  free_msgs_today integer not null default 0,
  free_msgs_updated_date date,
  free_swipe_today integer not null default 0,
  free_swipe_updated_date date
);

-- Subscription: entitlement (iOS IAP + RTDN). One row per user.
create table if not exists public.user_subscription (
  userid uuid primary key references public.users(userid) on delete cascade,
  is_premium boolean not null default false,
  plan_id text,
  auto_renewal boolean not null default true,
  expires_at timestamptz,
  original_transaction_id text,
  environment text check (environment in ('Sandbox', 'Production')),
  product_id_apple text,
  updated_at timestamptz default now()
);
create index if not exists user_subscription_original_tx on public.user_subscription(original_transaction_id) where original_transaction_id is not null;
drop trigger if exists user_subscription_set_updated_at on public.user_subscription;
create trigger user_subscription_set_updated_at before update on public.user_subscription for each row execute function public.set_updated_at();

-- User ↔ Apple subscription (originalTransactionId → userid for RTDN).
create table if not exists public.apple_subscription_identifiers (
  userid uuid primary key references public.users(userid) on delete cascade,
  original_transaction_id text not null unique,
  environment text check (environment in ('Sandbox', 'Production')),
  bundle_id text,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz default now()
);
create index if not exists apple_subscription_identifiers_original_tx_id on public.apple_subscription_identifiers(original_transaction_id);

-- Revenue: one row per charge (apple_iap, manual, revenuecat).
create table if not exists public.subscription_purchases (
  id uuid primary key default uuid_generate_v4(),
  userid uuid references public.users(userid) on delete cascade not null,
  plan_id text not null,
  amount_cents integer not null,
  source text not null check (source in ('apple_iap', 'manual', 'revenuecat')),
  original_transaction_id text,
  transaction_id text,
  environment text,
  product_id_apple text,
  created_at timestamptz default now()
);
create index if not exists subscription_purchases_userid on public.subscription_purchases(userid);
create index if not exists subscription_purchases_created_at on public.subscription_purchases(created_at desc);
create index if not exists subscription_purchases_source on public.subscription_purchases(source);
create unique index if not exists subscription_purchases_apple_tx on public.subscription_purchases(transaction_id) where source = 'apple_iap' and transaction_id is not null;

-- RTDN event log (idempotency + audit).
create table if not exists public.apple_rtdn_events (
  id uuid primary key default uuid_generate_v4(),
  notification_uuid uuid not null unique,
  notification_type text not null,
  subtype text,
  environment text,
  bundle_id text,
  decoded_original_transaction_id text,
  decoded_transaction_id text,
  decoded_product_id text,
  decoded_expires_date_ms bigint,
  decoded_auto_renew_status integer,
  userid uuid references public.users(userid) on delete set null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists apple_rtdn_events_notification_uuid on public.apple_rtdn_events(notification_uuid);
create index if not exists apple_rtdn_events_original_tx on public.apple_rtdn_events(decoded_original_transaction_id);
create index if not exists apple_rtdn_events_created_at on public.apple_rtdn_events(created_at desc);

alter table public.user_subscription enable row level security;
alter table public.apple_subscription_identifiers enable row level security;
alter table public.subscription_purchases enable row level security;
alter table public.apple_rtdn_events enable row level security;
drop policy if exists user_subscription_select_owner on public.user_subscription;
create policy user_subscription_select_owner on public.user_subscription for select to authenticated using (userid = auth.uid());
drop policy if exists user_subscription_insert_owner on public.user_subscription;
create policy user_subscription_insert_owner on public.user_subscription for insert to authenticated with check (userid = auth.uid());
drop policy if exists user_subscription_update_owner on public.user_subscription;
create policy user_subscription_update_owner on public.user_subscription for update to authenticated using (userid = auth.uid());
drop policy if exists apple_subscription_identifiers_select_owner on public.apple_subscription_identifiers;
create policy apple_subscription_identifiers_select_owner on public.apple_subscription_identifiers for select to authenticated using (userid = auth.uid());
drop policy if exists apple_subscription_identifiers_insert_owner on public.apple_subscription_identifiers;
create policy apple_subscription_identifiers_insert_owner on public.apple_subscription_identifiers for insert to authenticated with check (userid = auth.uid());
drop policy if exists apple_subscription_identifiers_update_owner on public.apple_subscription_identifiers;
create policy apple_subscription_identifiers_update_owner on public.apple_subscription_identifiers for update to authenticated using (userid = auth.uid());
drop policy if exists subscription_purchases_select_owner on public.subscription_purchases;
create policy subscription_purchases_select_owner on public.subscription_purchases for select to authenticated using (userid = auth.uid());

-- ---------------------------------------------------------------------------
-- Row Level Security (RLS)
-- - Reads: any authenticated user can read profiles/posts (excluding soft-deleted rows)
-- - Writes: only the owner (userid = auth.uid())
-- ---------------------------------------------------------------------------

alter table public.users enable row level security;
alter table public.user_posts enable row level security;

drop policy if exists users_read_authenticated on public.users;
drop policy if exists "Public read profiles" on public.users;
create policy "Public read profiles" on public.users
  for select
  to public
  using (deleted_at is null);

drop policy if exists users_insert_owner on public.users;
create policy users_insert_owner
on public.users
for insert
to authenticated
with check (userid = auth.uid());

drop policy if exists users_update_owner on public.users;
create policy users_update_owner
on public.users
for update
to authenticated
using (userid = auth.uid() and deleted_at is null)
with check (userid = auth.uid());

drop policy if exists users_delete_owner on public.users;
create policy users_delete_owner
on public.users
for delete
to authenticated
using (userid = auth.uid());

drop policy if exists user_posts_read_authenticated on public.user_posts;
create policy user_posts_read_authenticated
on public.user_posts
for select
to authenticated
using (deleted_at is null);

drop policy if exists user_posts_insert_owner on public.user_posts;
create policy user_posts_insert_owner
on public.user_posts
for insert
to authenticated
with check (userid = auth.uid());

drop policy if exists user_posts_update_owner on public.user_posts;
create policy user_posts_update_owner
on public.user_posts
for update
to authenticated
using (userid = auth.uid())
with check (userid = auth.uid());

drop policy if exists user_posts_delete_owner on public.user_posts;
create policy user_posts_delete_owner
on public.user_posts
for delete
to authenticated
using (userid = auth.uid());

-- Geospatial point for indexing (generated from longitude/latitude)
alter table public.user_posts
  add column if not exists geom geometry(Point, 4326)
  generated always as (
    case
      when longitude is null or latitude is null then null
      else st_setsrid(st_makepoint(longitude, latitude), 4326)
    end
  ) stored;

-- Basic coordinate validation (allows NULL when no location set)
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_posts_longitude_range'
      and conrelid = 'public.user_posts'::regclass
  ) then
    alter table public.user_posts
      add constraint user_posts_longitude_range
      check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_posts_latitude_range'
      and conrelid = 'public.user_posts'::regclass
  ) then
    alter table public.user_posts
      add constraint user_posts_latitude_range
      check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;
end $$;

-- Fast bounding-box and spatial queries
create index if not exists user_posts_geom_gix on public.user_posts using gist (geom);
-- Common sorting / filtering by time
create index if not exists user_posts_occurred_at_idx on public.user_posts (occurred_at);

-- Note: RPCs moved to database/functions/*.sql

-- ==============================================================================
-- ACCOUNT DELETION AUDIT
-- ==============================================================================
create table if not exists public.user_deletion_audit (
  id uuid primary key default uuid_generate_v4(),
  deleted_user_id uuid not null,
  deleted_at timestamptz not null default now(),

  -- Provider info (store hashed values only; never store raw Apple subject here).
  provider text,
  provider_subject_hash text,
  email_hash text,

  -- Optional snapshots captured at deletion time.
  profile_snapshot jsonb,
  usage_snapshot jsonb,
  posts_snapshot jsonb,
  matches_snapshot jsonb,
  messages_snapshot jsonb
);

create index if not exists user_deletion_audit_deleted_user_id_idx
  on public.user_deletion_audit (deleted_user_id);

create index if not exists user_deletion_audit_provider_subject_hash_idx
  on public.user_deletion_audit (provider_subject_hash);

alter table public.user_deletion_audit enable row level security;
-- No policies by default: only service-role/admin tooling should read/write these rows.

-- ---------------------------------------------------------------------------
-- Matching (mutual agreement) + safety controls (blocks/reports)
-- ---------------------------------------------------------------------------

create table if not exists public.match_requests (
  id uuid primary key default uuid_generate_v4(),
  from_user_id uuid references public.users(userid) on delete cascade not null,
  to_user_id uuid references public.users(userid) on delete cascade not null,
  created_at timestamptz default now(),
  check (from_user_id <> to_user_id)
);

-- If this project previously used status/enum, keep it compatible (safe no-op when absent)
alter table public.match_requests drop column if exists status;
alter table public.match_requests drop column if exists responded_at;

create unique index if not exists match_requests_from_to_unique
on public.match_requests (from_user_id, to_user_id);

-- Migrate legacy table name `matches` -> `user_matches`
do $$
begin
  if to_regclass('public.user_matches') is null and to_regclass('public.matches') is not null then
    alter table public.matches rename to user_matches;
  end if;
end $$;

create table if not exists public.user_matches (
  id uuid primary key default uuid_generate_v4(),
  user_a uuid references public.users(userid) on delete cascade not null,
  user_b uuid references public.users(userid) on delete cascade not null,
  created_at timestamptz default now(),
  check (user_a < user_b)
);

-- Keep original index name to avoid duplicates even after rename.
create unique index if not exists matches_pair_unique
on public.user_matches (user_a, user_b);

create table if not exists public.blocks (
  id uuid primary key default uuid_generate_v4(),
  blocker_id uuid references public.users(userid) on delete cascade not null,
  blocked_id uuid references public.users(userid) on delete cascade not null,
  created_at timestamptz default now(),
  check (blocker_id <> blocked_id)
);

create unique index if not exists blocks_blocker_blocked_unique
on public.blocks (blocker_id, blocked_id);

create table if not exists public.reports (
  id uuid primary key default uuid_generate_v4(),
  reporter_id uuid references public.users(userid) on delete cascade not null,
  target_user_id uuid references public.users(userid) on delete cascade not null,
  target_post_id uuid references public.user_posts(id) on delete cascade,
  reason text,
  created_at timestamptz default now()
);

alter table public.match_requests enable row level security;
alter table public.user_matches enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;

-- Match Request Policies
drop policy if exists match_requests_select_participants on public.match_requests;
drop policy if exists "Authenticated can read all match requests" on public.match_requests;
drop policy if exists "Public can read all match requests" on public.match_requests;
create policy "Public can read all match requests" on public.match_requests
for select
to public
using (true);

drop policy if exists match_requests_insert_sender on public.match_requests;
create policy match_requests_insert_sender
on public.match_requests
for insert
to authenticated
with check (from_user_id = auth.uid() and from_user_id <> to_user_id);

drop policy if exists match_requests_update_participants on public.match_requests;
drop policy if exists match_requests_delete_participants on public.match_requests;
create policy match_requests_delete_participants
on public.match_requests
for delete
to authenticated
using (from_user_id = auth.uid() or to_user_id = auth.uid());

-- User Match Policies
drop policy if exists matches_select_participants on public.user_matches;
drop policy if exists matches_insert_participants on public.user_matches;
drop policy if exists matches_delete_participants on public.user_matches;
drop policy if exists user_matches_select_participants on public.user_matches;
drop policy if exists "Authenticated can read all matches" on public.user_matches;
drop policy if exists "Public can read all matches" on public.user_matches;
create policy "Public can read all matches" on public.user_matches
for select
to public
using (true);

drop policy if exists user_matches_insert_participants on public.user_matches;
create policy user_matches_insert_participants
on public.user_matches
for insert
to authenticated
with check (user_a = auth.uid() or user_b = auth.uid());

drop policy if exists user_matches_delete_participants on public.user_matches;
create policy user_matches_delete_participants
on public.user_matches
for delete
to authenticated
using (user_a = auth.uid() or user_b = auth.uid());

-- Blocks: owner-only
drop policy if exists blocks_select_owner on public.blocks;
create policy blocks_select_owner
on public.blocks
for select
to authenticated
using (blocker_id = auth.uid());

drop policy if exists blocks_insert_owner on public.blocks;
create policy blocks_insert_owner
on public.blocks
for insert
to authenticated
with check (blocker_id = auth.uid());

drop policy if exists blocks_delete_owner on public.blocks;
create policy blocks_delete_owner
on public.blocks
for delete
to authenticated
using (blocker_id = auth.uid());

-- Reports: reporter-only read, reporter-only create
drop policy if exists reports_select_reporter on public.reports;
create policy reports_select_reporter
on public.reports
for select
to authenticated
using (reporter_id = auth.uid());

drop policy if exists reports_insert_reporter on public.reports;
create policy reports_insert_reporter
on public.reports
for insert
to authenticated
with check (reporter_id = auth.uid());

-- Create Storage Bucket for images
insert into storage.buckets (id, name, public) 
values ('images', 'images', true)
on conflict (id) do nothing;

-- Storage Policies
drop policy if exists "Public Access" on storage.objects;
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'images' );

drop policy if exists "Authenticated Upload" on storage.objects;
create policy "Authenticated Upload"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Authenticated Update" on storage.objects;
create policy "Authenticated Update"
on storage.objects for update
to authenticated
using (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Authenticated Delete" on storage.objects;
create policy "Authenticated Delete"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'images'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- ==============================================================================
-- CHAT & PUSH NOTIFICATIONS
-- ==============================================================================

-- 1. Store FCM Tokens for Push Notifications
create table if not exists public.user_push_tokens (
  user_id uuid references public.users(userid) on delete cascade not null,
  token text not null,
  platform text check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz default now(),
  primary key (user_id, token)
);

alter table public.user_push_tokens enable row level security;

drop policy if exists "Users manage their own tokens" on public.user_push_tokens;
create policy "Users manage their own tokens" on public.user_push_tokens
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- 2. Messages Table
create table if not exists public.messages (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid references public.user_matches(id) on delete cascade not null,
  sender_id uuid references public.users(userid) on delete cascade not null,
  receiver_id uuid references public.users(userid) on delete cascade,
  content text, 
  media_url text, 
  created_at timestamptz default now()
);

-- Note: set_message_receiver_id trigger moved to database/functions/chat.sql

-- RLS: Allow any authenticated user to read and send messages (MVP Loose Mode)
alter table public.messages enable row level security;

drop policy if exists "Participants can read messages" on public.messages;
drop policy if exists "Authenticated can read all messages" on public.messages;
drop policy if exists "Public can read all messages" on public.messages;
create policy "Public can read all messages" on public.messages
  for select
  to public
  using (true);

drop policy if exists "Participants can send messages" on public.messages;
drop policy if exists "Authenticated can send messages" on public.messages;
drop policy if exists "Public can send messages" on public.messages;
create policy "Public can send messages" on public.messages
  for insert
  to public
  with check (true);

-- Enable Realtime for messages
alter publication supabase_realtime add table public.messages;

-- ==============================================================================
-- DIGITAL HUMAN AUTOMATION
-- ==============================================================================

-- 1. Track invites sent from digital humans to real users
create table if not exists public.digital_human_invites_tracking (
  user_id uuid references public.users(userid) on delete cascade not null primary key,
  invite_count integer not null default 0,
  updated_at timestamptz default now()
);

drop trigger if exists digital_human_invites_tracking_set_updated_at on public.digital_human_invites_tracking;
create trigger digital_human_invites_tracking_set_updated_at
before update on public.digital_human_invites_tracking
for each row
execute function public.set_updated_at();

-- 2. Configuration table for digital human automation parameters
create table if not exists public.digital_human_config (
  key text primary key,
  value text not null,
  description text
);

-- Insert default configuration values
insert into public.digital_human_config (key, value, description)
values
  ('max_invites_per_user', '5', 'Maximum invites a real user can receive from digital humans'),
  ('invites_per_cron_run', '5', 'How many invites to send per cron execution'),
  ('accept_rate_percentage', '30', 'Percentage of requests digital humans accept (0-100)'),
  ('active_hour_start', '5', 'Start hour for digital human activity in PST (0-23, 5 = 5 AM)'),
  ('active_hour_end', '23', 'End hour for digital human activity in PST (0-23, 23 = 11:59 PM)'),
  ('enable_digital_human_auto_response', 'true', 'Global toggle for digital human auto-replies'),
  ('enable_digital_human_follow_up', 'true', 'Global toggle for digital human follow-up messages')
on conflict (key) do nothing;

-- ==============================================================================
-- AI RESPONSE ORCHESTRATION
-- ==============================================================================

create table if not exists public.user_match_ai_state (
  match_id uuid primary key references public.user_matches(id) on delete cascade,
  
  -- Concurrency control
  ai_locked_until timestamptz,
  
  -- State tracking
  last_message_id uuid,          -- The most recent message in the convo
  last_message_at timestamptz,   -- When that message occurred (for debouncing)
  last_message_sender_id uuid,   -- Who sent it (to filter for USER messages)
  
  -- Progress tracking
  ai_last_processed_message_id uuid, -- The last message the AI has already responded to/ingested
  scheduled_response_at timestamptz, -- When the AI is scheduled to respond (for delay)
  
  ai_follow_up_count integer default 0, -- Track number of follow-ups sent since last user message

  -- Greeting (sent on match creation when enabled)
  ai_greeting_sent boolean not null default false,
  ai_greeting_sent_at timestamptz,

  -- Optimized lookups & State Machine
  dh_user_id uuid references public.users(userid),
  real_user_id uuid references public.users(userid),
  ai_state integer default 0, -- 0=Matched, 1=GreetingSent/Skipped, 2=DHSent, 3=UserSent, 4=DHFollowUp
  
  updated_at timestamptz default now()
);

alter table public.user_match_ai_state enable row level security;

create policy "Authenticated read ai state" on public.user_match_ai_state
  for select to authenticated using (true);

-- Note: AI state triggers moved to database/functions/ai_state.sql
