// @ts-nocheck
// Supabase Edge Function (Deno runtime) — replaces scripts/digital-human-auto-replies.ts
// Triggered by: DB Webhook on `messages` table INSERT
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { VertexAI, HarmCategory, HarmBlockThreshold } from 'npm:@google-cloud/vertexai';
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';

// ── Clients ────────────────────────────────────────────────────────────────────
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const project = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID') || 'YOUR_PROJECT_ID';
const location = Deno.env.get('GOOGLE_CLOUD_LOCATION') || 'global';
const clientEmail = Deno.env.get('GOOGLE_CLIENT_EMAIL');
const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

const vertexAI = new VertexAI({
  project,
  location,
  apiEndpoint: 'aiplatform.googleapis.com',
  ...(clientEmail && privateKey
    ? {
        googleAuthOptions: {
          credentials: {
            client_email: clientEmail,
            private_key: privateKey,
          },
        },
      }
    : {}),
});

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

// Utility model (cheap/fast): intimacy critic + image description.
const model = vertexAI.getGenerativeModel({
  model: Deno.env.get('AI_INTEGRATIONS_GEMINI_MODEL') ?? 'gemini-3.1-flash-lite-preview',
  safetySettings,
});

// Reply model (higher quality): the user-facing message. Gemini 3 Pro follows
// long, nuanced persona prompts far better than flash-lite (which tends to
// flatten into generic replies). Override via the AI_REPLY_MODEL secret if your
// Google Cloud project exposes a different id.
const replyModel = vertexAI.getGenerativeModel({
  model: Deno.env.get('AI_REPLY_MODEL') ?? 'gemini-3-pro-preview',
  safetySettings,
});

// Generate the user-facing reply with the Pro model, falling back to the utility
// model if the configured reply model id is unavailable — so a bad id degrades
// gracefully instead of breaking replies in production.
async function generateReply(prompt: string) {
  try {
    return await replyModel.generateContent(prompt);
  } catch (err) {
    console.error('[dh-auto-reply] reply model failed; falling back to utility model', err);
    return await model.generateContent(prompt);
  }
}

// ── In-process cache (survives warm invocations on Deno Deploy) ───────────────
interface CachedPrompt {
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
}

interface UserRow {
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
}

const globalPromptCache = (globalThis as any).__dhPromptCache as Map<string, CachedPrompt> | undefined;
const globalPromptCacheTs = (globalThis as any).__dhPromptCacheTs as number | undefined;
let systemPromptCache: Map<string, CachedPrompt> = globalPromptCache ?? new Map();
let lastPromptRefresh = globalPromptCacheTs ?? 0;
const PROMPT_TTL_MS = 60 * 60 * 1000; // 1 hour

const globalUserCache = (globalThis as any).__dhUserCache as Map<string, { value: UserRow; exp: number }> | undefined;
let userRowCache: Map<string, { value: UserRow; exp: number }> = globalUserCache ?? new Map();
const USER_TTL_MS = 10 * 60 * 1000;

const globalConfigCache = (globalThis as any).__dhConfigCache as { autoReplyEnabled: boolean; exp: number } | undefined;
let configCache: { autoReplyEnabled: boolean; exp: number } = globalConfigCache ?? { autoReplyEnabled: true, exp: 0 };
const CONFIG_TTL_MS = 5 * 60 * 1000;

// Covers generation + the human-like send delay (step 11b, up to ~18s) plus the
// trailing send/selfie/state writes, so the lock never expires mid-reply and let
// a concurrent invocation double-reply.
const LOCK_DURATION_SECONDS = 45;

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getAutoReplyEnabled(): Promise<boolean> {
  if (Date.now() < configCache.exp) return configCache.autoReplyEnabled;
  const { data } = await supabase.from('digital_human_config').select('key, value');
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.key] = r.value;
  configCache = {
    autoReplyEnabled: map['enable_digital_human_auto_response'] !== 'false',
    exp: Date.now() + CONFIG_TTL_MS,
  };
  (globalThis as any).__dhConfigCache = configCache;
  return configCache.autoReplyEnabled;
}

// Coerce a possibly-string numeric column to a number, falling back when missing
// or non-numeric (Postgres `numeric` arrives as a string over PostgREST).
function numOr(raw: unknown, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function refreshPrompts() {
  const { data } = await supabase
    .from('SystemPrompts')
    .select(
      'gender, personality, system_prompt, immediate_match_enabled, follow_up_message_enabled, follow_up_message_prompt, follow_up_delay, max_follow_ups, active_greeting_enabled, active_greeting_prompt, reply_min_delay_seconds, reply_max_delay_seconds, reply_chars_per_second, skip_reply_enabled, skip_reply_base_chance, skip_reply_intimacy_drop_chance, skip_reply_intimacy_drop_delta, skip_reply_max_consecutive, created_at'
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
    });
  }
  systemPromptCache = newCache;
  lastPromptRefresh = Date.now();
  (globalThis as any).__dhPromptCache = systemPromptCache;
  (globalThis as any).__dhPromptCacheTs = lastPromptRefresh;
}

async function ensurePrompts() {
  if (Date.now() - lastPromptRefresh > PROMPT_TTL_MS) await refreshPrompts();
}

async function getUserRow(userid: string): Promise<UserRow | null> {
  const cached = userRowCache.get(userid);
  if (cached && cached.exp > Date.now()) return cached.value;

  const { data, error } = await supabase
    .from('users')
    .select('userid, is_digital_human, username, gender, personality, age, bio, profession, zipcode, location_name, timezone, storyline')
    .eq('userid', userid)
    .single();
  if (error || !data) return null;
  const row = data as unknown as UserRow;
  const entry = { value: row, exp: Date.now() + USER_TTL_MS };
  userRowCache.set(userid, entry);
  (globalThis as any).__dhUserCache = userRowCache;
  return row;
}

function getPromptConfig(user: Pick<UserRow, 'gender' | 'personality'>): CachedPrompt | undefined {
  const g = (user.gender || 'Female').trim();
  const p = (user.personality || 'General').trim();
  return systemPromptCache.get(`${g}:${p}`) ?? systemPromptCache.get(`${g}:General`);
}

// Inline transcript builder (cannot import from src/ in Deno runtime)
function buildTranscript(
  messages: Array<{ sender_id: string; content: string | null; media_url?: string | null; image_desc?: string | null }>,
  botUserId: string,
  botName: string
): string {
  return messages
    .map((m) => {
      const speaker = m.sender_id === botUserId ? botName : 'User';
      let text = m.content || '';
      if (m.media_url) {
        if (m.image_desc) {
          text += `\n[User sent an image described as: ${m.image_desc}]`;
        } else {
          text += `\n[User sent an image]`;
        }
      }
      return `${speaker}: ${text.trim()}`;
    })
    .join('\n');
}

// Inline botProfile helpers
function generateBotProfileBlock(input: {
  name: string;
  age?: number | null;
  archetype?: string | null;
  bio?: string | null;
}): string {
  return `<bot_profile>
**Name:** ${input.name || 'Unknown'}
**Age:** ${input.age ?? '—'}
**Archetype:** ${input.archetype || 'Digital Human'}
**Background:** ${input.bio || '—'}
</bot_profile>`;
}

// User-local time, computed server-side from the stored IANA timezone. We no
// longer ask the model to convert UTC via zipcode (unreliable, and zipcode is
// mostly empty). Falls back to Pacific when the timezone is unknown.
const DEFAULT_TZ = 'America/Los_Angeles';
function describeLocalTime(timezone?: string | null): string {
  const tz = timezone || DEFAULT_TZ;
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(now);
    const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
    const h23 = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now)
    );
    const partOfDay =
      h23 < 5 ? 'late at night' : h23 < 12 ? 'in the morning' : h23 < 17 ? 'in the afternoon' : h23 < 21 ? 'in the evening' : 'at night';
    const approx = timezone ? '' : ' (approx — timezone unknown)';
    return `${get('weekday')} ${get('hour')}:${get('minute')} ${get('dayPeriod')}, ${partOfDay}${approx}`;
  } catch {
    return new Date().toISOString();
  }
}

function generateUserProfileBlock(input: {
  username?: string | null;
  age?: number | null;
  bio?: string | null;
  locationName?: string | null;
  profession?: string | null;
  timezone?: string | null;
}): string {
  return `<user_profile>
**Username:** ${input.username || 'N/A'}
**Bio:** ${input.bio || 'N/A'}
**Age:** ${input.age ?? '—'}
**Location:** ${input.locationName || 'Unknown'}
**Profession:** ${input.profession || 'N/A'}
**Their local time right now:** ${describeLocalTime(input.timezone)}
</user_profile>`;
}

// The system prompt may carry a <bot_storyline> data-input block. When the DH has
// a storyline, fill the BOT_STORYLINE_DETAILS placeholder; when it doesn't, strip
// the whole block (and an optional "### DATA INPUTS" header) so the model never
// sees the bare marker.
const STORYLINE_PLACEHOLDER_RE = /<bot_storyline>[\s\r\n]*BOT_STORYLINE_DETAILS[\s\r\n]*<\/bot_storyline>/i;
const STORYLINE_BLOCK_RE = /\n*(?:#{1,6}\s*DATA INPUTS[^\n]*\n+)?<bot_storyline>[\s\S]*?<\/bot_storyline>\n*/i;

function applyStoryline(prompt: string, storyline?: string | null): string {
  const s = (storyline ?? '').trim();
  if (s) return prompt.replace(STORYLINE_PLACEHOLDER_RE, `<bot_storyline>\n${s}\n</bot_storyline>`);
  return prompt.replace(STORYLINE_BLOCK_RE, '\n');
}

function composeSystemInstruction(template: string, bot: UserRow, human: UserRow): string {
  const botBlock = generateBotProfileBlock({
    name: bot.username ?? 'Digital Human',
    age: bot.age,
    archetype: bot.profession,
    bio: bot.bio,
  });
  const userBlock = generateUserProfileBlock({
    username: human.username,
    age: human.age,
    bio: human.bio,
    locationName: human.location_name,
    profession: human.profession,
    timezone: human.timezone,
  });

  let prompt = template;
  prompt = prompt.replace(/<bot_profile>[\s\r\n]*BOT_PROFILE_DETAILS[\s\r\n]*<\/bot_profile>/i, botBlock);
  prompt = prompt.replace(/<user_profile>[\s\r\n]*USER_PROFILE_DETAILS[\s\r\n]*<\/user_profile>/i, userBlock);
  prompt = applyStoryline(prompt, bot.storyline);
  return prompt;
}

// ── Intimacy critic + Adam-style momentum + selfie picker ─────────────────────
type IntimacyWarmupRate = 'very_low' | 'low' | 'normal' | 'high' | 'very_high' | 'extreme';

type SelfieConfig = {
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

const globalSelfieCfg = (globalThis as any).__dhSelfieCfgByPersonality as
  | Map<string, SelfieConfigCacheEntry>
  | undefined;
const selfieCfgCache =
  globalSelfieCfg instanceof Map ? globalSelfieCfg : new Map<string, SelfieConfigCacheEntry>();
(globalThis as any).__dhSelfieCfgByPersonality = selfieCfgCache;

function parseWarmupRate(raw: string | undefined): IntimacyWarmupRate {
  if (
    raw === 'very_low' ||
    raw === 'low' ||
    raw === 'normal' ||
    raw === 'high' ||
    raw === 'very_high' ||
    raw === 'extreme'
  ) {
    return raw;
  }
  if (raw === 'extremely_high') return 'extreme';
  return 'normal';
}

function warmupGuidance(rate: IntimacyWarmupRate) {
  switch (rate) {
    case 'very_low':
      return 'VERY LOW: be very conservative. If the user is warming up, usually raise intimacy by 0-2 points from the previous score; use 3-4 only for unusually clear romantic/sexual interest.';
    case 'low':
      return 'LOW: be conservative. If the user is warming up, usually raise intimacy by 0-4 points from the previous score; use 5-8 only for unusually clear romantic/sexual interest.';
    case 'high':
      return 'HIGH: be responsive. If the user is warming up, usually raise intimacy by 5-12 points from the previous score; use 13-18 only for strong, explicit interest.';
    case 'very_high':
      return 'VERY HIGH: warm up quickly but stay evidence-based. If the user is warming up, usually raise intimacy by 8-18 points from the previous score; use 19-25 only for very strong, explicit interest.';
    case 'extreme':
      return 'EXTREME: warm up very quickly, but still do not ignore the user signal. If the user is warming up, usually raise intimacy by 12-25 points from the previous score; use 26-35 only for very explicit, sustained interest. Never jump straight to 100 from a cold conversation.';
    case 'normal':
    default:
      return 'NORMAL: be balanced. If the user is warming up, usually raise intimacy by 2-8 points from the previous score; use 9-12 only for clear romantic/sexual interest.';
  }
}

function normalizeIntimacyScore(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const score = n > 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, score));
}

async function getSelfieConfig(personality?: string | null): Promise<SelfieConfig> {
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
      console.error('[dh-auto-reply] Failed to load personality config overrides', {
        personality,
        error: error.message,
      });
    } else {
      for (const r of overrides ?? []) map[r.key] = r.value;
    }
  }

  // Parse a numeric knob, falling back ONLY when the value is missing or
  // non-numeric — so an intentional 0 (e.g. "no gap, reciprocate every time")
  // is honored instead of being clobbered by a truthiness `|| default`.
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  };
  // Spontaneous (intimacy-driven) selfies are paced by `cooldownMinutes`. The
  // legacy `selfie_cooldown_hours` key (3h) is intentionally NOT read anymore —
  // it was the reason a DH only ever sent one selfie per conversation.
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

interface IntimacyResult {
  intimacy: number;            // 0-100 current closeness from the user's side
  selfieAppropriate: boolean;  // would sharing a personal selfie feel natural/welcome now?
  userRequestedPhoto: boolean; // did the user explicitly ask to see them / a pic?
}

type ImageTier = 'casual' | 'tease' | 'reward';

const IMAGE_TIER_RANK: Record<ImageTier, number> = {
  casual: 0,
  tease: 1,
  reward: 2,
};

function tierForIntimacy(
  intimacy: number,
  cfg: { teaseThreshold: number; rewardThreshold: number }
): ImageTier {
  if (intimacy >= cfg.rewardThreshold) return 'reward';
  if (intimacy >= cfg.teaseThreshold) return 'tease';
  return 'casual';
}

type SendMessageResult = {
  data: { id?: string } | null;
  error: unknown | null;
};

function canRetryWithoutIntimacyScore(error: unknown) {
  const err = error as { code?: string; message?: string } | null;
  const message = err?.message ?? String(error ?? '');
  return (
    err?.code === 'PGRST202' ||
    message.includes('message_intimacy_score') ||
    message.includes('intimacy_score') ||
    (message.includes('rpc_send_message') && message.includes('schema cache'))
  );
}

async function sendMessageWithOptionalIntimacy(args: {
  matchId: string;
  senderId: string;
  content?: string | null;
  mediaUrl?: string | null;
  intimacyScore?: number | null;
}): Promise<SendMessageResult> {
  const baseArgs = {
    match_id: args.matchId,
    ...(args.content ? { content: args.content } : {}),
    ...(args.mediaUrl ? { media_url: args.mediaUrl } : {}),
    sender_id: args.senderId,
  };

  const withScore = await supabase.rpc('rpc_send_message', {
    ...baseArgs,
    message_intimacy_score: args.intimacyScore ?? null,
  });

  if (!withScore.error || !canRetryWithoutIntimacyScore(withScore.error)) {
    return withScore as SendMessageResult;
  }

  console.error(
    '[dh-auto-reply] rpc_send_message rejected message_intimacy_score; retrying legacy signature',
    withScore.error
  );
  const legacy = await supabase.rpc('rpc_send_message', baseArgs);

  const messageId = (legacy.data as { id?: string } | null)?.id;
  if (!legacy.error && messageId && args.intimacyScore != null) {
    const { error: updateErr } = await supabase
      .from('messages')
      .update({ intimacy_score: args.intimacyScore })
      .eq('id', messageId);

    if (updateErr) {
      console.error('[dh-auto-reply] Failed to backfill message intimacy_score after legacy send', updateErr);
    }
  }

  return legacy as SendMessageResult;
}

// A separate "referee" call, kept apart from reply generation so it can't game
// its own score. Uses structured JSON output for a reliable parse.
async function scoreIntimacy(
  systemText: string,
  transcript: string,
  previousScore: number | null,
  warmupRate: IntimacyWarmupRate
): Promise<IntimacyResult | null> {
  try {
    const previous = previousScore == null ? 'unknown' : String(normalizeIntimacyScore(previousScore));
    const judgePrompt = `${systemText}

You are an objective relationship analyst observing the conversation below. Do NOT role-play or reply. Judge the CURRENT emotional/romantic closeness from the user's side, and whether the digital human sharing a personal selfie would feel natural and welcome right at this moment.

Previous intimacy score: ${previous} on a 0-100 scale.
Relationship warm-up rate: ${warmupRate}.
Warm-up guidance: ${warmupGuidance(warmupRate)}

Return the new CURRENT intimacy score on a 0-100 scale. Do not return a 0-1 fraction. Avoid both extremes: do not freeze the score when the user clearly warms up, and do not jump to a near-maximum score from one mildly positive message.

Conversation:
${transcript}

Respond with JSON only.`;
    const res = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: judgePrompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            intimacy: { type: 'NUMBER' },
            selfie_appropriate: { type: 'BOOLEAN' },
            user_requested_photo: { type: 'BOOLEAN' },
          },
          required: ['intimacy', 'selfie_appropriate', 'user_requested_photo'],
        },
      },
    });
    const txt =
      res.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? res.response?.text?.() ?? '';
    const parsed = JSON.parse(txt);
    const intimacy = normalizeIntimacyScore(parsed.intimacy);
    return {
      intimacy,
      selfieAppropriate: !!parsed.selfie_appropriate,
      userRequestedPhoto: !!parsed.user_requested_photo,
    };
  } catch (e) {
    console.error('[dh-auto-reply] intimacy critic failed', e);
    return null;
  }
}

// Adam-style update on the intimacy signal: g = gradient (score change),
// m = velocity (1st moment), v = variance (2nd moment). `drive` saturates near
// +/-1 for steady trends, so downstream cadence can scale smoothly.
function adamStep(prevScore: number | null, m: number, v: number, score: number) {
  const B1 = 0.8;
  const B2 = 0.9;
  const EPS = 1e-3;
  const g = prevScore == null ? 0 : score - prevScore;
  const nm = B1 * m + (1 - B1) * g;
  const nv = B2 * v + (1 - B2) * g * g;
  const drive = nm / (Math.sqrt(nv) + EPS);
  return { m: nm, v: nv, drive };
}

// Lowest-ordinal selfie this DH hasn't already sent in this match (progressive release).
async function pickUnsentSelfie(
  dhId: string,
  matchId: string,
  tier: ImageTier
): Promise<{ id: string; public_url: string; ordinal: number; image_tier: ImageTier } | null> {
  const { data: imgs } = await supabase
    .from('dh_chat_images')
    .select('id, public_url, ordinal, image_tier')
    .eq('dh_user_id', dhId)
    .eq('image_tier', tier)
    .eq('active', true)
    .order('ordinal', { ascending: true });
  if (!imgs || imgs.length === 0) return null;
  const { data: sent } = await supabase
    .from('dh_sent_images')
    .select('image_id')
    .eq('match_id', matchId);
  const sentIds = new Set((sent ?? []).map((s: { image_id: string }) => s.image_id));
  return (
    (imgs as Array<{ id: string; public_url: string; ordinal: number; image_tier: ImageTier }>).find(
      (img) => !sentIds.has(img.id)
    ) ?? null
  );
}

async function getHighestSentSelfieTier(matchId: string): Promise<ImageTier | null> {
  const { data: sent } = await supabase
    .from('dh_sent_images')
    .select('image_id')
    .eq('match_id', matchId);
  const imageIds = Array.from(
    new Set((sent ?? []).map((s: { image_id?: string | null }) => s.image_id).filter(Boolean))
  ) as string[];
  if (imageIds.length === 0) return null;

  const { data: imgs } = await supabase
    .from('dh_chat_images')
    .select('id, image_tier')
    .in('id', imageIds);

  let highest: ImageTier | null = null;
  for (const img of imgs ?? []) {
    const tier = (img as { image_tier?: string | null }).image_tier;
    if (tier !== 'casual' && tier !== 'tease' && tier !== 'reward') continue;
    if (!highest || IMAGE_TIER_RANK[tier] > IMAGE_TIER_RANK[highest]) highest = tier;
  }
  return highest;
}

// ── Webhook payload ───────────────────────────────────────────────────────────
interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: {
    id: string;
    match_id: string;
    sender_id: string;
    receiver_id?: string;
    content: string | null;
    media_url?: string | null;
    created_at: string;
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();

    if (payload.type !== 'INSERT' || payload.table !== 'messages') {
      return new Response('Ignored', { status: 200 });
    }

    const { record } = payload;
    const matchId = record.match_id;
    const senderId = record.sender_id;
    const startTime = Date.now(); // timer for the natural typing delay (step 11b)

    // 1. Bail-out checks
    if (!(await getAutoReplyEnabled())) {
      return new Response('Auto-reply disabled', { status: 200 });
    }

    await ensurePrompts();

    // 2. Fetch ai state for this match
    const { data: stateData, error: stateErr } = await supabase
      .from('user_match_ai_state')
      .select('match_id, last_message_id, last_message_at, ai_last_processed_message_id, ai_locked_until, dh_user_id, real_user_id, ai_state, intimacy_score, intimacy_m, intimacy_v, last_selfie_sent_at')
      .eq('match_id', matchId)
      .single();

    if (stateErr || !stateData) {
      console.error('[dh-auto-reply] No ai state for match', matchId, stateErr);
      return new Response('No ai state', { status: 200 });
    }

    const dhId: string = stateData.dh_user_id;
    const realId: string = stateData.real_user_id;

    if (!dhId || !realId) {
      console.warn('[dh-auto-reply] Missing dh/real IDs for match', matchId);
      return new Response('Missing IDs', { status: 200 });
    }

    // 3. Skip if the message was sent BY the digital human (avoid reply loops)
    if (senderId === dhId) {
      return new Response('Sender is DH, skip', { status: 200 });
    }

    // 4. Skip if already locked (another invocation is handling it)
    if (stateData.ai_locked_until && new Date(stateData.ai_locked_until).getTime() > Date.now()) {
      console.log('[dh-auto-reply] Match locked, skip', matchId);
      return new Response('Locked', { status: 200 });
    }

    // 5. Skip idempotency check — already processed this message
    if (stateData.last_message_id === stateData.ai_last_processed_message_id) {
      return new Response('Already processed', { status: 200 });
    }

    // 6. Fetch bot and human profiles
    const [bot, human] = await Promise.all([getUserRow(dhId), getUserRow(realId)]);
    if (!bot || !human || !bot.is_digital_human) {
      return new Response('Invalid users', { status: 200 });
    }

    const promptConfig = getPromptConfig(bot);

    // 8. Acquire lock. The window must outlast generation + the configured
    //    human-like send delay (step 11b) so it can't expire mid-reply and let a
    //    concurrent webhook double-reply. Size it to the personality's max delay.
    const configuredMaxDelaySec = Math.min(60, Math.max(0, promptConfig?.replyMaxDelaySeconds ?? 18));
    const lockSeconds = Math.min(120, Math.max(LOCK_DURATION_SECONDS, configuredMaxDelaySec + 25));
    const lockTime = new Date(Date.now() + lockSeconds * 1000).toISOString();
    const { error: lockErr } = await supabase
      .from('user_match_ai_state')
      .update({ ai_locked_until: lockTime })
      .eq('match_id', matchId)
      .is('ai_locked_until', null); // Optimistic lock — only succeeds if not locked
    if (lockErr) {
      console.log('[dh-auto-reply] Failed to acquire lock for', matchId);
      return new Response('Lock contention', { status: 200 });
    }

    try {
      // 9. Fetch conversation history
      const { data: messages } = await supabase.rpc('rpc_get_messages', {
        match_id: matchId,
        limit_count: 50,
        start_index: 0,
      });
      const msgRows = (messages ?? []) as Array<{ id: string; sender_id: string; content: string | null; media_url?: string | null; image_desc?: string | null }>;
      if (msgRows.length === 0) throw new Error('No messages found');

      // Checkpoint: the latest message from the real user
      const latestUserMsg = msgRows.find((m) => m.sender_id !== dhId);
      const checkpointId = latestUserMsg?.id ?? stateData.last_message_id;

      // --- NEW IMAGE PARSING LOGIC ---
      if (latestUserMsg && latestUserMsg.media_url && !latestUserMsg.image_desc) {
        try {
          console.log('[dh-auto-reply] Generating image description for', latestUserMsg.id);
          const imgRes = await fetch(latestUserMsg.media_url);
          if (imgRes.ok) {
            const arrayBuffer = await imgRes.arrayBuffer();
            const base64Data = encodeBase64(new Uint8Array(arrayBuffer));
            const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
            
            const descPrompt = {
              contents: [{
                role: 'user',
                parts: [
                  {
                    inlineData: {
                      data: base64Data,
                      mimeType: mimeType
                    }
                  },
                  { text: "Describe this image in detail. It was sent to you in an intimate/friendly chat. What does it show? Be descriptive as this will replace the image in your memory." }
                ]
              }]
            };
            
            const descResult = await model.generateContent(descPrompt);
            const responseData = await descResult.response;
            const generatedDesc = responseData?.candidates?.[0]?.content?.parts?.[0]?.text || responseData?.text?.() || "No description generated.";
            
            // Save to DB
            const { error: updateErr } = await supabase
              .from('messages')
              .update({ image_desc: generatedDesc })
              .eq('id', latestUserMsg.id);
            
            if (updateErr) console.error('[dh-auto-reply] Error saving image_desc', updateErr);
            
            // Update in-memory row for transcript builder
            latestUserMsg.image_desc = generatedDesc;
          } else {
            console.error('[dh-auto-reply] Failed to fetch media url', latestUserMsg.media_url);
          }
        } catch (mediaErr) {
          console.error('[dh-auto-reply] Error fetching/describing media', mediaErr);
        }
      }
      // -------------------------------

      // 10. Build prompt
      const template =
        promptConfig?.template ??
        `You are ${bot.username ?? 'a digital human'}. Personality: ${bot.personality ?? 'Friendly'}. Bio: ${bot.bio ?? 'N/A'}. Reply as this character. Keep it engaging, short, and natural.`;

      const systemInstruction = composeSystemInstruction(template, bot, human);
      const transcript = buildTranscript([...msgRows].reverse(), bot.userid, bot.username ?? 'Bot');
      const replyPrompt = `${systemInstruction}\n\nConversation so far:\n${transcript}\n\nWrite the next message as ${bot.username ?? 'the bot'}. Reply with only the message text.`;

      // 11. Score intimacy FIRST (cheap flash-lite call), so the human-like
      //     silence gate can decide whether to stay quiet before we spend an
      //     expensive Pro generation on a reply we might throw away.
      console.log('[dh-auto-reply] systemInstruction', systemInstruction);
      console.log('[dh-auto-reply] transcript', transcript);
      const selfieCfg = await getSelfieConfig(bot.personality);
      const critic = await scoreIntimacy(
        systemInstruction, transcript, stateData.intimacy_score ?? null, selfieCfg.warmupRate
      );
      const messageIntimacyScore = critic?.intimacy ?? stateData.intimacy_score ?? null;

      // 11a. Human-like silence. Real people don't answer every text — and they go
      //      quiet when you say something off-putting. So with some probability the
      //      DH stays silent instead of replying, with a higher chance when the
      //      user's message DROPPED the conversation's intimacy. Two guards keep a
      //      chat from dying: we always answer the opener (the DH hasn't spoken
      //      yet), and we always answer a user who is clearly waiting (they sent
      //      more than `maxConsecutive` messages since the DH last spoke).
      if (promptConfig?.skipReplyEnabled) {
        let trailingUserMsgs = 0; // msgRows is newest-first
        for (const m of msgRows) {
          if (m.sender_id === dhId) break;
          trailingUserMsgs += 1;
        }
        const dhHasSpoken = msgRows.some((m) => m.sender_id === dhId);
        const maxConsecutive = Math.max(0, promptConfig.skipReplyMaxConsecutive);
        const forceReply = !dhHasSpoken || trailingUserMsgs > maxConsecutive;

        const prevIntimacy = stateData.intimacy_score ?? null;
        const currIntimacy = critic?.intimacy ?? null;
        const intimacyDropped =
          prevIntimacy != null &&
          currIntimacy != null &&
          prevIntimacy - currIntimacy >= promptConfig.skipReplyIntimacyDropDelta;

        let skipChance = Math.max(0, Math.min(1, promptConfig.skipReplyBaseChance));
        if (intimacyDropped) {
          skipChance = Math.max(skipChance, Math.max(0, Math.min(1, promptConfig.skipReplyIntimacyDropChance)));
        }

        if (!forceReply && Math.random() < skipChance) {
          // Stay silent. Mark the message processed (so we don't re-evaluate it)
          // and fold in the new intimacy, but DO NOT touch ai_state — silence is
          // not a sent reply, and ai_state drives the follow-up job.
          const adamSkip = critic
            ? adamStep(stateData.intimacy_score ?? null, stateData.intimacy_m ?? 0, stateData.intimacy_v ?? 0, critic.intimacy)
            : null;
          await supabase
            .from('user_match_ai_state')
            .update({
              ai_last_processed_message_id: checkpointId,
              ai_locked_until: null,
              ...(critic
                ? {
                    intimacy_score: critic.intimacy,
                    intimacy_m: adamSkip!.m,
                    intimacy_v: adamSkip!.v,
                    intimacy_updated_at: new Date().toISOString(),
                  }
                : {}),
            })
            .eq('match_id', matchId);
          console.log(
            '[dh-auto-reply] Silent (no reply) for match', matchId,
            '(chance', skipChance.toFixed(2), ', intimacyDropped', intimacyDropped,
            ', prev', prevIntimacy ?? 'n/a', '-> curr', currIntimacy ?? 'n/a', ')'
          );
          return new Response(JSON.stringify({ ok: true, skipped: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // 11b. Generate the reply.
      const result = await generateReply(replyPrompt);
      const respData = await result.response;
      const responseText = respData?.candidates?.[0]?.content?.parts?.[0]?.text || respData?.text?.() || "";

      // 11c. Human-like send delay — the ONLY thing that paces auto-replies.
      //      (follow_up_delay in SystemPrompts is unrelated: it paces the separate
      //      dh-followup re-engagement job, not reply speed.)
      //
      //      A longer reply lands slower, and nothing ever sends instantly. We derive
      //      a target reply time from the reply length (read lead + "typing" time at
      //      the personality's configured chars/sec), count time already spent
      //      generating toward it, then bound the wait by the personality's min
      //      (never instant) and max (kept under the lock window) delays.
      const charsPerSec = Math.max(1, promptConfig?.replyCharsPerSecond ?? 15);
      const READ_LEAD_MS = 800;
      const minSendDelayMs = Math.max(0, (promptConfig?.replyMinDelaySeconds ?? 2)) * 1000;
      const maxSendDelayMs = Math.min(60, Math.max(0, (promptConfig?.replyMaxDelaySeconds ?? 18))) * 1000;
      const jitter = 0.85 + Math.random() * 0.3;  // ±15% so the cadence isn't metronomic
      const typingTargetMs = (READ_LEAD_MS + (responseText.length / charsPerSec) * 1000) * jitter;
      const elapsedMs = Date.now() - startTime;
      const sendDelayMs = Math.min(
        maxSendDelayMs,
        Math.max(minSendDelayMs, Math.round(typingTargetMs) - elapsedMs)
      );
      console.log(
        '[dh-auto-reply] send delay', sendDelayMs, 'ms for', matchId,
        '(', responseText.length, 'chars, gen', elapsedMs, 'ms, cps', charsPerSec, ')'
      );
      if (sendDelayMs > 0) await new Promise((r) => setTimeout(r, sendDelayMs));

      // 12. Insert reply
      const { error: sendError } = await sendMessageWithOptionalIntimacy({
        matchId,
        content: responseText,
        senderId: bot.userid,
        intimacyScore: messageIntimacyScore,
      });
      if (sendError) throw sendError;

      // 12b. Maybe send a preserved selfie. Three paths feed the gate:
      //   • Early casual — if the chat has not warmed up after a couple of user
      //     messages, proactively send a low-intent casual image to add texture.
      //   • Strong cue — the user just sent a pic of their own (reciprocate in
      //     kind) or explicitly asked to see them. Bypasses the intimacy
      //     threshold and only needs a short anti-spam gap, so a photo gets
      //     answered with a photo within the same conversation. Reciprocation
      //     works even if the intimacy critic call failed (it's our own signal).
      //   • Passive — intimacy clears the threshold and the referee says a selfie
      //     would land well. Paced by the longer `cooldownMinutes` so spontaneous
      //     selfies trickle out as the chat continues instead of all at once.
      // Image tiers move upward with intimacy (casual -> tease -> reward). Once a
      // match has received a higher tier, lower tiers are not sent later.
      let selfieSentAt: string | null = null;
      try {
        const highestSentTier = await getHighestSentSelfieTier(matchId);

        const userSentImage = !!latestUserMsg?.media_url;
        const reciprocate = userSentImage && selfieCfg.reciprocateOnUserImage;
        const userAskedToSee = !!critic && critic.userRequestedPhoto;
        const strongCue = reciprocate || userAskedToSee;
        const observedIntimacy = messageIntimacyScore;
        const realUserMessageCount = msgRows.filter((m) => m.sender_id !== dhId).length;
        const earlyCasual =
          !highestSentTier &&
          observedIntimacy != null &&
          realUserMessageCount >= selfieCfg.earlyCasualAfterMessages &&
          observedIntimacy < selfieCfg.earlyCasualMaxIntimacy;
        const passiveOk = !!critic && critic.selfieAppropriate && critic.intimacy >= selfieCfg.threshold;

        const wantsSelfie = selfieCfg.enabled && (earlyCasual || strongCue || passiveOk);

        const lastSelfieMs = stateData.last_selfie_sent_at
          ? new Date(stateData.last_selfie_sent_at).getTime()
          : 0;
        const requiredGapMs =
          (strongCue ? selfieCfg.reciprocateGapMinutes : selfieCfg.cooldownMinutes) * 60_000;
        const cooledDown = !lastSelfieMs || Date.now() - lastSelfieMs >= requiredGapMs;

        if (wantsSelfie && cooledDown) {
          const targetTier: ImageTier = earlyCasual || observedIntimacy == null
            ? 'casual'
            : tierForIntimacy(observedIntimacy, selfieCfg);
          const tierProgresses =
            !highestSentTier || IMAGE_TIER_RANK[targetTier] >= IMAGE_TIER_RANK[highestSentTier];

          if (!tierProgresses) {
            console.log(
              '[dh-auto-reply] Skipping selfie tier downgrade',
              targetTier, 'after', highestSentTier, 'for match', matchId
            );
          } else {
            const selfie = await pickUnsentSelfie(dhId, matchId, targetTier);
            if (selfie) {
              const { data: imgMsg, error: imgErr } = await sendMessageWithOptionalIntimacy({
                matchId,
                mediaUrl: selfie.public_url,
                senderId: bot.userid,
                intimacyScore: messageIntimacyScore,
              });
              if (!imgErr) {
                // The image genuinely went out, so arm the cooldown regardless of
                // what happens next.
                selfieSentAt = new Date().toISOString();
                // Record it in the per-match ledger so it's never resent. A silent
                // failure here is the one thing that breaks the no-repeat guarantee
                // (pickUnsentSelfie would pick it again), so log it loudly.
                const { error: ledgerErr } = await supabase.from('dh_sent_images').insert({
                  match_id: matchId,
                  image_id: selfie.id,
                  message_id: (imgMsg as { id?: string } | null)?.id ?? null,
                });
                if (ledgerErr) {
                  console.error(
                    '[dh-auto-reply] Failed to record selfie in dh_sent_images (may resend)',
                    selfie.id, 'match', matchId, ledgerErr
                  );
                }
                const cue = earlyCasual ? 'early-casual' : reciprocate ? 'reciprocate' : userAskedToSee ? 'requested' : 'passive';
                console.log(
                  '[dh-auto-reply] Sent selfie', selfie.id, 'ordinal', selfie.ordinal,
                  'tier', selfie.image_tier, 'to match', matchId,
                  '(cue', cue, ', intimacy', observedIntimacy ?? 'n/a', ')'
                );
              }
            } else {
              console.log(
                '[dh-auto-reply] No unsent selfie for tier',
                targetTier, 'match', matchId, '(intimacy', observedIntimacy ?? 'n/a', ')'
              );
            }
          }
        }
      } catch (selfieErr) {
        console.error('[dh-auto-reply] selfie send failed', selfieErr);
      }

      // 13. Update state (+ intimacy momentum)
      const adam = critic
        ? adamStep(stateData.intimacy_score ?? null, stateData.intimacy_m ?? 0, stateData.intimacy_v ?? 0, critic.intimacy)
        : null;
      await supabase
        .from('user_match_ai_state')
        .update({
          ai_last_processed_message_id: checkpointId,
          ai_locked_until: null,
          ai_follow_up_count: 0,
          ai_state: 2, // DH Sent
          ...(critic
            ? {
                intimacy_score: critic.intimacy,
                intimacy_m: adam!.m,
                intimacy_v: adam!.v,
                intimacy_updated_at: new Date().toISOString(),
              }
            : {}),
          ...(selfieSentAt ? { last_selfie_sent_at: selfieSentAt } : {}),
        })
        .eq('match_id', matchId);

      console.log('[dh-auto-reply] Replied to match', matchId, '(intimacy', critic?.intimacy ?? 'n/a', ')');
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('[dh-auto-reply] Error processing match', matchId, err);
      // Release lock on error
      await supabase.from('user_match_ai_state').update({ ai_locked_until: null }).eq('match_id', matchId);
      return new Response(String(err), { status: 500 });
    }
  } catch (err) {
    console.error('[dh-auto-reply] Fatal error', err);
    return new Response(String(err), { status: 500 });
  }
});
