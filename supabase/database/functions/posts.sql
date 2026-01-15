
create or replace function public.rpc_get_user_posts(
  target_user_id uuid,
  start_index integer default 0,
  limit_count integer default 5,
  has_location boolean default false
)
returns setof public.user_posts
language sql
security invoker
as $$
  select *
  from public.user_posts
  where userid = target_user_id
    and deleted_at is null
    and (
      not has_location
      or geom is not null
      or location_name is not null
    )
  order by occurred_at desc, created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 50);
$$;

create or replace function public.rpc_get_user_locations(
  target_user_id uuid,
  start_index integer default 0,
  limit_count integer default 200
)
returns table (
  post_id uuid,
  occurred_at timestamptz,
  longitude double precision,
  latitude double precision,
  altitude double precision,
  location_name text
)
language sql
security invoker
as $$
  select
    id as post_id,
    occurred_at,
    longitude,
    latitude,
    altitude,
    location_name
  from public.user_posts
  where userid = target_user_id
    and deleted_at is null
    and (geom is not null or location_name is not null)
  order by occurred_at desc, created_at desc
  offset greatest(start_index, 0)
  limit least(greatest(limit_count, 0), 500);
$$;

-- Soft-delete a post (owner-only)
create or replace function public.rpc_delete_post(
  post_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if post_id is null then
    raise exception 'post_id is required';
  end if;

  update public.user_posts
  set deleted_at = now()
  where id = post_id
    and userid = auth.uid()
    and deleted_at is null;
end;
$$;
