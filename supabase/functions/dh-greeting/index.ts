// @ts-nocheck
// Supabase Edge Function (Deno runtime) — replaces scripts/digital-human-greetings.ts
// Triggered by: DB Webhook on `user_matches` table INSERT
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { GoogleGenerativeAI } from 'npm:@google/generative-ai@0.21.0';

// ── Clients ────────────────────────────────────────────────────────────────────
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const genAI = new GoogleGenerativeAI(Deno.env.get('AI_INTEGRATIONS_GEMINI_API_KEY')!);
const rawBaseUrl = Deno.env.get('AI_INTEGRATIONS_GEMINI_BASE_URL');
const geminiBaseUrl = rawBaseUrl?.startsWith('http') ? rawBaseUrl : undefined;
const model = genAI.getGenerativeModel(
  { model: Deno.env.get('AI_INTEGRATIONS_GEMINI_MODEL') ?? 'gemini-2.5-flash' },
  geminiBaseUrl ? { baseUrl: geminiBaseUrl } : {}
);

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

const globalPromptCache = (globalThis as any).__dhGreetPromptCache as Map<string, CachedPrompt> | undefined;
const globalPromptCacheTs = (globalThis as any).__dhGreetPromptCacheTs as number | undefined;
let systemPromptCache: Map<string, CachedPrompt> = globalPromptCache ?? new Map();
let lastPromptRefresh = globalPromptCacheTs ?? 0;
const PROMPT_TTL_MS = 60 * 60 * 1000;
const LOCK_DURATION_SECONDS = 30;

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
  (globalThis as any).__dhGreetPromptCache = systemPromptCache;
  (globalThis as any).__dhGreetPromptCacheTs = lastPromptRefresh;
}

async function ensurePrompts() {
  if (Date.now() - lastPromptRefresh > PROMPT_TTL_MS) await refreshPrompts();
}

function getPromptConfig(user: Pick<UserRow, 'gender' | 'personality'>): CachedPrompt | undefined {
  const g = (user.gender || 'Female').trim();
  const p = (user.personality || 'General').trim();
  return systemPromptCache.get(`${g}:${p}`) ?? systemPromptCache.get(`${g}:General`);
}

// Inline profile block builders (cannot import from src/ in Deno runtime)
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
    id: string;      // match_id
    user_a: string;
    user_b: string;
    created_at: string;
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();

    if (payload.type !== 'INSERT' || payload.table !== 'user_matches') {
      return new Response('Ignored', { status: 200 });
    }

    await ensurePrompts();

    const matchId = payload.record.id;
    const userAId = payload.record.user_a;
    const userBId = payload.record.user_b;

    // 1. Fetch both users
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('userid, is_digital_human, username, gender, personality, age, bio, profession, zipcode')
      .in('userid', [userAId, userBId]);

    if (usersErr || !users || users.length < 2) {
      console.error('[dh-greeting] Could not fetch users for match', matchId);
      return new Response('Users not found', { status: 400 });
    }

    const userRows = users as unknown as UserRow[];
    const botUser = userRows.find((u) => u.is_digital_human);
    const realUser = userRows.find((u) => !u.is_digital_human);

    // Skip if no digital human in this match
    if (!botUser || !realUser) {
      return new Response('No DH in match', { status: 200 });
    }

    // 2. Check prompt config
    const promptConfig = getPromptConfig(botUser);
    if (!promptConfig || !promptConfig.activeGreetingEnabled) {
      // Greeting disabled — move to state 1 so we don't loop
      await supabase
        .from('user_match_ai_state')
        .update({ ai_state: 1 })
        .eq('match_id', matchId);
      console.log('[dh-greeting] Greeting disabled for bot', botUser.userid);
      return new Response('Greeting disabled', { status: 200 });
    }

    // 3. Check the current ai state — ensure ai_state = 0 and not locked
    const stateResult = await supabase
      .from('user_match_ai_state')
      .select('ai_state, ai_locked_until, ai_greeting_sent')
      .eq('match_id', matchId)
      .single();

    let stateData = stateResult.data;

    // Race condition: the trigger that creates user_match_ai_state and this pg_net
    // call both fire after the same transaction commits. Give it one retry.
    if (!stateData) {
      await new Promise((r) => setTimeout(r, 1500));
      const { data: retryData } = await supabase
        .from('user_match_ai_state')
        .select('ai_state, ai_locked_until, ai_greeting_sent')
        .eq('match_id', matchId)
        .single();
      stateData = retryData;
    }

    if (!stateData) {
      console.warn('[dh-greeting] No ai state row for match even after retry', matchId);
      return new Response('No state row', { status: 200 });
    }

    if (stateData.ai_greeting_sent || stateData.ai_state !== 0) {
      return new Response('Greeting already sent or wrong state', { status: 200 });
    }

    if (stateData.ai_locked_until && new Date(stateData.ai_locked_until).getTime() > Date.now()) {
      return new Response('Locked', { status: 200 });
    }

    // 4. Acquire lock
    const lockTime = new Date(Date.now() + LOCK_DURATION_SECONDS * 1000).toISOString();
    const { error: lockErr } = await supabase
      .from('user_match_ai_state')
      .update({ ai_locked_until: lockTime })
      .eq('match_id', matchId)
      .eq('ai_greeting_sent', false)
      .is('last_message_id', null);

    if (lockErr) {
      console.log('[dh-greeting] Lock contention for match', matchId);
      return new Response('Lock contention', { status: 200 });
    }

    try {
      // 5. Build prompt and generate greeting
      const systemText = composeSystemText(promptConfig.template, botUser, realUser);
      const greetingPrompt =
        (promptConfig.activeGreetingPrompt || '').trim() ||
        'Send a short friendly greeting to start the conversation. Keep it natural and concise.';

      const chat = model.startChat({
        history: [],
        systemInstruction: {
          role: 'system',
          parts: [{ text: systemText }],
        },
      });

      const result = await chat.sendMessage(`[System: ${greetingPrompt}]`);
      const responseText = result.response.text();

      // 6. Send greeting message
      const { error: sendError } = await supabase.rpc('rpc_send_message', {
        match_id: matchId,
        content: responseText,
        sender_id: botUser.userid,
      });
      if (sendError) throw sendError;

      // 7. Update state
      await supabase
        .from('user_match_ai_state')
        .update({
          ai_greeting_sent: true,
          ai_greeting_sent_at: new Date().toISOString(),
          ai_locked_until: null,
          ai_state: 1, // Greeting Sent
        })
        .eq('match_id', matchId);

      console.log('[dh-greeting] Greeting sent for match', matchId);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('[dh-greeting] Error sending greeting for match', matchId, err);
      await supabase.from('user_match_ai_state').update({ ai_locked_until: null }).eq('match_id', matchId);
      return new Response(String(err), { status: 500 });
    }
  } catch (err) {
    console.error('[dh-greeting] Fatal error', err);
    return new Response(String(err), { status: 500 });
  }
});
