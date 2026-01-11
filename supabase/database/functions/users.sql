
-- Auto-create a profile row on signup (email/apple/google) so iOS can immediately read/update profile.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (userid, username, is_digital_human)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', ''),
    false
  )
  on conflict (userid) do nothing;

  return new;
end;
$$;

-- Trigger for auth.users
-- Note: Requires permissions on auth schema if running as non-superuser
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.rpc_request_delete_user()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set deleted_at = now()
  where userid = auth.uid()
  and deleted_at is null;

  -- Cleanup: remove the user's presence from matching/safety tables.
  delete from public.match_requests
  where from_user_id = auth.uid() or to_user_id = auth.uid();

  delete from public.user_matches
  where user_a = auth.uid() or user_b = auth.uid();

  delete from public.blocks
  where blocker_id = auth.uid() or blocked_id = auth.uid();

  delete from public.reports
  where reporter_id = auth.uid() or target_user_id = auth.uid();
end;
$$;
