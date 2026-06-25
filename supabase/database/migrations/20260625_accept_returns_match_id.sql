-- rpc_accept_match_request now returns the new match id so the client can jump
-- straight into the conversation and migrate the invitation into its connections
-- cache, instead of waiting for a full reload. (void -> uuid requires drop first.)
drop function if exists public.rpc_accept_match_request(uuid);

create function public.rpc_accept_match_request(request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  r          public.match_requests%rowtype;
  a          uuid;
  b          uuid;
  v_match_id uuid;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select * into r from public.match_requests where id = request_id for update;
  if not found then
    raise exception 'match request not found';
  end if;
  if r.to_user_id <> auth.uid() then
    raise exception 'only recipient can accept';
  end if;

  delete from public.match_requests where id = request_id;

  a := least(r.from_user_id, r.to_user_id);
  b := greatest(r.from_user_id, r.to_user_id);
  insert into public.user_matches (user_a, user_b)
  values (a, b)
  on conflict (user_a, user_b) do update set created_at = public.user_matches.created_at
  returning id into v_match_id;

  -- Open the conversation with the DH's opener (seeded in-txn so dh-greeting no-ops).
  if v_match_id is not null and r.greeting is not null and length(btrim(r.greeting)) > 0 then
    insert into public.messages (match_id, sender_id, content)
    values (v_match_id, r.from_user_id, r.greeting);

    update public.user_match_ai_state
       set ai_greeting_sent    = true,
           ai_greeting_sent_at = now(),
           ai_state            = 1,
           ai_locked_until     = null
     where match_id = v_match_id;
  end if;

  return v_match_id;
end;
$$;

grant execute on function public.rpc_accept_match_request(uuid) to anon, authenticated, service_role;
