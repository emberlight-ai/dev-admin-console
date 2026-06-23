-- ============================================================
-- Migration: Admin per-user message counts
-- ============================================================
-- Powers the "Messages" column on /admin/users. A grouped aggregate so the
-- dashboard fetches one row per sender (~hundreds) instead of paging the whole
-- messages table. security definer + revoke-from-public so it is only reachable
-- by the service role (the admin API), never anon/authenticated.

create or replace function public.rpc_admin_user_message_counts()
returns table (user_id uuid, message_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  select m.sender_id as user_id, count(*)::bigint as message_count
  from public.messages m
  where m.sender_id is not null
  group by m.sender_id;
$$;

revoke execute on function public.rpc_admin_user_message_counts() from public;
grant execute on function public.rpc_admin_user_message_counts() to service_role;
