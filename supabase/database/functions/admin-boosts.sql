-- Admin reporting: per-user boost summary for the /admin/users table.
-- user_boost is an immutable ledger (one row per activation, expires_at =
-- started_at + 15 min). "Boosted" = any row exists; "Boosting" = a row is still
-- active (last_expires_at > now()). Grouped aggregate so the dashboard fetches
-- one row per user instead of paging the ledger. Read-only, service-role only.
create or replace function public.rpc_admin_user_boosts()
returns table (user_id uuid, boost_count bigint, last_expires_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select b.user_id, count(*)::bigint as boost_count, max(b.expires_at) as last_expires_at
  from public.user_boost b
  group by b.user_id;
$$;

revoke execute on function public.rpc_admin_user_boosts() from public, anon, authenticated;
grant execute on function public.rpc_admin_user_boosts() to service_role;
