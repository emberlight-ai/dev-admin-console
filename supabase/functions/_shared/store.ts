// @ts-nocheck
// Cached loaders shared by the DH edge functions: SystemPrompts (per
// gender:personality), user rows, the global auto-reply switch, and the selfie
// config (global + per-personality overrides). Caches live on globalThis so
// they survive warm invocations on Deno Deploy.
import { supabase } from './clients.ts';

export interface CachedPrompt {
  template: string;
  followUpEnabled: boolean;
  followUpPrompt?: string;
  followUpDelay: number;
  maxFollowUps: number;
  activeGreetingEnabled: boolean;
  activeGreetingPrompt?: string;
  immediateMatchEnabled: boolean;
  // Reply pacing (per personality, configured in the admin Reply pane).
  replyMinDelaySeconds: number;
  replyMaxDelaySeconds: number;
  replyCharsPerSecond: number;
  // Human-like silence: chance the DH does not reply at all.
  skipReplyEnabled: boolean;
  skipReplyBaseChance: number;
  skipReplyIntimacyDropChance: number;
  skipReplyIntimacyDropDelta: number;
  skipReplyMaxConsecutive: number;
  /** Persona's default effort preset (strategies.key); null pre-migration. */
  defaultStrategyKey: string | null;
}

export interface UserRow {
  userid: string;
  is_digital_human: boolean;
  username: string | null;
  gender: string | null;
  personality: string | null;
  age: number | null;
  bio: string | null;
  profession: string | null;
  zipcode: string | null;
  location_name: string | null;
  timezone: string | null;
  storyline: string | null;
  strategy_key: string | null;
}

// One effort preset (strategies table). Owns every cadence knob the old
// SystemPrompts behavior columns carried, plus check-ins/outbound/warmup.
export interface Strategy {
  key: string;
  activeGreetingEnabled: boolean;
  /** Escalating re-engagement gaps in seconds, measured from the match's last
   *  message; length = max follow-ups (empty = never chases). */
  followUpLadder: number[];
  checkInsPerDay: number;
  replyMinDelaySeconds: number;
  replyMaxDelaySeconds: number;
  replyCharsPerSecond: number;
  skipReplyEnabled: boolean;
  skipReplyBaseChance: number;
  skipReplyIntimacyDropChance: number;
  skipReplyIntimacyDropDelta: number;
  skipReplyMaxConsecutive: number;
  outboundEnabled: boolean;
  intimacyWarmupRate: IntimacyWarmupRate;
}

// One skill assigned to a DH: prompt decoration + authorized tool ids.
export interface SkillRow {
  key: string;
  name: string;
  prompt_block: string;
  opener_prompt: string | null;
  sort_order: number;
  tool_ids: string[];
}

const PROMPT_TTL_MS = 60 * 60 * 1000;
const USER_TTL_MS = 10 * 60 * 1000;
export const CONFIG_TTL_MS = 5 * 60 * 1000;

const g = globalThis as any;
let systemPromptCache: Map<string, CachedPrompt> = g.__dhPromptCache ?? new Map();
let lastPromptRefresh: number = g.__dhPromptCacheTs ?? 0;
const userRowCache: Map<string, { value: UserRow; exp: number }> = g.__dhUserCache ?? new Map();
g.__dhUserCache = userRowCache;
let configCache: { autoReplyEnabled: boolean; cooldownMessageThreshold: number; compositionCohort: string; exp: number } =
  g.__dhConfigCache ?? { autoReplyEnabled: true, cooldownMessageThreshold: 0, compositionCohort: '', exp: 0 };

// Coerce a possibly-string numeric column to a number (Postgres `numeric`
// arrives as a string over PostgREST).
export function numOr(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function ensureGlobalConfig() {
  if (Date.now() < configCache.exp) return;
  const { data } = await supabase.from('digital_human_config').select('key, value');
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.key] = r.value;
  configCache = {
    autoReplyEnabled: map['enable_digital_human_auto_response'] !== 'false',
    cooldownMessageThreshold: numOr(map['cooldown_message_threshold'], 0),
    compositionCohort: (map['composition_cohort'] ?? '').trim(),
    exp: Date.now() + CONFIG_TTL_MS,
  };
  g.__dhConfigCache = configCache;
}

/**
 * Migration-safety gate for the composition redesign: '' = nobody (legacy
 * SystemPrompts columns keep driving behavior), 'all' = every DH, otherwise a
 * comma-separated list of DH userids piloting the new path. Temporary — dies
 * at Phase 4.
 */
export async function isInCompositionCohort(dhId: string): Promise<boolean> {
  await ensureGlobalConfig();
  const cohort = configCache.compositionCohort;
  if (!cohort) return false;
  if (cohort.toLowerCase() === 'all') return true;
  return cohort
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes(dhId.toLowerCase());
}

export async function getAutoReplyEnabled(): Promise<boolean> {
  await ensureGlobalConfig();
  return configCache.autoReplyEnabled;
}

// Total messages a user may send before auto-entering cooldown; <= 0 disables.
export async function getCooldownMessageThreshold(): Promise<number> {
  await ensureGlobalConfig();
  return configCache.cooldownMessageThreshold;
}

async function refreshPrompts() {
  const { data } = await supabase
    .from('SystemPrompts')
    .select(
      'gender, personality, system_prompt, immediate_match_enabled, follow_up_message_enabled, follow_up_message_prompt, follow_up_delay, max_follow_ups, active_greeting_enabled, active_greeting_prompt, reply_min_delay_seconds, reply_max_delay_seconds, reply_chars_per_second, skip_reply_enabled, skip_reply_base_chance, skip_reply_intimacy_drop_chance, skip_reply_intimacy_drop_delta, skip_reply_max_consecutive, default_strategy_key, created_at'
    )
    .order('created_at', { ascending: false });

  const newCache = new Map<string, CachedPrompt>();
  for (const row of data ?? []) {
    const key = `${(row.gender || '').trim()}:${(row.personality || '').trim()}`;
    if (newCache.has(key)) continue;
    newCache.set(key, {
      template: row.system_prompt,
      immediateMatchEnabled: row.immediate_match_enabled || false,
      followUpEnabled: row.follow_up_message_enabled || false,
      followUpPrompt: row.follow_up_message_prompt || undefined,
      followUpDelay: row.follow_up_delay || 86400,
      maxFollowUps: row.max_follow_ups ?? 3,
      activeGreetingEnabled: row.active_greeting_enabled || false,
      activeGreetingPrompt: row.active_greeting_prompt || undefined,
      replyMinDelaySeconds: numOr(row.reply_min_delay_seconds, 2),
      replyMaxDelaySeconds: numOr(row.reply_max_delay_seconds, 18),
      replyCharsPerSecond: Math.max(1, numOr(row.reply_chars_per_second, 15)),
      skipReplyEnabled: row.skip_reply_enabled === true,
      skipReplyBaseChance: numOr(row.skip_reply_base_chance, 0.1),
      skipReplyIntimacyDropChance: numOr(row.skip_reply_intimacy_drop_chance, 0.5),
      skipReplyIntimacyDropDelta: numOr(row.skip_reply_intimacy_drop_delta, 5),
      skipReplyMaxConsecutive: numOr(row.skip_reply_max_consecutive, 1),
      defaultStrategyKey: row.default_strategy_key || null,
    });
  }
  systemPromptCache = newCache;
  lastPromptRefresh = Date.now();
  g.__dhPromptCache = systemPromptCache;
  g.__dhPromptCacheTs = lastPromptRefresh;
}

export async function ensurePrompts() {
  if (Date.now() - lastPromptRefresh > PROMPT_TTL_MS) await refreshPrompts();
}

export function getPromptConfig(user: Pick<UserRow, 'gender' | 'personality'>): CachedPrompt | undefined {
  const gnd = (user.gender || 'Female').trim();
  const p = (user.personality || 'General').trim();
  return systemPromptCache.get(`${gnd}:${p}`) ?? systemPromptCache.get(`${gnd}:General`);
}

export async function getUserRow(userid: string): Promise<UserRow | null> {
  const cached = userRowCache.get(userid);
  if (cached && cached.exp > Date.now()) return cached.value;

  const { data, error } = await supabase
    .from('users')
    .select('userid, is_digital_human, username, gender, personality, age, bio, profession, zipcode, location_name, timezone, storyline, strategy_key')
    .eq('userid', userid)
    .single();
  if (error || !data) return null;
  const row = data as unknown as UserRow;
  userRowCache.set(userid, { value: row, exp: Date.now() + USER_TTL_MS });
  return row;
}

// ── Strategies (effort presets) ─────────────────────────────────────────────────
let strategyCache: { value: Map<string, Strategy>; exp: number } =
  g.__dhStrategyCache ?? { value: new Map(), exp: 0 };

export async function getStrategies(): Promise<Map<string, Strategy>> {
  if (Date.now() < strategyCache.exp && strategyCache.value.size > 0) return strategyCache.value;
  const { data, error } = await supabase.from('strategies').select('*');
  if (error) {
    console.error('[dh-store] strategies load failed', error);
    return strategyCache.value; // stale beats none
  }
  const map = new Map<string, Strategy>();
  for (const row of data ?? []) {
    map.set(row.key, {
      key: row.key,
      activeGreetingEnabled: row.active_greeting_enabled === true,
      followUpLadder: Array.isArray(row.follow_up_ladder)
        ? row.follow_up_ladder.map((s: unknown) => numOr(s, 0)).filter((s: number) => s > 0)
        : [],
      checkInsPerDay: numOr(row.check_ins_per_day, 0),
      replyMinDelaySeconds: numOr(row.reply_min_delay_seconds, 2),
      replyMaxDelaySeconds: numOr(row.reply_max_delay_seconds, 18),
      replyCharsPerSecond: Math.max(1, numOr(row.reply_chars_per_second, 15)),
      skipReplyEnabled: row.skip_reply_enabled === true,
      skipReplyBaseChance: numOr(row.skip_reply_base_chance, 0.1),
      skipReplyIntimacyDropChance: numOr(row.skip_reply_intimacy_drop_chance, 0.5),
      skipReplyIntimacyDropDelta: numOr(row.skip_reply_intimacy_drop_delta, 5),
      skipReplyMaxConsecutive: numOr(row.skip_reply_max_consecutive, 1),
      outboundEnabled: row.outbound_enabled === true,
      intimacyWarmupRate: parseWarmupRate(row.intimacy_warmup_rate),
    });
  }
  strategyCache = { value: map, exp: Date.now() + CONFIG_TTL_MS };
  g.__dhStrategyCache = strategyCache;
  return map;
}

/** users.strategy_key → persona default_strategy_key → 'medium_effort'. */
export async function resolveStrategy(
  bot: Pick<UserRow, 'strategy_key'>,
  promptConfig: Pick<CachedPrompt, 'defaultStrategyKey'> | undefined
): Promise<Strategy | null> {
  const strategies = await getStrategies();
  return (
    (bot.strategy_key ? strategies.get(bot.strategy_key) : undefined) ??
    (promptConfig?.defaultStrategyKey ? strategies.get(promptConfig.defaultStrategyKey) : undefined) ??
    strategies.get('medium_effort') ??
    null
  );
}

// ── Skills (per-DH decorators + authorized tools) ──────────────────────────────
const skillsCache: Map<string, { value: SkillRow[]; exp: number }> =
  g.__dhSkillsCache instanceof Map ? g.__dhSkillsCache : new Map();
g.__dhSkillsCache = skillsCache;

export async function getSkillsForUser(userid: string): Promise<SkillRow[]> {
  const cached = skillsCache.get(userid);
  if (cached && cached.exp > Date.now()) return cached.value;

  const { data, error } = await supabase
    .from('dh_skills')
    .select('skill_key, skills!inner(key, name, prompt_block, opener_prompt, sort_order, active, skill_tools(tool_id))')
    .eq('user_id', userid);
  if (error) {
    console.error('[dh-store] skills load failed', userid, error);
    return cached?.value ?? [];
  }
  const rows: SkillRow[] = [];
  for (const r of data ?? []) {
    const s = r.skills;
    if (!s || s.active !== true) continue;
    rows.push({
      key: s.key,
      name: s.name,
      prompt_block: s.prompt_block,
      opener_prompt: s.opener_prompt ?? null,
      sort_order: numOr(s.sort_order, 100),
      tool_ids: (s.skill_tools ?? []).map((t: { tool_id: string }) => t.tool_id),
    });
  }
  rows.sort((a, b) => a.sort_order - b.sort_order || a.key.localeCompare(b.key));
  skillsCache.set(userid, { value: rows, exp: Date.now() + CONFIG_TTL_MS });
  return rows;
}

// ── Interests (identity tags → the prompt's bot profile) ───────────────────────
// admin_only keys (whitelist, featured) are OPS controls, never identity.
const interestsCache: Map<string, { value: string[]; exp: number }> =
  g.__dhInterestsCache instanceof Map ? g.__dhInterestsCache : new Map();
g.__dhInterestsCache = interestsCache;

export async function getUserInterestNames(userid: string): Promise<string[]> {
  const cached = interestsCache.get(userid);
  if (cached && cached.exp > Date.now()) return cached.value;

  const { data, error } = await supabase
    .from('user_interests')
    .select('interests!inner(name, active, admin_only, sort_order)')
    .eq('user_id', userid);
  if (error) {
    console.error('[dh-store] interests load failed', userid, error);
    return cached?.value ?? [];
  }
  const names = (data ?? [])
    .map((r) => r.interests)
    .filter((i) => i && i.active === true && i.admin_only !== true)
    .sort((a, b) => numOr(a.sort_order, 100) - numOr(b.sort_order, 100))
    .map((i) => i.name);
  interestsCache.set(userid, { value: names, exp: Date.now() + USER_TTL_MS });
  return names;
}

// ── Selfie config (global digital_human_config + per-personality overrides) ────
export type IntimacyWarmupRate = 'very_low' | 'low' | 'normal' | 'high' | 'very_high' | 'extreme';

export type SelfieConfig = {
  enabled: boolean;
  threshold: number;
  teaseThreshold: number;
  rewardThreshold: number;
  cooldownMinutes: number;
  reciprocateGapMinutes: number;
  reciprocateOnUserImage: boolean;
  earlyCasualAfterMessages: number;
  earlyCasualMaxIntimacy: number;
  warmupRate: IntimacyWarmupRate;
};

type SelfieConfigCacheEntry = { value: SelfieConfig; exp: number };
const selfieCfgCache: Map<string, SelfieConfigCacheEntry> =
  g.__dhSelfieCfgByPersonality instanceof Map ? g.__dhSelfieCfgByPersonality : new Map();
g.__dhSelfieCfgByPersonality = selfieCfgCache;

function parseWarmupRate(raw: string | undefined): IntimacyWarmupRate {
  if (
    raw === 'very_low' || raw === 'low' || raw === 'normal' ||
    raw === 'high' || raw === 'very_high' || raw === 'extreme'
  ) {
    return raw;
  }
  if (raw === 'extremely_high') return 'extreme';
  return 'normal';
}

export async function getSelfieConfig(personality?: string | null): Promise<SelfieConfig> {
  const cacheKey = personality?.trim() || '__global__';
  const cached = selfieCfgCache.get(cacheKey);
  if (cached && Date.now() < cached.exp) return cached.value;

  const { data } = await supabase.from('digital_human_config').select('key, value');
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.key] = r.value;

  if (personality?.trim()) {
    const { data: overrides, error } = await supabase
      .from('digital_human_personality_config')
      .select('key, value')
      .eq('personality', personality.trim());
    if (error) {
      console.error('[dh-shared] Failed to load personality config overrides', { personality, error: error.message });
    } else {
      for (const r of overrides ?? []) map[r.key] = r.value;
    }
  }

  // Fall back ONLY when the value is missing or non-numeric — an intentional 0
  // (e.g. "no gap, reciprocate every time") is honored.
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  const value: SelfieConfig = {
    enabled: map['enable_digital_human_selfies'] !== 'false',
    threshold: num(map['selfie_intimacy_threshold'], 55),
    teaseThreshold: num(map['selfie_tease_intimacy_threshold'], 45),
    rewardThreshold: num(map['selfie_reward_intimacy_threshold'], 75),
    cooldownMinutes: num(map['selfie_cooldown_minutes'], 30),
    reciprocateGapMinutes: num(map['selfie_reciprocate_gap_minutes'], 2),
    reciprocateOnUserImage: map['enable_selfie_reciprocation'] !== 'false',
    earlyCasualAfterMessages: num(map['selfie_early_casual_after_messages'], 2),
    earlyCasualMaxIntimacy: num(map['selfie_early_casual_max_intimacy'], 45),
    warmupRate: parseWarmupRate(map['intimacy_warmup_rate']),
  };
  selfieCfgCache.set(cacheKey, { value, exp: Date.now() + CONFIG_TTL_MS });
  return value;
}
