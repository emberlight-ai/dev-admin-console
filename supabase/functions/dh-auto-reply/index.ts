// @ts-nocheck
// Supabase Edge Function (Deno runtime) — replaces scripts/digital-human-auto-replies.ts
// Triggered by: DB Webhook on `messages` table INSERT
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { VertexAI } from 'npm:@google-cloud/vertexai';
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

const model = vertexAI.getGenerativeModel({
  model: Deno.env.get('AI_INTEGRATIONS_GEMINI_MODEL') ?? 'gemini-3.1-flash-lite-preview',
});

// ── In-process cache (survives warm invocations on Deno Deploy) ───────────────
interface CachedPrompt {
  template: string;
  responseDelay: number;
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
      'gender, personality, system_prompt, response_delay, immediate_match_enabled, follow_up_message_enabled, follow_up_message_prompt, follow_up_delay, max_follow_ups, active_greeting_enabled, active_greeting_prompt, created_at'
    )
    .order('created_at', { ascending: false });

  const newCache = new Map<string, CachedPrompt>();
  for (const row of data ?? []) {
    const key = `${(row.gender || '').trim()}:${(row.personality || '').trim()}`;
    if (newCache.has(key)) continue;
    newCache.set(key, {
      template: row.system_prompt,
      responseDelay: row.response_delay || 0,
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
    .select('userid, is_digital_human, username, gender, personality, age, bio, profession, zipcode')
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

function generateUserProfileBlock(input: {
  username?: string | null;
  age?: number | null;
  bio?: string | null;
  zipcode?: string | null;
  profession?: string | null;
}): string {
  return `<user_profile>
**Username:** ${input.username || 'N/A'}
**Bio:** ${input.bio || 'N/A'}
**Age:** ${input.age ?? '—'}
**Zipcode:** ${input.zipcode || 'N/A'}
**Profession:** ${input.profession || 'N/A'}
**Current UTC Time:** ${new Date().toISOString()} (convert to user local time using Zipcode)
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
    zipcode: human.zipcode,
    profession: human.profession,
  });

  let prompt = template;
  prompt = prompt.replace(/<bot_profile>[\s\r\n]*BOT_PROFILE_DETAILS[\s\r\n]*<\/bot_profile>/i, botBlock);
  prompt = prompt.replace(/<user_profile>[\s\r\n]*USER_PROFILE_DETAILS[\s\r\n]*<\/user_profile>/i, userBlock);
  return prompt;
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

    // 1. Bail-out checks
    if (!(await getAutoReplyEnabled())) {
      return new Response('Auto-reply disabled', { status: 200 });
    }

    await ensurePrompts();

    // 2. Fetch ai state for this match
    const { data: stateData, error: stateErr } = await supabase
      .from('user_match_ai_state')
      .select('match_id, last_message_id, last_message_at, ai_last_processed_message_id, ai_locked_until, scheduled_response_at, dh_user_id, real_user_id, ai_state')
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

    // 7. Response delay — set scheduled_response_at and return; pg_cron will re-trigger
    if (!stateData.scheduled_response_at && promptConfig?.responseDelay && promptConfig.responseDelay > 0) {
      if (stateData.last_message_at) {
        const targetTime = new Date(stateData.last_message_at).getTime() + promptConfig.responseDelay * 1000;
        if (targetTime > Date.now()) {
          await supabase
            .from('user_match_ai_state')
            .update({ scheduled_response_at: new Date(targetTime).toISOString() })
            .eq('match_id', matchId);
          console.log('[dh-auto-reply] Scheduled response for', matchId, 'at', new Date(targetTime).toISOString());
          return new Response('Scheduled', { status: 200 });
        }
      }
    }

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
      const prompt = `${systemInstruction}\n\nConversation so far:\n${transcript}\n\nWrite the next message as ${bot.username ?? 'the bot'}. Reply with only the message text.`;

      // 11. Call Gemini
      console.log('[dh-auto-reply] systemInstruction', systemInstruction);
      console.log('[dh-auto-reply] transcript', transcript);
      const result = await model.generateContent(prompt);
      const respData = await result.response;
      const responseText = respData?.candidates?.[0]?.content?.parts?.[0]?.text || respData?.text?.() || "";

      // 12. Insert reply
      const { error: sendError } = await supabase.rpc('rpc_send_message', {
        match_id: matchId,
        content: responseText,
        sender_id: bot.userid,
      });
      if (sendError) throw sendError;

      // 13. Update state
      await supabase
        .from('user_match_ai_state')
        .update({
          ai_last_processed_message_id: checkpointId,
          scheduled_response_at: null,
          ai_locked_until: null,
          ai_follow_up_count: 0,
          ai_state: 2, // DH Sent
        })
        .eq('match_id', matchId);

      console.log('[dh-auto-reply] Replied to match', matchId);
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
