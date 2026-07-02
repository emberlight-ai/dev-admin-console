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
async function generateReply(request: string | Record<string, unknown>) {
  try {
    return await replyModel.generateContent(request as any);
  } catch (err) {
    console.error('[dh-auto-reply] reply model failed; falling back to utility model', err);
    return await model.generateContent(request as any);
  }
}

// ── Typing indicator (server → client Realtime broadcast) ─────────────────────
// The iOS client subscribes to the per-conversation channel `chat:<match_id>` and
// renders "Typing…" from broadcasts on the `typing` event. The DH is server-side
// and never holds a websocket, so we push typing via the Realtime HTTP Broadcast
// API while generating + pacing the reply, then clear it right before the message
// lands. Payload shape mirrors the client's TypingPayload ({ user_id, typing }).
const REALTIME_BROADCAST_URL = `${Deno.env.get('SUPABASE_URL')}/realtime/v1/api/broadcast`;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

async function broadcastTyping(matchId: string, dhId: string, isTyping: boolean): Promise<void> {
  try {
    await fetch(REALTIME_BROADCAST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: `chat:${matchId.toLowerCase()}`,
            event: 'typing',
            payload: { user_id: dhId, typing: isTyping },
            private: false,
          },
        ],
      }),
    });
  } catch (err) {
    // Typing is best-effort cosmetic — never let it break a reply.
    console.error('[dh-auto-reply] broadcastTyping failed', err);
  }
}

// Start broadcasting "typing" and keep it alive with a heartbeat (the client
// auto-clears the indicator a few seconds after the last event). Returns a stop
// function that cancels the heartbeat and broadcasts "stopped" exactly once.
function startTypingHeartbeat(matchId: string, dhId: string): () => Promise<void> {
  void broadcastTyping(matchId, dhId, true);
  const interval = setInterval(() => {
    void broadcastTyping(matchId, dhId, true);
  }, 3000);
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    await broadcastTyping(matchId, dhId, false);
  };
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
  dh_engine: string | null; // 'v1' (legacy) | 'l5' (persona kernel + memory + director)
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
    .select('userid, is_digital_human, username, gender, personality, age, bio, profession, zipcode, location_name, timezone, storyline, dh_engine')
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

// Inline transcript builder (cannot import from src/ in Deno runtime).
// `dhPhotoCaptions` maps message_id -> caption for photos the DH herself sent, so
// she remembers sharing them (before this, her own photos rendered as "[User sent
// an image]" — she'd deny having sent pics she just sent).
function buildTranscript(
  messages: Array<{ id?: string; sender_id: string; content: string | null; media_url?: string | null; image_desc?: string | null }>,
  botUserId: string,
  botName: string,
  dhPhotoCaptions: Map<string, string | null> = new Map()
): string {
  return messages
    .map((m) => {
      const isBot = m.sender_id === botUserId;
      const speaker = isBot ? botName : 'User';
      let text = m.content || '';
      if (m.media_url) {
        if (isBot) {
          const cap = m.id ? dhPhotoCaptions.get(m.id) : null;
          text += cap
            ? `\n[You sent a photo of yourself: ${cap}]`
            : `\n[You sent a photo of yourself]`;
        } else if (m.image_desc) {
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

// ── Conversation craft (applies to ALL engines) ────────────────────────────────
// Fixes the interrogation death-spiral: the legacy prompts say "match his length /
// mirror low effort", which turns a low-effort user into a low-effort DH. These
// rules are appended AFTER the persona template and take precedence on conflict.
const CRAFT_RULES = `
### CONVERSATION CRAFT — these rules OVERRIDE any earlier style rules they conflict with
- TEXT LIKE A PERSON TYPES ON A PHONE, not like prose. Fragments are fine. Starting a message lowercase is fine (follow your texting fingerprint). Never write like a letter or a novel — no "Flowers are a lovely gesture, but I..." energy. "flowers huh" beats a paragraph.
- MATCH HIS LENGTH — hard rule: if his last message is short (a few words), reply with ONE bubble, roughly as short as his. You earn more bubbles only when HE writes more. Short is not boring — a 4-word tease wins.
- At most ONE question mark across ALL bubbles this turn. If your previous turn ended with a question, end this one with a statement.
- If his messages are low-effort ("yeah", "ok", "lol"), do NOT fire another question. Toss out something SMALL to react to — a quick opinion, a tease — and leave room.
- React to what he actually said before steering anywhere new. Callbacks to earlier details beat new topics.
- Never restart with a greeting mid-conversation, never repeat a sentence shape you used recently, and never restate his words back at him formally.`;

// Stage-aware guidance appended per turn. Early conversation is a DIFFERENT
// game than an established one: curious questions are exactly right while you
// are strangers (job, what he is looking for, his week — one per turn), and
// monologuing at a stranger is deadly. Once established, shares and callbacks
// beat questions.
function stageGuidance(stage: 'first-chat' | 'established'): string {
  if (stage === 'first-chat') {
    return `
### STAGE: FIRST CHAT — you two are still strangers
- Be a curious, flirty stranger: react briefly to what he said, then ONE light getting-to-know-him question is the RIGHT move. Natural territory: what he does for work, what he is actually looking for on here, how his week is going, where he is from; once it is warm, past relationships (lightly).
- Introduce yourself in DROPS, not speeches: one small true detail from your storyline/life at a time, usually attached to your question ("just got off shift lol. what do you do").
- Keep every message short. You are feeling him out, not performing.`;
  }
  return `
### STAGE: ESTABLISHED — you know each other now
- Shares and callbacks beat questions. Reveal something small and real from your day/story and let him reciprocate.
- Use what you remember about him — a callback to an earlier detail lands better than any new topic.`;
}

// ── L5 engine: persona kernel + match memory + diary + coach notes ─────────────
type L5Memory = { facts: unknown[]; open_loops: unknown[]; inside_jokes: unknown[] };
type L5Context = { blocks: string; memory: L5Memory | null };

function jsonList(v: unknown): string {
  if (!Array.isArray(v) || v.length === 0) return '(none yet)';
  return v.map((x) => `- ${typeof x === 'string' ? x : JSON.stringify(x)}`).join('\n');
}

async function loadL5Context(dhId: string, matchId: string): Promise<L5Context> {
  const [personaRes, memRes, diaryRes, debriefRes, imgCountRes] = await Promise.all([
    supabase.from('dh_persona').select('tastes, texting_style, schedule, okr, notes').eq('dh_user_id', dhId).maybeSingle(),
    supabase.from('dh_match_memory').select('facts, open_loops, inside_jokes').eq('match_id', matchId).maybeSingle(),
    supabase.from('dh_diary').select('day, events, mood, talking_points').eq('dh_user_id', dhId).order('day', { ascending: false }).limit(1),
    supabase.from('dh_debrief').select('prompt_addendum').eq('dh_user_id', dhId).order('day', { ascending: false }).limit(1),
    supabase.from('dh_chat_images').select('id', { count: 'exact', head: true }).eq('dh_user_id', dhId).eq('active', true),
  ]);

  const persona = personaRes.data ?? null;
  const memory = (memRes.data as L5Memory | null) ?? null;
  const diary = diaryRes.data?.[0] ?? null;
  const coach = debriefRes.data?.[0]?.prompt_addendum ?? null;
  const photoCount = imgCountRes.count ?? 0;

  const blocks: string[] = [];
  if (persona) {
    blocks.push(`<persona_kernel>
Your tastes and boundaries (these BIND — have real opinions, disagree when it fits, deflect what you dislike):
${JSON.stringify(persona.tastes ?? {}, null, 1)}
Your texting fingerprint (follow it: bubble length, emoji policy, punctuation quirks):
${JSON.stringify(persona.texting_style ?? {}, null, 1)}
${persona.notes ? `Character notes: ${persona.notes}` : ''}
</persona_kernel>`);
  }
  if (memory) {
    blocks.push(`<what_you_remember_about_him>
Facts you know:
${jsonList(memory.facts)}
Open threads to call back to (use ONE when natural — callbacks are gold):
${jsonList(memory.open_loops)}
Inside jokes:
${jsonList(memory.inside_jokes)}
</what_you_remember_about_him>`);
  }
  if (diary) {
    blocks.push(`<your_day_today>
Mood: ${diary.mood ?? 'normal'}
Things that happened to you today (share ONE when the conversation needs fuel — do not dump them):
${jsonList(diary.events)}
Fresh topics you found interesting today:
${jsonList(diary.talking_points)}
</your_day_today>`);
  }
  if (coach) {
    blocks.push(`<coach_notes>
From your own debrief of yesterday's conversations (apply quietly):
${coach}
</coach_notes>`);
  }

  // Photo awareness: she should hint at photos she genuinely has and never
  // promise ones she doesn't — the promise-then-ghost pattern is the #1 trust
  // breaker. The app decides WHEN a photo actually goes out.
  blocks.push(
    photoCount > 0
      ? `<your_photos>
You have ${photoCount} real photos of yourself. The app shares them automatically at the right moments — you may playfully hint at them, and when one goes out, own it in character (react to having just sent it).
</your_photos>`
      : `<your_photos>
You have NO photos you can send. If he asks for one, deflect playfully and in character — never promise a photo or say one is coming.
</your_photos>`
  );

  return { blocks: blocks.length ? `\n\n${blocks.join('\n\n')}` : '', memory };
}

// Async memory writer: after a reply goes out, distill durable memory for this
// match. Cheap flash-lite call; failures never affect the reply.
async function updateMatchMemory(
  matchId: string,
  dhId: string,
  transcript: string,
  existing: L5Memory | null,
  lastMessageId: string | null
): Promise<void> {
  try {
    const prompt = `You maintain the long-term memory a woman keeps about a man she is texting on a dating app.
Existing memory (merge into it, don't lose good entries):
${JSON.stringify(existing ?? { facts: [], open_loops: [], inside_jokes: [] })}

Conversation (most recent):
${transcript}

Update the memory. Rules: facts = durable, specific things about HIM (job, city, hobbies, people, preferences), max 14, drop stale/duplicate ones. open_loops = unresolved threads worth a future callback ("his tournament Saturday"), max 6, remove resolved ones. inside_jokes = shared bits/nicknames, max 5. Short strings only. Respond with JSON only.`;
    const res = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            facts: { type: 'ARRAY', items: { type: 'STRING' } },
            open_loops: { type: 'ARRAY', items: { type: 'STRING' } },
            inside_jokes: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['facts', 'open_loops', 'inside_jokes'],
        },
      },
    });
    const txt = res.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? res.response?.text?.() ?? '';
    const parsed = JSON.parse(txt);
    await supabase.from('dh_match_memory').upsert({
      match_id: matchId,
      dh_user_id: dhId,
      facts: (parsed.facts ?? []).slice(0, 14),
      open_loops: (parsed.open_loops ?? []).slice(0, 6),
      inside_jokes: (parsed.inside_jokes ?? []).slice(0, 5),
      last_extracted_message_id: lastMessageId,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[dh-auto-reply] memory writer failed (non-fatal)', matchId, err);
  }
}

// Post-send safety net: if a user message landed while we were generating (its
// webhook hit our lock and exited), re-invoke ourselves for the newest message so
// it is never silently dropped.
async function reprocessNewestIfMissed(matchId: string, dhId: string, processedCheckpointId: string | null) {
  try {
    // Compare against the newest USER message in the table (not ai_state's
    // last_message_id, which our own just-sent bubbles overwrite) so a user
    // message that landed mid-generation or between bubbles is never masked.
    const { data: newestRows } = await supabase
      .from('messages')
      .select('id, sender_id')
      .eq('match_id', matchId)
      .neq('sender_id', dhId)
      .order('created_at', { ascending: false })
      .limit(1);
    const st = newestRows?.[0]
      ? { last_message_id: newestRows[0].id, last_message_sender_id: newestRows[0].sender_id }
      : null;
    if (!st?.last_message_id) return;
    if (st.last_message_id === processedCheckpointId) return;

    console.log('[dh-auto-reply] Missed message detected, re-invoking for', matchId, st.last_message_id);
    const p = fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/dh-auto-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({
        type: 'INSERT',
        table: 'messages',
        schema: 'public',
        record: {
          id: st.last_message_id,
          match_id: matchId,
          sender_id: st.last_message_sender_id,
          content: null,
          created_at: new Date().toISOString(),
        },
      }),
    }).then(() => {}).catch((e) => console.error('[dh-auto-reply] re-invoke failed', e));
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(p);
    // No await on purpose when waitUntil is unavailable: the re-invocation runs
    // its own debounce; blocking this response on a full downstream reply would
    // hold the lock window open for nothing.
  } catch (err) {
    console.error('[dh-auto-reply] reprocess check failed', matchId, err);
  }
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
  // Director fields (L5 engine only; undefined on v1)
  engagement?: number;         // 0-100: how engaged/entertained is HE right now
  beat?: string;               // share | ask | tease | deepen | repair
  callback?: string;           // a memory/open-loop worth referencing, or ''
  bubbleCount?: number;        // suggested bubbles this turn (1-3)
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
  warmupRate: IntimacyWarmupRate,
  directorMode = false
): Promise<IntimacyResult | null> {
  try {
    const previous = previousScore == null ? 'unknown' : String(normalizeIntimacyScore(previousScore));
    const directorInstructions = directorMode
      ? `

You are ALSO the conversation director. Judge how engaged/entertained HE is right now (0-100; one-word answers and slowing pace = low). Then plan the next beat:
- "share": conversation needs fuel — she should volunteer something from her day/memory, not ask.
- "ask": he's giving energy and it's natural to be curious back (use sparingly).
- "tease": playful push-pull fits the vibe.
- "deepen": the moment is right for a slightly personal disclosure that invites reciprocity.
- "repair": he's cooling off or annoyed — acknowledge, lighten, re-engage gently.
Pick a callback: ONE remembered fact/open thread from the context that would land well right now, or empty string. Suggest bubble_count 1-3 (2 is a good default; 1 for terse moods, 3 for storytelling).`
      : '';
    const judgePrompt = `${systemText}

You are an objective relationship analyst observing the conversation below. Do NOT role-play or reply. Judge the CURRENT emotional/romantic closeness from the user's side, and whether the digital human sharing a personal selfie would feel natural and welcome right at this moment.

Previous intimacy score: ${previous} on a 0-100 scale.
Relationship warm-up rate: ${warmupRate}.
Warm-up guidance: ${warmupGuidance(warmupRate)}

Return the new CURRENT intimacy score on a 0-100 scale. Do not return a 0-1 fraction. Avoid both extremes: do not freeze the score when the user clearly warms up, and do not jump to a near-maximum score from one mildly positive message.${directorInstructions}

Conversation:
${transcript}

Respond with JSON only.`;
    const baseProps: Record<string, unknown> = {
      intimacy: { type: 'NUMBER' },
      selfie_appropriate: { type: 'BOOLEAN' },
      user_requested_photo: { type: 'BOOLEAN' },
    };
    const directorProps: Record<string, unknown> = directorMode
      ? {
          engagement: { type: 'NUMBER' },
          beat: { type: 'STRING' },
          callback: { type: 'STRING' },
          bubble_count: { type: 'NUMBER' },
        }
      : {};
    const res = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: judgePrompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { ...baseProps, ...directorProps },
          required: [
            'intimacy',
            'selfie_appropriate',
            'user_requested_photo',
            ...(directorMode ? ['engagement', 'beat', 'callback', 'bubble_count'] : []),
          ],
        },
      },
    });
    const txt =
      res.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? res.response?.text?.() ?? '';
    const parsed = JSON.parse(txt);
    const intimacy = normalizeIntimacyScore(parsed.intimacy);
    const VALID_BEATS = new Set(['share', 'ask', 'tease', 'deepen', 'repair']);
    return {
      intimacy,
      selfieAppropriate: !!parsed.selfie_appropriate,
      userRequestedPhoto: !!parsed.user_requested_photo,
      ...(directorMode
        ? {
            engagement: Number.isFinite(Number(parsed.engagement))
              ? Math.max(0, Math.min(100, Number(parsed.engagement)))
              : undefined,
            beat: VALID_BEATS.has(String(parsed.beat)) ? String(parsed.beat) : 'share',
            callback: typeof parsed.callback === 'string' ? parsed.callback : '',
            bubbleCount: Math.max(1, Math.min(3, Math.round(Number(parsed.bubble_count) || 2))),
          }
        : {}),
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

type DhSelfie = {
  id: string;
  public_url: string;
  ordinal: number;
  image_tier: ImageTier | 'unspecified';
  caption: string | null;
};

// Lowest-ordinal unsent selfie for the target tier, FALLING BACK down the ladder
// (and finally to 'unspecified') when the target tier is exhausted. Exact-tier
// matching used to silently send nothing — after the user explicitly asked — and
// left 'unspecified' photos (a quarter of all inventory) permanently unsendable.
// We never fall UP the ladder: a casual moment doesn't get a reward-tier photo.
async function pickUnsentSelfie(
  dhId: string,
  matchId: string,
  tier: ImageTier
): Promise<DhSelfie | null> {
  const { data: imgs } = await supabase
    .from('dh_chat_images')
    .select('id, public_url, ordinal, image_tier, caption')
    .eq('dh_user_id', dhId)
    .eq('active', true)
    .order('ordinal', { ascending: true });
  if (!imgs || imgs.length === 0) return null;
  const { data: sent } = await supabase
    .from('dh_sent_images')
    .select('image_id')
    .eq('match_id', matchId);
  const sentIds = new Set((sent ?? []).map((s: { image_id: string }) => s.image_id));

  const fallbackChain: Array<ImageTier | 'unspecified'> =
    tier === 'reward'
      ? ['reward', 'tease', 'casual', 'unspecified']
      : tier === 'tease'
        ? ['tease', 'casual', 'unspecified']
        : ['casual', 'unspecified'];

  const pool = imgs as DhSelfie[];
  for (const t of fallbackChain) {
    const hit = pool.find((img) => img.image_tier === t && !sentIds.has(img.id));
    if (hit) return hit;
  }
  return null;
}

// One-time caption backfill: the first time a photo goes out, describe it with
// the vision model and store the caption on dh_chat_images, so from then on the
// DH "remembers" what she shared (the transcript renders it). Best-effort.
async function captionDhImageIfNeeded(imageId: string, publicUrl: string, existing: string | null) {
  if (existing && existing.trim().length > 0) return;
  try {
    const res = await fetch(publicUrl);
    if (!res.ok) return;
    const base64Data = encodeBase64(new Uint8Array(await res.arrayBuffer()));
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    const out = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          { text: 'This is a photo a woman shares in a dating-app chat. Describe it in ONE short sentence from her perspective (what she is wearing/doing/where), so she can refer to it later. No preamble.' },
        ],
      }],
    });
    const caption =
      out.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ??
      out.response?.text?.()?.trim() ?? '';
    if (caption) {
      await supabase.from('dh_chat_images').update({ caption }).eq('id', imageId);
    }
  } catch (err) {
    console.error('[dh-auto-reply] caption backfill failed (non-fatal)', imageId, err);
  }
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

    // 2. Fetch ai state for this match (mutable: re-read after the burst debounce)
    const AI_STATE_COLS =
      'match_id, last_message_id, last_message_at, last_message_sender_id, ai_last_processed_message_id, ai_locked_until, dh_user_id, real_user_id, ai_state, intimacy_score, intimacy_m, intimacy_v, last_selfie_sent_at, human_takeover';
    let { data: stateData, error: stateErr } = await supabase
      .from('user_match_ai_state')
      .select(AI_STATE_COLS)
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

    // 3b. Skip if a human admin has taken over this conversation. The flag is set
    // from the admin console (POST /api/admin/chat/takeover) and stays on until the
    // operator hands control back, so the bot never talks over the human.
    if (stateData.human_takeover) {
      console.log('[dh-auto-reply] Human takeover active, skip', matchId);
      return new Response('Human takeover', { status: 200 });
    }

    // 3c. Burst debounce. Real users send thoughts as several quick messages; the
    // webhook fires on the FIRST one. Wait a beat, then re-read state: if a newer
    // USER message arrived, ITS invocation (also debouncing, started later) owns
    // the burst — exit and let it answer everything as one thought.
    const DEBOUNCE_MS = 7000 + Math.floor(Math.random() * 4000);
    await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
    {
      const { data: freshState } = await supabase
        .from('user_match_ai_state')
        .select(AI_STATE_COLS)
        .eq('match_id', matchId)
        .single();
      if (freshState) {
        if (
          freshState.last_message_id &&
          freshState.last_message_id !== record.id &&
          freshState.last_message_sender_id !== dhId
        ) {
          console.log('[dh-auto-reply] Superseded by newer burst message, skip', matchId);
          return new Response('Superseded', { status: 200 });
        }
        stateData = freshState; // include anything that landed during the debounce
      }
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
    //    concurrent webhook double-reply. Size it to the personality's max delay
    //    plus headroom for up to two inter-bubble gaps (≤6s each).
    const configuredMaxDelaySec = Math.min(60, Math.max(0, promptConfig?.replyMaxDelaySeconds ?? 18));
    const lockSeconds = Math.min(120, Math.max(LOCK_DURATION_SECONDS, configuredMaxDelaySec + 37));
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

      // 10. Build prompt. L5 DHs get their persona kernel, per-match memory,
      //     today's diary, and last night's coach notes appended; every engine
      //     gets the conversation-craft rules (anti-interrogation, multi-bubble).
      const template =
        promptConfig?.template ??
        `You are ${bot.username ?? 'a digital human'}. Personality: ${bot.personality ?? 'Friendly'}. Bio: ${bot.bio ?? 'N/A'}. Reply as this character. Keep it engaging, short, and natural.`;

      const isL5 = bot.dh_engine === 'l5';
      const l5 = isL5 ? await loadL5Context(dhId, matchId) : { blocks: '', memory: null };

      // Conversation stage + his-energy signals drive both the prompt and the
      // HARD enforcement below (prompts alone don't hold under long personas).
      const realUserMessageCount = msgRows.filter((m) => m.sender_id !== dhId).length;
      const stage: 'first-chat' | 'established' = realUserMessageCount < 12 ? 'first-chat' : 'established';
      const lastUserWords = (latestUserMsg?.content ?? '').trim().split(/\s+/).filter(Boolean).length;
      const shortUser = !latestUserMsg?.media_url && lastUserWords > 0 && lastUserWords <= 7;

      const systemInstruction =
        composeSystemInstruction(template, bot, human) + '\n' + CRAFT_RULES + stageGuidance(stage) + l5.blocks;

      // Captions for photos SHE sent in this match, so the transcript reminds her
      // of them (nested select rides the dh_sent_images -> dh_chat_images FK).
      const dhPhotoCaptions = new Map<string, string | null>();
      try {
        const { data: sentImgRows } = await supabase
          .from('dh_sent_images')
          .select('message_id, dh_chat_images(caption)')
          .eq('match_id', matchId);
        for (const row of (sentImgRows ?? []) as Array<{ message_id: string | null; dh_chat_images: { caption: string | null } | null }>) {
          if (row.message_id) dhPhotoCaptions.set(row.message_id, row.dh_chat_images?.caption ?? null);
        }
      } catch (err) {
        console.error('[dh-auto-reply] sent-photo caption lookup failed (non-fatal)', err);
      }

      const transcript = buildTranscript([...msgRows].reverse(), bot.userid, bot.username ?? 'Bot', dhPhotoCaptions);

      // 11. Score intimacy FIRST (cheap flash-lite call), so the human-like
      //     silence gate can decide whether to stay quiet before we spend an
      //     expensive Pro generation on a reply we might throw away. For L5 the
      //     same call doubles as the conversation DIRECTOR (beat plan).
      console.log('[dh-auto-reply] systemInstruction', systemInstruction);
      console.log('[dh-auto-reply] transcript', transcript);
      const selfieCfg = await getSelfieConfig(bot.personality);
      const critic = await scoreIntimacy(
        systemInstruction, transcript, stateData.intimacy_score ?? null, selfieCfg.warmupRate, isL5
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
          await reprocessNewestIfMissed(matchId, dhId, checkpointId);
          return new Response(JSON.stringify({ ok: true, skipped: true }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      // 11a2. Build the actor prompt. For L5, the director's beat plan steers the
      //        turn; for v1, the craft rules alone govern shape.
      const beatPlan = isL5 && critic?.beat
        ? `

Beat plan for THIS turn (follow it loosely, stay fully in character):
- move: ${critic.beat} (share = volunteer something from your day/memory, don't ask; ask = one light question is fine; tease = playful push-pull; deepen = a slightly personal disclosure that invites his; repair = he's cooling off, acknowledge and re-engage gently)
- callback worth using: ${critic.callback || 'none'}
- his engagement right now: ${critic.engagement ?? 'unknown'}/100
- send ${critic.bubbleCount ?? 2} bubble(s)`
        : '';
      const lengthDirective = shortUser
        ? `\n\nHis last message was only ${lastUserWords} word(s). Reply with EXACTLY ONE bubble, roughly matching his length — a short reaction, tease, or (in first chat) one light question.`
        : '';
      const replyPrompt = `${systemInstruction}\n\nConversation so far:\n${transcript}${beatPlan}${lengthDirective}\n\nWrite the next message(s) as ${bot.username ?? 'the bot'}. Respond with a JSON array of 1-3 strings — each string is one chat bubble, sent in order. No names, no quotes around the array, JSON only.`;

      // 11b–12. Now that we've committed to replying, show a live "Typing…"
      //          indicator for the whole generation + send window, and clear it
      //          after the last bubble lands (in `finally`, so a failure can't
      //          leave the user staring at a stuck indicator).
      const stopTyping = startTypingHeartbeat(matchId, bot.userid);
      try {
        // 11b. Generate 1-3 bubbles as structured JSON; fall back to treating the
        //      raw text as a single bubble if parsing fails.
        const result = await generateReply({
          contents: [{ role: 'user', parts: [{ text: replyPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: { type: 'ARRAY', items: { type: 'STRING' } },
          },
        });
        const respData = await result.response;
        const rawText = respData?.candidates?.[0]?.content?.parts?.[0]?.text || respData?.text?.() || "";
        let bubbles: string[];
        try {
          const parsed = JSON.parse(rawText);
          bubbles = (Array.isArray(parsed) ? parsed : [String(parsed)])
            .map((b) => String(b).trim())
            .filter((b) => b.length > 0)
            .slice(0, 3);
        } catch {
          bubbles = rawText.trim() ? [rawText.trim()] : [];
        }
        if (bubbles.length === 0) throw new Error('Empty reply from model');
        // HARD length discipline: a few words from him never earns a multi-bubble
        // essay back, no matter what the model produced.
        if (shortUser && bubbles.length > 1) {
          bubbles = bubbles.slice(0, 1);
        }

        // 11c. Human-like pacing. First bubble: derive a target from its length
        //      (read lead + "typing" time at the personality's chars/sec), count
        //      generation time toward it, bound by the personality's min/max.
        //      Subsequent bubbles: short typing gaps scaled by their own length.
        const charsPerSec = Math.max(1, promptConfig?.replyCharsPerSecond ?? 15);
        const READ_LEAD_MS = 800;
        const minSendDelayMs = Math.max(0, (promptConfig?.replyMinDelaySeconds ?? 2)) * 1000;
        const maxSendDelayMs = Math.min(60, Math.max(0, (promptConfig?.replyMaxDelaySeconds ?? 18))) * 1000;
        const jitter = 0.85 + Math.random() * 0.3;  // ±15% so the cadence isn't metronomic
        const typingTargetMs = (READ_LEAD_MS + (bubbles[0].length / charsPerSec) * 1000) * jitter;
        const elapsedMs = Date.now() - startTime;
        const firstDelayMs = Math.min(
          maxSendDelayMs,
          Math.max(minSendDelayMs, Math.round(typingTargetMs) - elapsedMs)
        );
        console.log(
          '[dh-auto-reply] sending', bubbles.length, 'bubble(s), first delay', firstDelayMs,
          'ms for', matchId, '(gen', elapsedMs, 'ms, cps', charsPerSec, ')'
        );

        // 12. Send each bubble in order with its own pacing.
        for (let i = 0; i < bubbles.length; i++) {
          const delayMs = i === 0
            ? firstDelayMs
            : Math.min(6000, Math.max(1200, Math.round((bubbles[i].length / charsPerSec) * 1000 * jitter)));
          if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
          const { error: sendError } = await sendMessageWithOptionalIntimacy({
            matchId,
            content: bubbles[i],
            senderId: bot.userid,
            intimacyScore: messageIntimacyScore,
          });
          if (sendError) throw sendError;
        }
      } finally {
        // Clear the typing indicator whether the send succeeded or threw.
        await stopTyping();
      }

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
        // realUserMessageCount computed at step 10 (stage detection) — reused here.
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
                // First send of this photo: generate its caption off the hot path
                // so future turns can reference what she shared.
                {
                  const capP = captionDhImageIfNeeded(selfie.id, selfie.public_url, selfie.caption);
                  const rt = (globalThis as any).EdgeRuntime;
                  if (rt?.waitUntil) rt.waitUntil(capP); else await capP;
                }
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

      // 14. L5 memory writer — distill durable facts/open-loops for this match.
      //     Runs after the reply is out; prefers waitUntil so it never delays the
      //     response, but degrades to a short await on runtimes without it.
      if (isL5) {
        const memP = updateMatchMemory(matchId, dhId, transcript, l5.memory, checkpointId);
        const rt = (globalThis as any).EdgeRuntime;
        if (rt?.waitUntil) rt.waitUntil(memP); else await memP;
      }

      // 15. Never drop a message that arrived while we were generating (its own
      //     webhook bounced off our lock): re-invoke for the newest if needed.
      await reprocessNewestIfMissed(matchId, dhId, checkpointId);

      console.log('[dh-auto-reply] Replied to match', matchId, '(intimacy', critic?.intimacy ?? 'n/a', ', engine', bot.dh_engine ?? 'v1', ')');
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
