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

const LOCK_DURATION_SECONDS = 30;

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

async function refreshPrompts() {
  const { data } = await supabase
    .from('SystemPrompts')
    .select(
      'gender, personality, system_prompt, immediate_match_enabled, follow_up_message_enabled, follow_up_message_prompt, follow_up_delay, max_follow_ups, active_greeting_enabled, active_greeting_prompt, created_at'
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
    .select('userid, is_digital_human, username, gender, personality, age, bio, profession, zipcode, location_name, timezone')
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
  return prompt;
}

// ── Intimacy critic + Adam-style momentum + selfie picker ─────────────────────
const globalSelfieCfg = (globalThis as any).__dhSelfieCfg as
  | { value: { enabled: boolean; threshold: number; cooldownHours: number }; exp: number }
  | undefined;
let selfieCfgCache = globalSelfieCfg ?? {
  value: { enabled: true, threshold: 55, cooldownHours: 3 },
  exp: 0,
};
async function getSelfieConfig() {
  if (Date.now() < selfieCfgCache.exp) return selfieCfgCache.value;
  const { data } = await supabase.from('digital_human_config').select('key, value');
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.key] = r.value;
  const value = {
    enabled: map['enable_digital_human_selfies'] !== 'false',
    threshold: Number(map['selfie_intimacy_threshold'] ?? '55') || 55,
    cooldownHours: Number(map['selfie_cooldown_hours'] ?? '3') || 3,
  };
  selfieCfgCache = { value, exp: Date.now() + CONFIG_TTL_MS };
  (globalThis as any).__dhSelfieCfg = selfieCfgCache;
  return value;
}

interface IntimacyResult {
  intimacy: number;            // 0-100 current closeness from the user's side
  selfieAppropriate: boolean;  // would sharing a personal selfie feel natural/welcome now?
  userRequestedPhoto: boolean; // did the user explicitly ask to see them / a pic?
}

// A separate "referee" call, kept apart from reply generation so it can't game
// its own score. Uses structured JSON output for a reliable parse.
async function scoreIntimacy(systemText: string, transcript: string): Promise<IntimacyResult | null> {
  try {
    const judgePrompt = `${systemText}

You are an objective relationship analyst observing the conversation below. Do NOT role-play or reply. Judge the CURRENT emotional/romantic closeness from the user's side, and whether the digital human sharing a personal selfie would feel natural and welcome right at this moment.

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
    const intimacy = Math.max(0, Math.min(100, Number(parsed.intimacy) || 0));
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
  matchId: string
): Promise<{ id: string; public_url: string; ordinal: number } | null> {
  const { data: imgs } = await supabase
    .from('dh_chat_images')
    .select('id, public_url, ordinal')
    .eq('dh_user_id', dhId)
    .eq('active', true)
    .order('ordinal', { ascending: true });
  if (!imgs || imgs.length === 0) return null;
  const { data: sent } = await supabase
    .from('dh_sent_images')
    .select('image_id')
    .eq('match_id', matchId);
  const sentIds = new Set((sent ?? []).map((s: { image_id: string }) => s.image_id));
  return (
    (imgs as Array<{ id: string; public_url: string; ordinal: number }>).find(
      (img) => !sentIds.has(img.id)
    ) ?? null
  );
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

    // (Fixed response-delay removed — replies now use a natural typing delay
    //  applied AFTER generation; see step 11b.)

    // 8. Acquire lock
    const lockTime = new Date(Date.now() + LOCK_DURATION_SECONDS * 1000).toISOString();
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

      // 11. Generate the reply and score intimacy in parallel (independent calls).
      console.log('[dh-auto-reply] systemInstruction', systemInstruction);
      console.log('[dh-auto-reply] transcript', transcript);
      const [result, critic] = await Promise.all([
        generateReply(replyPrompt),
        scoreIntimacy(systemInstruction, transcript),
      ]);
      const respData = await result.response;
      const responseText = respData?.candidates?.[0]?.content?.parts?.[0]?.text || respData?.text?.() || "";

      // 11b. Natural typing delay. The total time from receiving the user's message
      //      to replying should feel like a human read it and typed the answer
      //      (~40 WPM). Time already spent generating counts toward that — so a short
      //      reply the model lingered on goes out right away, while a long reply waits
      //      out the remaining "typing" time. Capped so nobody waits more than ~12s.
      const TYPING_CHARS_PER_SEC = (40 * 5) / 60; // ~40 WPM, 5 chars/word ≈ 3.3 chars/s
      const READ_LEAD_MS = 1000;                  // "saw your message, starting to type"
      const MAX_TYPING_MS = 12000;
      const jitter = 0.85 + Math.random() * 0.3;  // ±15% so the cadence isn't metronomic
      const typingTargetMs = Math.min(
        MAX_TYPING_MS,
        (READ_LEAD_MS + (responseText.length / TYPING_CHARS_PER_SEC) * 1000) * jitter
      );
      const typingSleepMs = Math.max(0, Math.round(typingTargetMs) - (Date.now() - startTime));
      if (typingSleepMs > 0) {
        console.log('[dh-auto-reply] typing delay', typingSleepMs, 'ms for', matchId, '(', responseText.length, 'chars)');
        await new Promise((r) => setTimeout(r, typingSleepMs));
      }

      // 12. Insert reply
      const { error: sendError } = await supabase.rpc('rpc_send_message', {
        match_id: matchId,
        content: responseText,
        sender_id: bot.userid,
      });
      if (sendError) throw sendError;

      // 12b. Maybe send a preserved selfie — when the referee says it's welcome
      //      (or the user asked) AND intimacy clears the threshold AND we're past
      //      the cooldown AND the DH still has an unsent selfie for this match.
      let selfieSentAt: string | null = null;
      try {
        const selfieCfg = await getSelfieConfig();
        const wantsSelfie =
          !!critic &&
          selfieCfg.enabled &&
          (critic.userRequestedPhoto || (critic.selfieAppropriate && critic.intimacy >= selfieCfg.threshold));
        const cooledDown =
          !stateData.last_selfie_sent_at ||
          Date.now() - new Date(stateData.last_selfie_sent_at).getTime() >= selfieCfg.cooldownHours * 3600_000;
        if (wantsSelfie && cooledDown) {
          const selfie = await pickUnsentSelfie(dhId, matchId);
          if (selfie) {
            const { data: imgMsg, error: imgErr } = await supabase.rpc('rpc_send_message', {
              match_id: matchId,
              media_url: selfie.public_url,
              sender_id: bot.userid,
            });
            if (!imgErr) {
              selfieSentAt = new Date().toISOString();
              await supabase.from('dh_sent_images').insert({
                match_id: matchId,
                image_id: selfie.id,
                message_id: (imgMsg as { id?: string } | null)?.id ?? null,
              });
              console.log('[dh-auto-reply] Sent selfie', selfie.id, 'to match', matchId, '(intimacy', critic?.intimacy, ')');
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
