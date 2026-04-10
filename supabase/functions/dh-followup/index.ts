// @ts-nocheck
// Supabase Edge Function (Deno runtime) — replaces scripts/digital-human-followups.ts
// Triggered by: pg_cron every 15 minutes via pg_net HTTP call
// See setup instructions in walkthrough.md
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { VertexAI } from 'npm:@google-cloud/vertexai';

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

// ── In-process cache ──────────────────────────────────────────────────────────
interface CachedPrompt {
  template: string;
  responseDelay: number;
  immediateMatchEnabled: boolean;
  followUpEnabled: boolean;
  followUpPrompt?: string;
  followUpDelay: number;
  maxFollowUps: number;
  activeGreetingEnabled: boolean;
  activeGreetingPrompt?: string;
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

const globalPromptCache = (globalThis as any).__dhFollowPromptCache as Map<string, CachedPrompt> | undefined;
const globalPromptCacheTs = (globalThis as any).__dhFollowPromptCacheTs as number | undefined;
let systemPromptCache: Map<string, CachedPrompt> = globalPromptCache ?? new Map();
let lastPromptRefresh = globalPromptCacheTs ?? 0;
const PROMPT_TTL_MS = 60 * 60 * 1000;

const globalUserCache = (globalThis as any).__dhFollowUserCache as Map<string, { value: UserRow; exp: number }> | undefined;
let userRowCache: Map<string, { value: UserRow; exp: number }> = globalUserCache ?? new Map();
const USER_TTL_MS = 10 * 60 * 1000;

const globalConfigCache = (globalThis as any).__dhFollowConfigCache as { followUpEnabled: boolean; exp: number } | undefined;
let configCache: { followUpEnabled: boolean; exp: number } = globalConfigCache ?? { followUpEnabled: true, exp: 0 };
const CONFIG_TTL_MS = 5 * 60 * 1000;

const LOCK_DURATION_SECONDS = 30;

async function getFollowUpEnabled(): Promise<boolean> {
  if (Date.now() < configCache.exp) return configCache.followUpEnabled;
  const { data } = await supabase.from('digital_human_config').select('key, value');
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.key] = r.value;
  configCache = {
    followUpEnabled: map['enable_digital_human_follow_up'] !== 'false',
    exp: Date.now() + CONFIG_TTL_MS,
  };
  (globalThis as any).__dhFollowConfigCache = configCache;
  return configCache.followUpEnabled;
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
  (globalThis as any).__dhFollowPromptCache = systemPromptCache;
  (globalThis as any).__dhFollowPromptCacheTs = lastPromptRefresh;
}

async function ensurePrompts() {
  if (Date.now() - lastPromptRefresh > PROMPT_TTL_MS) await refreshPrompts();
}

function getPromptConfig(user: Pick<UserRow, 'gender' | 'personality'>): CachedPrompt | undefined {
  const g = (user.gender || 'Female').trim();
  const p = (user.personality || 'General').trim();
  return systemPromptCache.get(`${g}:${p}`) ?? systemPromptCache.get(`${g}:General`);
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
  userRowCache.set(userid, { value: row, exp: Date.now() + USER_TTL_MS });
  (globalThis as any).__dhFollowUserCache = userRowCache;
  return row;
}

// Inline profile builders
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

function composeSystemText(template: string, bot: UserRow, human: UserRow): string {
  const botBlock = generateBotProfileBlock({ name: bot.username ?? 'Digital Human', age: bot.age, archetype: bot.profession, bio: bot.bio });
  const userBlock = generateUserProfileBlock({ username: human.username, age: human.age, bio: human.bio, zipcode: human.zipcode, profession: human.profession });
  let prompt = template;
  prompt = prompt.replace(/<bot_profile>[\s\r\n]*BOT_PROFILE_DETAILS[\s\r\n]*<\/bot_profile>/i, botBlock);
  prompt = prompt.replace(/<user_profile>[\s\r\n]*USER_PROFILE_DETAILS[\s\r\n]*<\/user_profile>/i, userBlock);
  return prompt;
}

function buildTranscript(
  messages: Array<{ sender_id: string; content: string | null; media_url?: string | null }>,
  botUserId: string,
  botName: string
): string {
  return messages
    .map((m) => {
      const speaker = m.sender_id === botUserId ? botName : 'User';
      const text = m.content || (m.media_url ? '[Image Sent]' : '');
      return `${speaker}: ${text}`;
    })
    .join('\n');
}

// ── Main handler ──────────────────────────────────────────────────────────────
// This function is called by pg_cron via pg_net (no webhook payload).
// It scans for follow-up candidates and processes them.
Deno.serve(async (req) => {
  // Auth is handled by Supabase Edge Runtime gateway (JWT verification).
  // No custom check needed — if we reach here, the service_role JWT was valid.
  try {
    if (!(await getFollowUpEnabled())) {
      return new Response('Follow-ups disabled', { status: 200 });
    }

    await ensurePrompts();

    const now = Date.now();
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString();

    // Find follow-up candidates: DH sent last message (state 2 or 4), not locked, enough time passed
    const { data, error } = await supabase
      .from('user_match_ai_state')
      .select('match_id, last_message_id, last_message_at, ai_follow_up_count, ai_locked_until, dh_user_id, real_user_id')
      .in('ai_state', [2, 4])
      .lt('last_message_at', oneHourAgo)
      .is('ai_locked_until', null)
      .not('last_message_id', 'is', null);

    if (error) {
      console.error('[dh-followup] Error fetching candidates', error);
      return new Response('DB error', { status: 500 });
    }

    const candidates = data ?? [];
    let processed = 0;

    for (const c of candidates) {
      if (!c.last_message_at || !c.dh_user_id || !c.real_user_id) continue;

      const botUser = await getUserRow(c.dh_user_id);
      if (!botUser || !botUser.is_digital_human) continue;

      const humanUser = await getUserRow(c.real_user_id);
      if (!humanUser) continue;

      const promptConfig = getPromptConfig(botUser);
      if (!promptConfig || !promptConfig.followUpEnabled || !promptConfig.followUpPrompt) continue;

      const max = promptConfig.maxFollowUps || 3;
      if ((c.ai_follow_up_count || 0) >= max) continue;

      const delayMs = (promptConfig.followUpDelay || 86400) * 1000;
      const lastMsgTime = new Date(c.last_message_at).getTime();
      if (now < lastMsgTime + delayMs) continue;

      // Acquire lock
      const lockTime = new Date(now + LOCK_DURATION_SECONDS * 1000).toISOString();
      const { error: lockErr } = await supabase
        .from('user_match_ai_state')
        .update({ ai_locked_until: lockTime })
        .eq('match_id', c.match_id)
        .eq('ai_follow_up_count', c.ai_follow_up_count);

      if (lockErr) continue; // Another process got there first

      try {
        // Fetch recent messages for context
        const { data: messages } = await supabase.rpc('rpc_get_messages', {
          match_id: c.match_id,
          limit_count: 20,
          start_index: 0,
        });
        const msgRows = (messages ?? []) as Array<{ sender_id: string; content: string | null; media_url?: string | null }>;
        const transcript = buildTranscript([...msgRows].reverse(), botUser.userid, botUser.username ?? 'Bot');

        const systemText = composeSystemText(promptConfig.template, botUser, humanUser);
        const followUpInstruction =
          promptConfig.followUpPrompt || 'Send a casual follow-up message to re-engage the conversation.';
        const prompt = `${systemText}\n\nConversation so far:\n${transcript}\n\nThe user hasn't replied in a while.\nInstruction: ${followUpInstruction}\n\nWrite the follow-up as ${botUser.username ?? 'the bot'}. Reply with only the message text.`;

        const result = await model.generateContent(prompt);
        const respData = await result.response;
        const responseText = respData?.candidates?.[0]?.content?.parts?.[0]?.text || respData?.text?.() || "";

        const { data: sentMsg, error: sendError } = await supabase.rpc('rpc_send_message', {
          match_id: c.match_id,
          content: responseText,
          sender_id: botUser.userid,
        });
        if (sendError) throw sendError;

        await supabase
          .from('user_match_ai_state')
          .update({
            ai_follow_up_count: (c.ai_follow_up_count || 0) + 1,
            last_message_id: (sentMsg as { id?: string } | null)?.id ?? c.last_message_id,
            ai_locked_until: null,
            ai_state: 4, // DH Follow-up
          })
          .eq('match_id', c.match_id);

        processed++;
        console.log('[dh-followup] Sent follow-up for match', c.match_id);
      } catch (err) {
        console.error('[dh-followup] Error for match', c.match_id, err);
        await supabase.from('user_match_ai_state').update({ ai_locked_until: null }).eq('match_id', c.match_id);
      }
    }

    console.log(`[dh-followup] Processed ${processed} follow-ups from ${candidates.length} candidates`);
    return new Response(JSON.stringify({ ok: true, processed, candidates: candidates.length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[dh-followup] Fatal error', err);
    return new Response(String(err), { status: 500 });
  }
});
