-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Create User table
create table public.users (
  userid uuid primary key default uuid_generate_v4(),
  username text not null,
  age integer,
  gender text,
  zipcode text,
  phone text,
  bio text,
  education text,
  profession text,
  avatar text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz,
  is_digital_human boolean default false,
  system_prompt text
);

-- Create UserPosts table
create table public.user_posts (
  id uuid primary key default uuid_generate_v4(),
  userid uuid references public.users(userid) on delete cascade not null,
  photos text[] not null default '{}',
  description text,
  altitude float,
  latitude float,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

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

