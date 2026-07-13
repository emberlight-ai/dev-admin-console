-- 2026-07-13 · Whitelist as an admin-only category/interest
--
-- The home swipe deck is driven by users.whitelisted (read by
-- rpc_get_matching_candidates). This makes "Whitelist" a taggable category —
-- like Featured — so ops can add a DH to the deck by tagging them, without
-- touching the dedicated /admin/matching/whitelist page (which still writes the
-- flag directly, as does the performance-sync). A bidirectional trigger keeps
-- the user_interests('whitelist') tag and users.whitelisted in lockstep so the
-- two representations can never drift.
--
-- Whitelist is NOT an iOS Explore tile (category.active = false); the interest
-- is active = true only so the admin DH-tagging UIs list it (admin_only hides it
-- from the iOS picker and from match-card tag chips, same as Featured).

-- 1. The category (kanban column; hidden from iOS Explore). sort_order -1 keeps
--    it leftmost. asset reused from featured (never rendered on iOS).
insert into interest_categories (key, name, asset, sort_order, active, admin_only)
values ('whitelist', 'Whitelist', 'explore_featured', -1, false, true)
on conflict (key) do update
  set name = excluded.name, admin_only = true;

-- 2. The interest (the taggable thing, under the whitelist category).
insert into interests (key, name, asset, sort_order, active, admin_only, category_key)
values ('whitelist', 'Whitelist', 'explore_featured', -1, true, true, 'whitelist')
on conflict (key) do update
  set name = excluded.name, admin_only = true, category_key = 'whitelist', active = true;

-- 3a. tag → flag: a user_interests('whitelist') row implies users.whitelisted.
create or replace function fn_whitelist_tag_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update users set whitelisted = true
      where userid = new.user_id and whitelisted is distinct from true;
  elsif tg_op = 'DELETE' then
    update users set whitelisted = false
      where userid = old.user_id and whitelisted is distinct from false;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_whitelist_tag_ins on user_interests;
create trigger trg_whitelist_tag_ins
  after insert on user_interests
  for each row when (new.interest_key = 'whitelist')
  execute function fn_whitelist_tag_sync();

drop trigger if exists trg_whitelist_tag_del on user_interests;
create trigger trg_whitelist_tag_del
  after delete on user_interests
  for each row when (old.interest_key = 'whitelist')
  execute function fn_whitelist_tag_sync();

-- 3b. flag → tag: setting users.whitelisted maintains the tag. The `is distinct
--     from` / ON CONFLICT guards make the reciprocal trigger a no-op, so the two
--     triggers can't recurse.
create or replace function fn_whitelist_flag_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.whitelisted then
    insert into user_interests (user_id, interest_key)
      values (new.userid, 'whitelist')
      on conflict (user_id, interest_key) do nothing;
  else
    delete from user_interests
      where user_id = new.userid and interest_key = 'whitelist';
  end if;
  return null;
end;
$$;

drop trigger if exists trg_whitelist_flag_ins on users;
create trigger trg_whitelist_flag_ins
  after insert on users
  for each row when (new.whitelisted is true)
  execute function fn_whitelist_flag_sync();

drop trigger if exists trg_whitelist_flag_upd on users;
create trigger trg_whitelist_flag_upd
  after update of whitelisted on users
  for each row when (new.whitelisted is distinct from old.whitelisted)
  execute function fn_whitelist_flag_sync();

-- 4. Backfill: every currently-whitelisted user gets the tag (the trigger no-ops
--    since the flag is already set).
insert into user_interests (user_id, interest_key)
select userid, 'whitelist' from users where whitelisted = true
on conflict (user_id, interest_key) do nothing;
