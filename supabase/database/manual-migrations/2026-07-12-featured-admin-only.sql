-- Featured returns as an ADMIN-ONLY interest (applied 2026-07-12 via MCP).
-- Renders on Explore like any category; users can never self-select it —
-- only the admin (service role) assigns digital humans.
-- Canonical source: database/functions/interests.sql

alter table public.interests
  add column if not exists admin_only boolean not null default false;

insert into public.interests (key, name, asset, sort_order, active, admin_only)
values ('featured', 'Featured', 'explore_featured', 0, true, true)
on conflict (key) do update
  set name = excluded.name, asset = excluded.asset,
      sort_order = excluded.sort_order, active = true, admin_only = true;

-- rpc_set_my_interests: refuses admin-only keys, preserves admin-granted
-- admin-only memberships across the replace-all. (Full body in
-- database/functions/interests.sql — same signature, CREATE OR REPLACE.)
