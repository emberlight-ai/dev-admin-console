-- Rename a personality across every table that keys off it, atomically.
--
-- `personality` is the join key between three places:
--   * SystemPrompts          (gender, personality)        -- versioned prompt templates
--   * users                  (gender, personality)        -- live digital humans
--   * digital_human_personality_config (personality)      -- shared per-personality overrides
--
-- The dh-auto-reply / dh-greeting / dh-followup edge functions look the prompt
-- up at runtime by (gender, personality), so renaming only SystemPrompts would
-- silently orphan every live digital human using that name. This cascades the
-- rename in a single transaction and returns how many rows each part touched.
create or replace function public.rpc_rename_personality(
  p_gender text,
  p_old text,
  p_new text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gender text := btrim(p_gender);
  v_old text := btrim(p_old);
  v_new text := btrim(p_new);
  v_prompts int := 0;
  v_dhs int := 0;
  v_configs int := 0;
  v_safe_to_move_config boolean;
begin
  if v_gender = '' then
    raise exception 'gender is required' using errcode = 'check_violation';
  end if;
  if v_old = '' or v_new = '' then
    raise exception 'personality name is required' using errcode = 'check_violation';
  end if;
  if lower(v_old) = lower(v_new) then
    raise exception 'New name matches the current name' using errcode = 'check_violation';
  end if;

  -- The personality being renamed must exist.
  if not exists (
    select 1 from public."SystemPrompts"
    where gender = v_gender and personality = v_old
  ) then
    raise exception 'No prompt found for % / %', v_gender, v_old using errcode = 'no_data_found';
  end if;

  -- Collision: another personality of the SAME gender already uses the new name.
  if exists (
    select 1 from public."SystemPrompts"
    where gender = v_gender and personality = v_new
  ) then
    raise exception 'PERSONALITY_NAME_TAKEN' using errcode = 'unique_violation';
  end if;

  -- 1) Prompt templates — every version of this (gender, personality).
  update public."SystemPrompts"
  set personality = v_new
  where gender = v_gender and personality = v_old;
  get diagnostics v_prompts = row_count;

  -- 2) Live digital humans of this gender assigned the old personality.
  update public.users
  set personality = v_new
  where gender = v_gender and personality = v_old and is_digital_human = true;
  get diagnostics v_dhs = row_count;

  -- 3) Per-personality config overrides. This table is keyed by personality
  --    only (not gender), so the overrides are shared if a same-named
  --    personality of the *other* gender still exists. Only migrate them when
  --    the old name is no longer used by any gender; otherwise leave them with
  --    the personality that still owns them.
  select not exists (
    select 1 from public."SystemPrompts" where personality = v_old
  ) into v_safe_to_move_config;

  if v_safe_to_move_config then
    -- Move overrides whose key doesn't already exist under the new name...
    update public.digital_human_personality_config c
    set personality = v_new
    where c.personality = v_old
      and not exists (
        select 1 from public.digital_human_personality_config c2
        where c2.personality = v_new and c2.key = c.key
      );
    get diagnostics v_configs = row_count;
    -- ...and drop any leftovers whose key already existed under the new name
    --    (the existing new-name override wins).
    delete from public.digital_human_personality_config
    where personality = v_old;
  end if;

  return jsonb_build_object(
    'gender', v_gender,
    'old', v_old,
    'new', v_new,
    'prompts_updated', v_prompts,
    'digital_humans_updated', v_dhs,
    'config_overrides_updated', v_configs
  );
end;
$$;

grant execute on function public.rpc_rename_personality(text, text, text) to service_role;
