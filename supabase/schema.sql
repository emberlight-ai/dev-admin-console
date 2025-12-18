-- Enable UUID extension
create extension if not exists "uuid-ossp";
-- Enable PostGIS for geospatial queries (range/bbox, distance, etc.)
create extension if not exists postgis;

-- Create User table
create table public.users (
  userid uuid primary key default uuid_generate_v4(),
  username text not null,
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

-- Create SystemPrompts table (versioned system prompt templates per gender + personality)
create table public."SystemPrompts" (
  id uuid primary key default uuid_generate_v4(),
  gender text not null,
  personality text not null,
  system_prompt text not null,
  created_at timestamptz default now()
);

-- Fast lookup for newest prompt by (gender, personality)
create index systemprompts_gender_personality_created_at_idx
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

-- Geospatial point for indexing (generated from longitude/latitude)
alter table public.user_posts
  add column geom geometry(Point, 4326)
  generated always as (
    case
      when longitude is null or latitude is null then null
      else st_setsrid(st_makepoint(longitude, latitude), 4326)
    end
  ) stored;

-- Basic coordinate validation (allows NULL when no location set)
alter table public.user_posts
  add constraint user_posts_longitude_range check (longitude is null or (longitude >= -180 and longitude <= 180));
alter table public.user_posts
  add constraint user_posts_latitude_range check (latitude is null or (latitude >= -90 and latitude <= 90));

-- Fast bounding-box and spatial queries
create index user_posts_geom_gix on public.user_posts using gist (geom);
-- Common sorting / filtering by time
create index user_posts_occurred_at_idx on public.user_posts (occurred_at);

-- Create Matches table
create table public.matches (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references public.users(userid) on delete cascade not null,
  dh_user_id uuid references public.users(userid) on delete cascade not null,
  created_at timestamptz default now()
);

-- Create Storage Bucket for images
insert into storage.buckets (id, name, public) 
values ('images', 'images', true)
on conflict (id) do nothing;

-- Storage Policies (Allow public read, authenticated insert/update/delete)
-- Note: In a real app, you'd want stricter policies.
create policy "Public Access"
on storage.objects for select
using ( bucket_id = 'images' );

create policy "Authenticated Upload"
on storage.objects for insert
with check ( bucket_id = 'images' );

create policy "Authenticated Update"
on storage.objects for update
using ( bucket_id = 'images' );

create policy "Authenticated Delete"
on storage.objects for delete
using ( bucket_id = 'images' );

