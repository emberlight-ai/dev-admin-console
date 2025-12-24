     1|-- Enable UUID extension
     2|create extension if not exists "uuid-ossp";
     3|-- Enable PostGIS for geospatial queries (range/bbox, distance, etc.)
     4|create extension if not exists postgis;
     5|
     6|-- updated_at trigger helper
     7|create or replace function public.set_updated_at()
     8|returns trigger
     9|language plpgsql
    10|as $$
    11|begin
    12|  new.updated_at = now();
    13|  return new;
    14|end;
    15|$$;
    16|
    17|-- Create User table
    18|create table public.users (
    19|  -- Align app user id to Supabase Auth user id for consistent identity + simple RLS.
    20|  userid uuid primary key references auth.users(id) on delete cascade,
    21|  -- Allow bootstrap on signup; app should prompt user to complete profile.
    22|  username text not null default '',
    23|  age integer,
    24|  gender text,
    25|  personality text,
    26|  zipcode text,
    27|  phone text,
    28|  bio text,
    29|  education text,
    30|  profession text,
    31|  avatar text,
    32|  created_at timestamptz default now(),
    33|  updated_at timestamptz default now(),
    34|  deleted_at timestamptz,
    35|  is_digital_human boolean default false
    36|);
    37|
    38|drop trigger if exists users_set_updated_at on public.users;
    39|create trigger users_set_updated_at
    40|before update on public.users
    41|for each row
    42|execute function public.set_updated_at();
    43|
    44|-- Auto-create a profile row on signup (email/apple/google) so iOS can immediately read/update profile.
    45|create or replace function public.handle_new_auth_user()
    46|returns trigger
    47|language plpgsql
    48|security definer
    49|set search_path = public
    50|as $$
    51|begin
    52|  insert into public.users (userid, username, is_digital_human)
    53|  values (
    54|    new.id,
    55|    coalesce(new.raw_user_meta_data->>'username', ''),
    56|    false
    57|  )
    58|  on conflict (userid) do nothing;
    59|
    60|  return new;
    61|end;
    62|$$;
    63|
    64|drop trigger if exists on_auth_user_created on auth.users;
    65|create trigger on_auth_user_created
    66|after insert on auth.users
    67|for each row execute function public.handle_new_auth_user();
    68|
    69|-- Safe public profile projection for matched users (omit phone/zipcode, etc.)
    70|create or replace view public.user_public_profiles as
    71|select
    72|  userid,
    73|  username,
    74|  age,
    75|  gender,
    76|  personality,
    77|  profession,
    78|  bio,
    79|  education,
    80|  avatar,
    81|  created_at,
    82|  updated_at,
    83|  is_digital_human
    84|from public.users
    85|where deleted_at is null;
    86|
    87|-- Create SystemPrompts table (versioned system prompt templates per gender + personality)
    88|create table public."SystemPrompts" (
    89|  id uuid primary key default uuid_generate_v4(),
    90|  gender text not null,
    91|  personality text not null,
    92|  system_prompt text not null,
    93|  created_at timestamptz default now()
    94|);
    95|
    96|-- Fast lookup for newest prompt by (gender, personality)
    97|create index if not exists systemprompts_gender_personality_created_at_idx
    98|on public."SystemPrompts" (gender, personality, created_at desc);
    99|
   100|-- Create UserPosts table
   101|create table public.user_posts (
   102|  id uuid primary key default uuid_generate_v4(),
   103|  userid uuid references public.users(userid) on delete cascade not null,
   104|  photos text[] not null default '{}',
   105|  description text,
   106|  location_name text,
   107|  longitude double precision,
   108|  latitude double precision,
   109|  altitude double precision,
   110|  occurred_at timestamptz default now(),
   111|  created_at timestamptz default now(),
   112|  updated_at timestamptz default now(),
   113|  deleted_at timestamptz
   114|);
   115|
   116|drop trigger if exists user_posts_set_updated_at on public.user_posts;
   117|create trigger user_posts_set_updated_at
   118|before update on public.user_posts
   119|for each row
   120|execute function public.set_updated_at();
   121|
   122|-- ---------------------------------------------------------------------------
   123|-- Row Level Security (RLS)
   124|-- - Reads: any authenticated user can read profiles/posts (excluding soft-deleted rows)
   125|-- - Writes: only the owner (userid = auth.uid())
   126|-- ---------------------------------------------------------------------------
   127|
   128|alter table public.users enable row level security;
   129|alter table public.user_posts enable row level security;
   130|
   131|drop policy if exists users_read_authenticated on public.users;
   132|drop policy if exists "Public read profiles" on public.users;
   133|create policy "Public read profiles" on public.users
   134|  for select
   135|  to public
   136|  using (deleted_at is null);
   137|
   138|drop policy if exists users_insert_owner on public.users;
   139|create policy users_insert_owner
   140|on public.users
   141|for insert
   142|to authenticated
   143|with check (userid = auth.uid());
   144|
   145|drop policy if exists users_update_owner on public.users;
   146|create policy users_update_owner
   147|on public.users
   148|for update
   149|to authenticated
   150|using (userid = auth.uid() and deleted_at is null)
   151|with check (userid = auth.uid());
   152|
   153|drop policy if exists users_delete_owner on public.users;
   154|create policy users_delete_owner
   155|on public.users
   156|for delete
   157|to authenticated
   158|using (userid = auth.uid());
   159|
   160|drop policy if exists user_posts_read_authenticated on public.user_posts;
   161|create policy user_posts_read_authenticated
   162|on public.user_posts
   163|for select
   164|to authenticated
   165|using (deleted_at is null);
   166|
   167|drop policy if exists user_posts_insert_owner on public.user_posts;
   168|create policy user_posts_insert_owner
   169|on public.user_posts
   170|for insert
   171|to authenticated
   172|with check (userid = auth.uid());
   173|
   174|drop policy if exists user_posts_update_owner on public.user_posts;
   175|create policy user_posts_update_owner
   176|on public.user_posts
   177|for update
   178|to authenticated
   179|using (userid = auth.uid() and deleted_at is null)
   180|with check (userid = auth.uid());
   181|
   182|drop policy if exists user_posts_delete_owner on public.user_posts;
   183|create policy user_posts_delete_owner
   184|on public.user_posts
   185|for delete
   186|to authenticated
   187|using (userid = auth.uid());
   188|
   189|-- Geospatial point for indexing (generated from longitude/latitude)
   190|alter table public.user_posts
   191|  add column if not exists geom geometry(Point, 4326)
   192|  generated always as (
   193|    case
   194|      when longitude is null or latitude is null then null
   195|      else st_setsrid(st_makepoint(longitude, latitude), 4326)
   196|    end
   197|  ) stored;
   198|
   199|-- Basic coordinate validation (allows NULL when no location set)
   200|do $$
   201|begin
   202|  if not exists (
   203|    select 1
   204|    from pg_constraint
   205|    where conname = 'user_posts_longitude_range'
   206|      and conrelid = 'public.user_posts'::regclass
   207|  ) then
   208|    alter table public.user_posts
   209|      add constraint user_posts_longitude_range
   210|      check (longitude is null or (longitude >= -180 and longitude <= 180));
   211|  end if;
   212|end $$;
   213|
   214|do $$
   215|begin
   216|  if not exists (
   217|    select 1
   218|    from pg_constraint
   219|    where conname = 'user_posts_latitude_range'
   220|      and conrelid = 'public.user_posts'::regclass
   221|  ) then
   222|    alter table public.user_posts
   223|      add constraint user_posts_latitude_range
   224|      check (latitude is null or (latitude >= -90 and latitude <= 90));
   225|  end if;
   226|end $$;
   227|
   228|-- Fast bounding-box and spatial queries
   229|create index if not exists user_posts_geom_gix on public.user_posts using gist (geom);
   230|-- Common sorting / filtering by time
   231|create index if not exists user_posts_occurred_at_idx on public.user_posts (occurred_at);
   232|
   233|-- ---------------------------------------------------------------------------
   234|-- RPCs for efficient pagination + 3D Earth rendering
   235|-- ---------------------------------------------------------------------------
   236|
   237|create or replace function public.rpc_get_user_posts(
   238|  target_user_id uuid,
   239|  start_index integer default 0,
   240|  limit_count integer default 5,
   241|  has_location boolean default false
   242|)
   243|returns setof public.user_posts
   244|language sql
   245|security invoker
   246|as $$
   247|  select *
   248|  from public.user_posts
   249|  where userid = target_user_id
   250|    and deleted_at is null
   251|    and (
   252|      not has_location
   253|      or geom is not null
   254|      or location_name is not null
   255|    )
   256|  order by occurred_at desc, created_at desc
   257|  offset greatest(start_index, 0)
   258|  limit least(greatest(limit_count, 0), 50);
   259|$$;
   260|
   261|create or replace function public.rpc_get_user_locations(
   262|  target_user_id uuid,
   263|  start_index integer default 0,
   264|  limit_count integer default 200
   265|)
   266|returns table (
   267|  post_id uuid,
   268|  occurred_at timestamptz,
   269|  longitude double precision,
   270|  latitude double precision,
   271|  altitude double precision,
   272|  location_name text
   273|)
   274|language sql
   275|security invoker
   276|as $$
   277|  select
   278|    id as post_id,
   279|    occurred_at,
   280|    longitude,
   281|    latitude,
   282|    altitude,
   283|    location_name
   284|  from public.user_posts
   285|  where userid = target_user_id
   286|    and deleted_at is null
   287|    and (geom is not null or location_name is not null)
   288|  order by occurred_at desc, created_at desc
   289|  offset greatest(start_index, 0)
   290|  limit least(greatest(limit_count, 0), 500);
   291|$$;
   292|
   293|create or replace function public.rpc_request_delete_user()
   294|returns void
   295|language plpgsql
   296|security definer
   297|set search_path = public
   298|as $$
   299|begin
   300|  update public.users
   301|  set deleted_at = now()
   302|  where userid = auth.uid()
   303|    and deleted_at is null;
   304|
   305|  -- Cleanup: remove the user's presence from matching/safety tables.
   306|  delete from public.match_requests
   307|  where from_user_id = auth.uid() or to_user_id = auth.uid();
   308|
   309|  delete from public.user_matches
   310|  where user_a = auth.uid() or user_b = auth.uid();
   311|
   312|  delete from public.blocks
   313|  where blocker_id = auth.uid() or blocked_id = auth.uid();
   314|
   315|  delete from public.reports
   316|  where reporter_id = auth.uid() or target_user_id = auth.uid();
   317|end;
   318|$$;
   319|
   320|-- ---------------------------------------------------------------------------
   321|-- Matching (mutual agreement) + safety controls (blocks/reports)
   322|-- ---------------------------------------------------------------------------
   323|
   324|-- Match requests are minimal: row exists == request exists.
   325|-- - A sends -> INSERT
   326|-- - A cancels -> DELETE
   327|-- - B accepts -> DELETE request + INSERT into user_matches
   328|create table if not exists public.match_requests (
   329|  id uuid primary key default uuid_generate_v4(),
   330|  from_user_id uuid references public.users(userid) on delete cascade not null,
   331|  to_user_id uuid references public.users(userid) on delete cascade not null,
   332|  created_at timestamptz default now(),
   333|  check (from_user_id <> to_user_id)
   334|);
   335|
   336|-- If this project previously used status/enum, keep it compatible (safe no-op when absent)
   337|alter table public.match_requests drop column if exists status;
   338|alter table public.match_requests drop column if exists responded_at;
   339|
   340|create unique index if not exists match_requests_from_to_unique
   341|on public.match_requests (from_user_id, to_user_id);
   342|
   343|-- Migrate legacy table name `matches` -> `user_matches` (your Supabase screenshot shows `matches`)
   344|do $$
   345|begin
   346|  if to_regclass('public.user_matches') is null and to_regclass('public.matches') is not null then
   347|    alter table public.matches rename to user_matches;
   348|  end if;
   349|end $$;
   350|
   351|create table if not exists public.user_matches (
   352|  id uuid primary key default uuid_generate_v4(),
   353|  user_a uuid references public.users(userid) on delete cascade not null,
   354|  user_b uuid references public.users(userid) on delete cascade not null,
   355|  created_at timestamptz default now(),
   356|  check (user_a < user_b)
   357|);
   358|
   359|-- Keep original index name to avoid duplicates even after rename.
   360|create unique index if not exists matches_pair_unique
   361|on public.user_matches (user_a, user_b);
   362|
   363|create table if not exists public.blocks (
   364|  id uuid primary key default uuid_generate_v4(),
   365|  blocker_id uuid references public.users(userid) on delete cascade not null,
   366|  blocked_id uuid references public.users(userid) on delete cascade not null,
   367|  created_at timestamptz default now(),
   368|  check (blocker_id <> blocked_id)
   369|);
   370|
   371|create unique index if not exists blocks_blocker_blocked_unique
   372|on public.blocks (blocker_id, blocked_id);
   373|
   374|create table if not exists public.reports (
   375|  id uuid primary key default uuid_generate_v4(),
   376|  reporter_id uuid references public.users(userid) on delete cascade not null,
   377|  -- Always set:
   378|  -- - reporting a user: target_user_id set, target_post_id NULL
   379|  -- - reporting a post: target_user_id set, target_post_id set
   380|  target_user_id uuid references public.users(userid) on delete cascade not null,
   381|  target_post_id uuid references public.user_posts(id) on delete cascade,
   382|  reason text,
   383|  created_at timestamptz default now()
   384|);
   385|
   386|alter table public.match_requests enable row level security;
   387|alter table public.user_matches enable row level security;
   388|alter table public.blocks enable row level security;
   389|alter table public.reports enable row level security;
   390|
   391|-- Participants-only for match requests
   392|drop policy if exists match_requests_select_participants on public.match_requests;
   393|drop policy if exists "Authenticated can read all match requests" on public.match_requests;
   394|drop policy if exists "Public can read all match requests" on public.match_requests;
   395|create policy "Public can read all match requests" on public.match_requests
   396|for select
   397|to public
   398|using (true);
   399|
   400|drop policy if exists match_requests_insert_sender on public.match_requests;
   401|create policy match_requests_insert_sender
   402|on public.match_requests
   403|for insert
   404|to authenticated
   405|with check (from_user_id = auth.uid() and from_user_id <> to_user_id);
   406|
   407|-- Delete-based workflow needs delete privileges (cancel/accept/decline)
   408|drop policy if exists match_requests_update_participants on public.match_requests;
   409|drop policy if exists match_requests_delete_participants on public.match_requests;
   410|create policy match_requests_delete_participants
   411|on public.match_requests
   412|for delete
   413|to authenticated
   413|using (from_user_id = auth.uid() or to_user_id = auth.uid());
   414|
   415|-- Participants-only for user_matches
   416|drop policy if exists matches_select_participants on public.user_matches;
   417|drop policy if exists matches_insert_participants on public.user_matches;
   418|drop policy if exists matches_delete_participants on public.user_matches;
   419|drop policy if exists user_matches_select_participants on public.user_matches;
   420|drop policy if exists "Authenticated can read all matches" on public.user_matches;
   421|drop policy if exists "Public can read all matches" on public.user_matches;
   422|create policy "Public can read all matches" on public.user_matches
   423|for select
   424|to public
   425|using (true);
   426|
   427|-- Needed for rpc_accept_match_request (INSERT INTO user_matches)
   428|drop policy if exists user_matches_insert_participants on public.user_matches;
   429|create policy user_matches_insert_participants
   430|on public.user_matches
   431|for insert
   432|to authenticated
   433|with check (user_a = auth.uid() or user_b = auth.uid());
   434|
   435|drop policy if exists user_matches_delete_participants on public.user_matches;
   436|create policy user_matches_delete_participants
   437|on public.user_matches
   438|for delete
   439|to authenticated
   439|using (user_a = auth.uid() or user_b = auth.uid());
   440|
   441|-- Blocks: owner-only
   442|drop policy if exists blocks_select_owner on public.blocks;
   443|create policy blocks_select_owner
   444|on public.blocks
   445|for select
   446|to authenticated
   447|using (blocker_id = auth.uid());
   448|
   449|drop policy if exists blocks_insert_owner on public.blocks;
   450|create policy blocks_insert_owner
   451|on public.blocks
   452|for insert
   453|to authenticated
   454|with check (blocker_id = auth.uid());
   455|
   456|drop policy if exists blocks_delete_owner on public.blocks;
   457|create policy blocks_delete_owner
   458|on public.blocks
   459|for delete
   460|to authenticated
   461|using (blocker_id = auth.uid());
   462|
   463|-- Reports: reporter-only read, reporter-only create
   464|drop policy if exists reports_select_reporter on public.reports;
   465|create policy reports_select_reporter
   466|on public.reports
   467|for select
   468|to authenticated
   469|using (reporter_id = auth.uid());
   470|
   471|drop policy if exists reports_insert_reporter on public.reports;
   472|create policy reports_insert_reporter
   473|on public.reports
   474|for insert
   475|to authenticated
   476|with check (reporter_id = auth.uid());
   477|
   478|-- MVP (loose): no match-gated reads in RLS; reads are allowed for any authenticated user.
   479|
   480|-- RPC: send match request (idempotent)
   481|create or replace function public.rpc_send_match_request(target_user_id uuid)
   482|returns uuid
   483|language plpgsql
   484|security invoker
   485|as $$
   486|declare
   487|  req_id uuid;
   488|  match_id uuid;
   489|  a uuid;
   490|  b uuid;
   491|  reciprocal_id uuid;
   492|begin
   493|  if target_user_id is null then
   494|    raise exception 'target_user_id is required';
   495|  end if;
   496|  if target_user_id = auth.uid() then
   497|    raise exception 'cannot match with self';
   498|  end if;
   499|
   500|  -- If already matched, return existing match id.
   501|  a := least(auth.uid(), target_user_id);
   502|  b := greatest(auth.uid(), target_user_id);
   503|  select id into match_id
   504|  from public.user_matches
   505|  where user_a = a and user_b = b
   506|  limit 1;
   507|  if match_id is not null then
   508|    return match_id;
   509|  end if;
   510|
   511|  -- If the other user has already invited me, auto-match:
   512|  -- delete both pending requests and insert into user_matches.
   513|  select id into reciprocal_id
   514|  from public.match_requests
   515|  where from_user_id = target_user_id
   516|    and to_user_id = auth.uid()
   517|  limit 1;
   518|
   519|  if reciprocal_id is not null then
   520|    delete from public.match_requests
   521|    where (from_user_id = auth.uid() and to_user_id = target_user_id)
   522|       or (from_user_id = target_user_id and to_user_id = auth.uid());
   523|
   524|    insert into public.user_matches (user_a, user_b)
   525|    values (a, b)
   526|    on conflict (user_a, user_b) do update set created_at = public.user_matches.created_at
   527|    returning id into match_id;
   528|
   529|    return match_id;
   530|  end if;
   531|
   532|  -- Normal path: create (or return existing) outbound request.
   533|  insert into public.match_requests (from_user_id, to_user_id)
   534|  values (auth.uid(), target_user_id)
   535|  on conflict (from_user_id, to_user_id) do nothing
   536|  returning id into req_id;
   537|
   538|  if req_id is null then
   539|    select id into req_id
   540|    from public.match_requests
   541|    where from_user_id = auth.uid() and to_user_id = target_user_id;
   542|  end if;
   543|
   544|  return req_id;
   545|end;
   546|$$;
   547|
   548|create or replace function public.rpc_list_match_requests(
   549|  direction text,
   550|  start_index integer default 0,
   551|  limit_count integer default 20
   552|)
   553|returns setof public.match_requests
   554|language sql
   555|security invoker
   556|as $$
   557|  select *
   558|  from public.match_requests
   559|  where (
   560|    direction = 'inbound' and to_user_id = auth.uid()
   561|    or direction = 'outbound' and from_user_id = auth.uid()
   562|  )
   563|  order by created_at desc
   564|  offset greatest(start_index, 0)
   565|  limit least(greatest(limit_count, 0), 50);
   566|$$;
   567|
   568|create or replace function public.rpc_accept_match_request(request_id uuid)
   569|returns void
   570|language plpgsql
   571|security invoker
   572|as $$
   573|declare
   574|  r public.match_requests%rowtype;
   575|  a uuid;
   576|  b uuid;
   577|begin
   578|  select * into r
   579|  from public.match_requests
   580|  where id = request_id
   581|  for update;
   582|
   583|  if not found then
   584|    raise exception 'match request not found';
   585|  end if;
   586|  if r.to_user_id <> auth.uid() then
   587|    raise exception 'only recipient can accept';
   588|  end if;
   589|
   590|  -- Accept == delete request and create match
   591|  delete from public.match_requests
   592|  where id = request_id;
   593|
   594|  a := least(r.from_user_id, r.to_user_id);
   595|  b := greatest(r.from_user_id, r.to_user_id);
   596|  insert into public.user_matches (user_a, user_b)
   597|  values (a, b)
   598|  on conflict (user_a, user_b) do nothing;
   599|end;
   600|$$;
   601|
   602|-- Decline == delete request (recipient-only)
   603|create or replace function public.rpc_decline_match_request(request_id uuid)
   604|returns void
   605|language plpgsql
   606|security invoker
   607|as $$
   608|declare
   609|  r public.match_requests%rowtype;
   610|begin
   611|  delete from public.match_requests
   612|  where id = request_id
   613|    and to_user_id = auth.uid();
   614|end;
   615|$$;
   616|
   617|-- Cancel == delete request (sender-only)
   618|create or replace function public.rpc_cancel_match_request(request_id uuid)
   619|returns void
   620|language plpgsql
   621|security invoker
   622|as $$
   623|begin
   624|  delete from public.match_requests
   625|  where id = request_id
   626|    and from_user_id = auth.uid();
   627|end;
   628|$$;
   629|
   630|create or replace function public.rpc_list_matches(
   631|  start_index integer default 0,
   632|  limit_count integer default 50
   633|)
   634|returns setof public.user_matches
   635|language sql
   636|security invoker
   637|as $$
   638|  select *
   639|  from public.user_matches
   640|  where user_a = auth.uid() or user_b = auth.uid()
   641|  order by created_at desc
   642|  offset greatest(start_index, 0)
   643|  limit least(greatest(limit_count, 0), 200);
   644|$$;
   645|
   646|create or replace function public.rpc_unmatch(match_id uuid)
   647|returns void
   648|language plpgsql
   649|security invoker
   650|as $$
   651|begin
   652|  delete from public.user_matches
   653|  where id = match_id
   654|    and (user_a = auth.uid() or user_b = auth.uid());
   655|end;
   656|$$;
   657|
   658|-- Reports RPCs (two entrypoints; both require target_user_id)
   659|create or replace function public.rpc_report_user(
   660|  target_user_id uuid,
   661|  reason text default null
   662|)
   663|returns uuid
   664|language plpgsql
   665|security invoker
   666|as $$
   667|declare
   668|  rid uuid;
   669|begin
   670|  if target_user_id is null then
   671|    raise exception 'target_user_id is required';
   672|  end if;
   673|  if target_user_id = auth.uid() then
   674|    raise exception 'cannot report self';
   675|  end if;
   676|
   677|  insert into public.reports (reporter_id, target_user_id, target_post_id, reason)
   678|  values (auth.uid(), target_user_id, null, reason)
   679|  returning id into rid;
   680|
   681|  return rid;
   682|end;
   683|$$;
   684|
   685|create or replace function public.rpc_report_post(
   686|  target_user_id uuid,
   687|  target_post_id uuid,
   688|  reason text default null
   689|)
   690|returns uuid
   691|language plpgsql
   692|security invoker
   693|as $$
   694|declare
   695|  rid uuid;
   696|begin
   697|  if target_user_id is null then
   698|    raise exception 'target_user_id is required';
   699|  end if;
   700|  if target_post_id is null then
   701|    raise exception 'target_post_id is required';
   702|  end if;
   703|  if target_user_id = auth.uid() then
   704|    raise exception 'cannot report self';
   705|  end if;
   706|
   707|  insert into public.reports (reporter_id, target_user_id, target_post_id, reason)
   708|  values (auth.uid(), target_user_id, target_post_id, reason)
   709|  returning id into rid;
   710|
   711|  return rid;
   712|end;
   713|$$;
   714|-- Create Storage Bucket for images
   715|insert into storage.buckets (id, name, public) 
   716|values ('images', 'images', true)
   717|on conflict (id) do nothing;
   718|
   719|-- Storage Policies (Allow public read, authenticated insert/update/delete)
   720|-- Note: In a real app, you'd want stricter policies.
   721|drop policy if exists "Public Access" on storage.objects;
   722|create policy "Public Access"
   723|on storage.objects for select
   724|using ( bucket_id = 'images' );
   725|
   726|-- Allow only authenticated users, and only within their own folder: <auth.uid()>/...
   727|drop policy if exists "Authenticated Upload" on storage.objects;
   728|create policy "Authenticated Upload"
   729|on storage.objects for insert
   730|to authenticated
   731|with check (
   732|  bucket_id = 'images'
   733|  and (storage.foldername(name))[1] = auth.uid()::text
   734|);
   735|
   736|drop policy if exists "Authenticated Update" on storage.objects;
   737|create policy "Authenticated Update"
   738|on storage.objects for update
   739|to authenticated
   740|using (
   741|  bucket_id = 'images'
   742|  and (storage.foldername(name))[1] = auth.uid()::text
   743|)
   744|with check (
   745|  bucket_id = 'images'
   746|  and (storage.foldername(name))[1] = auth.uid()::text
   747|);
   748|
   749|drop policy if exists "Authenticated Delete" on storage.objects;
   750|create policy "Authenticated Delete"
   751|on storage.objects for delete
   752|to authenticated
   753|using (
   754|  bucket_id = 'images'
   755|  and (storage.foldername(name))[1] = auth.uid()::text
   756|);
   757|
   758|
   759|-- ==============================================================================
   760|-- CHAT & PUSH NOTIFICATIONS (Added 2024-12-24)
   761|-- ==============================================================================
   762|
   763|-- 1. Store FCM Tokens for Push Notifications
   764|create table if not exists public.user_push_tokens (
   765|  user_id uuid references public.users(userid) on delete cascade not null,
   766|  token text not null,
   767|  platform text check (platform in ('ios', 'android', 'web')),
   768|  updated_at timestamptz default now(),
   769|  primary key (user_id, token)
   770|);
   771|
   772|alter table public.user_push_tokens enable row level security;
   773|
   774|drop policy if exists "Users manage their own tokens" on public.user_push_tokens;
   775|create policy "Users manage their own tokens" on public.user_push_tokens
   776|  using (user_id = auth.uid())
   777|  with check (user_id = auth.uid());
   778|
   779|-- 2. Messages Table
   780|create table if not exists public.messages (
   781|  id uuid primary key default uuid_generate_v4(),
   782|  match_id uuid references public.user_matches(id) on delete cascade not null,
   783|  sender_id uuid references public.users(userid) on delete cascade not null,
   784|  content text, -- Text content
   785|  media_url text, -- Optional for images/audio
   786|  created_at timestamptz default now()
   787|);
   788|
   789|-- RLS: Allow any authenticated user to read and send messages (MVP Loose Mode)
   790|alter table public.messages enable row level security;
   791|
   792|drop policy if exists "Participants can read messages" on public.messages;
   793|drop policy if exists "Authenticated can read all messages" on public.messages;
   794|drop policy if exists "Public can read all messages" on public.messages;
   795|create policy "Public can read all messages" on public.messages
   796|  for select
   797|  to public
   798|  using (true);
   799|
   800|drop policy if exists "Participants can send messages" on public.messages;
   801|drop policy if exists "Authenticated can send messages" on public.messages;
   802|drop policy if exists "Public can send messages" on public.messages;
   803|create policy "Public can send messages" on public.messages
   804|  for insert
   805|  to public
   806|  with check (true);
   807|
   808|-- RPC: Get messages for a match with pagination
   809|create or replace function public.rpc_get_messages(
   810|  match_id uuid,
   811|  start_index integer default 0,
   812|  limit_count integer default 50
   813|)
   814|returns setof public.messages
   815|language sql
   816|security invoker
   817|as $$
   818|  select *
   819|  from public.messages
   820|  where messages.match_id = rpc_get_messages.match_id
   821|  order by created_at desc
   822|  offset greatest(start_index, 0)
   823|  limit least(greatest(limit_count, 0), 100);
   824|$$;
   825|
   826|-- RPC: Send a message (Wrapper for INSERT, simplified for MVP)
   827|-- MODIFIED to accept optional sender_id for Admin debugging without auth
   828|create or replace function public.rpc_send_message(
   829|  match_id uuid,
   830|  content text default null,
   831|  media_url text default null,
   832|  sender_id uuid default null
   833|)
   834|returns public.messages
   835|language plpgsql
   836|security invoker
   837|as $$
   838|declare
   839|  msg public.messages;
   840|  final_sender uuid;
   841|begin
   842|  if match_id is null then
   843|    raise exception 'match_id is required';
   844|  end if;
   845|  if content is null and media_url is null then
   846|    raise exception 'content or media_url is required';
   847|  end if;
   848|
   849|  -- Determine sender: provided id > auth.uid()
   850|  final_sender := coalesce(sender_id, auth.uid());
   851|  
   852|  if final_sender is null then
   853|     raise exception 'sender_id required (not logged in)';
   854|  end if;
   855|
   856|  insert into public.messages (match_id, sender_id, content, media_url)
   857|  values (match_id, final_sender, content, media_url)
   858|  returning * into msg;
   859|
   860|  return msg;
   861|end;
   862|$$;
