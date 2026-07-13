-- ═══════════════════════════════════════════════════════════════════════════
-- Shared chat images — a global photo library every digital human draws from.
--
-- Unlike dh_chat_images (each DH owns its photos, deduped per-MATCH via
-- dh_sent_images), these are shared across ALL digital humans and deduped
-- per real USER: once any DH has sent a shared image to a user, no other DH
-- sends that same image to that user again.
--
--   shared_chat_images   the library. "folder" in the admin UI == `tier`
--                        (dh_image_tier), matching the selfie ladder so the
--                        picker can fall casual→tease→reward like dh photos.
--   shared_image_sends   per-user send ledger (UNIQUE receiver+image) — the
--                        authoritative dedup (survives message edits/CDN URL
--                        variants that a media_url string-match would miss).
--
-- Access: service-role only (admin API writes; edge functions pick + record).
-- iOS never touches these tables. RLS on + no policies = locked to service role.
-- Images live in the existing `images` storage bucket under `shared-chat/`.
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.shared_chat_images (
  id           uuid primary key default gen_random_uuid(),
  storage_path text not null unique,          -- path within the `images` bucket
  public_url   text not null,
  tier         public.dh_image_tier not null default 'casual',  -- the "folder"
  description  text,                           -- per-image: what it shows (DH memory + selection)
  post_content text,                           -- optional caption she "posts" with it
  interests    text[] not null default '{}',   -- interest keys (validated against catalog on write)
  time_of_day  text check (time_of_day is null or time_of_day in ('morning','afternoon','evening')),
  location_name text,
  latitude     double precision,
  longitude    double precision,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists shared_chat_images_tier_active_idx
  on public.shared_chat_images (tier, active, created_at desc);
create index if not exists shared_chat_images_interests_gin
  on public.shared_chat_images using gin (interests);

alter table public.shared_chat_images enable row level security;
-- No policies: service role (admin API + edge) bypasses RLS; nobody else reads.

create table if not exists public.shared_image_sends (
  receiver_id     uuid not null references public.users(userid) on delete cascade,
  shared_image_id uuid not null references public.shared_chat_images(id) on delete cascade,
  dh_user_id      uuid,
  match_id        uuid,
  message_id      uuid,
  sent_at         timestamptz not null default now(),
  primary key (receiver_id, shared_image_id)
);

create index if not exists shared_image_sends_receiver_idx
  on public.shared_image_sends (receiver_id);

alter table public.shared_image_sends enable row level security;

-- Best unsent shared image for a receiver: walk the tier ladder (never up),
-- softly prefer images whose interests overlap the conversation's and whose
-- time_of_day fits the user's local time, oldest-first for even rotation.
-- time-of-day is a PREFERENCE not a filter (better to send something than
-- nothing). Global per-user dedup via shared_image_sends.
create or replace function public.rpc_pick_shared_image(
  p_receiver_id uuid,
  p_tier public.dh_image_tier default 'casual',
  p_interests text[] default '{}',
  p_time_of_day text default null
)
returns public.shared_chat_images
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_ladder public.dh_image_tier[];
  v_tier   public.dh_image_tier;
  v_img    public.shared_chat_images;
begin
  v_ladder := case p_tier
    when 'reward' then array['reward','tease','casual','unspecified']::public.dh_image_tier[]
    when 'tease'  then array['tease','casual','unspecified']::public.dh_image_tier[]
    else               array['casual','unspecified']::public.dh_image_tier[]
  end;

  foreach v_tier in array v_ladder loop
    select s.* into v_img
    from public.shared_chat_images s
    where s.tier = v_tier
      and s.active
      and not exists (
        select 1 from public.shared_image_sends ss
        where ss.receiver_id = p_receiver_id
          and ss.shared_image_id = s.id
      )
    order by
      (case when s.interests && p_interests then 0 else 1 end),  -- interest match first
      (case when p_time_of_day is null
                 or s.time_of_day is null
                 or s.time_of_day = p_time_of_day then 0 else 1 end),  -- then time-of-day fit
      s.created_at asc                                            -- then oldest (even rotation)
    limit 1;

    if found then
      return v_img;
    end if;
  end loop;

  return null;  -- library exhausted for this user at/below the target tier
end;
$$;

revoke execute on function public.rpc_pick_shared_image(uuid, public.dh_image_tier, text[], text) from public;
grant  execute on function public.rpc_pick_shared_image(uuid, public.dh_image_tier, text[], text) to service_role;

-- Record a shared-image send. Idempotent per (receiver, image): the UNIQUE PK
-- means a second DH attempting the same image no-ops instead of duplicating.
create or replace function public.rpc_record_shared_image_send(
  p_receiver_id     uuid,
  p_shared_image_id uuid,
  p_dh_user_id      uuid default null,
  p_match_id        uuid default null,
  p_message_id      uuid default null
)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.shared_image_sends
    (receiver_id, shared_image_id, dh_user_id, match_id, message_id)
  values
    (p_receiver_id, p_shared_image_id, p_dh_user_id, p_match_id, p_message_id)
  on conflict (receiver_id, shared_image_id) do nothing;
$$;

revoke execute on function public.rpc_record_shared_image_send(uuid, uuid, uuid, uuid, uuid) from public;
grant  execute on function public.rpc_record_shared_image_send(uuid, uuid, uuid, uuid, uuid) to service_role;
