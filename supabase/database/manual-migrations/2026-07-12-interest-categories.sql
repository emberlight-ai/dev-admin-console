-- Two-level taxonomy: interest_categories (iOS Explore tiles) CONTAIN interests
-- (Edit Profile tags). Applied 2026-07-12 via MCP. Canonical: interests.sql.
--
-- Existing interests each seed a same-keyed category and are mapped under it,
-- so user_interests + DH assignments + the deployed matching path are untouched.
-- Deleting a category reparents its interests to 'unspecified' (FK ON DELETE
-- SET DEFAULT). Deleting an interest cascades out of user_interests.

create table if not exists public.interest_categories (
  key        text primary key,
  name       text not null,
  asset      text not null default 'explore_gothic',
  sort_order integer not null default 0,
  active     boolean not null default true,
  admin_only boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.interest_categories (key, name, asset, sort_order, active, admin_only)
values ('unspecified', 'Unspecified', 'explore_gothic', 999, false, false)
on conflict (key) do nothing;

insert into public.interest_categories (key, name, asset, sort_order, active, admin_only)
select key, name, asset, sort_order, active, admin_only from public.interests
on conflict (key) do nothing;

alter table public.interests
  add column if not exists category_key text not null default 'unspecified'
  references public.interest_categories(key) on delete set default;
create index if not exists interests_category_idx on public.interests (category_key);

update public.interests i
set category_key = i.key
where exists (select 1 from public.interest_categories c where c.key = i.key)
  and i.category_key = 'unspecified';

create or replace function public.protect_unspecified_category()
returns trigger language plpgsql as $$
begin
  if old.key = 'unspecified' then
    raise exception 'the unspecified category cannot be deleted';
  end if;
  return old;
end;
$$;
drop trigger if exists interest_categories_protect_unspecified on public.interest_categories;
create trigger interest_categories_protect_unspecified
before delete on public.interest_categories
for each row execute function public.protect_unspecified_category();

alter table public.interest_categories enable row level security;
drop policy if exists interest_categories_read on public.interest_categories;
create policy interest_categories_read on public.interest_categories
  for select to authenticated using (true);

create or replace function public.rpc_category_counts()
returns table (category_key text, user_count bigint)
language sql security invoker stable as $$
  select i.category_key, count(distinct ui.user_id)::bigint
  from public.user_interests ui
  join public.interests i on i.key = ui.interest_key
  join public.users u on u.userid = ui.user_id
  where u.deleted_at is null
  group by i.category_key;
$$;
grant execute on function public.rpc_category_counts() to authenticated;
