// @ts-nocheck
// Supabase Edge Function (Deno runtime).
// Dispatches due rows from `scheduled_dh_invites`: a DH the user saw nearby "reaches
// out" with a pending match_request + a Gemini-generated opener, then a push.
// It does NOT create a match — the user accepts to turn it into a conversation.
// Triggered by pg_cron (~every minute); per-invite run_at is what staggers arrivals.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { VertexAI } from 'npm:@google-cloud/vertexai';
import admin from 'npm:firebase-admin@12.0.0';

// ── Clients ─────────────────────────────────────────────────────────────────────
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const serviceAccount = JSON.parse(Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || '{}');
if (admin.apps.length === 0) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
}

const project = Deno.env.get('GOOGLE_CLOUD_PROJECT_ID') || 'YOUR_PROJECT_ID';
const location = Deno.env.get('GOOGLE_CLOUD_LOCATION') || 'global';
const clientEmail = Deno.env.get('GOOGLE_CLIENT_EMAIL');
const privateKey = Deno.env.get('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

const vertexAI = new VertexAI({
  project,
  location,
  apiEndpoint: 'aiplatform.googleapis.com',
  ...(clientEmail && privateKey
    ? { googleAuthOptions: { credentials: { client_email: clientEmail, private_key: privateKey } } }
    : {}),
});
const model = vertexAI.getGenerativeModel({
  model: Deno.env.get('AI_INTEGRATIONS_GEMINI_MODEL') ?? 'gemini-3.1-flash-lite-preview',
});

// ── Caches (mirror dh-greeting) ─────────────────────────────────────────────────
interface CachedPrompt {
  template: string;
  activeGreetingEnabled: boolean;
  activeGreetingPrompt?: string;
}
let promptCache: Map<string, CachedPrompt> = (globalThis as any).__dhNearbyPromptCache ?? new Map();
let promptCacheTs: number = (globalThis as any).__dhNearbyPromptCacheTs ?? 0;
const PROMPT_TTL_MS = 60 * 60 * 1000;

let openerStyles: string[] = (globalThis as any).__dhNearbyStyles ?? [];
let stylesTs: number = (globalThis as any).__dhNearbyStylesTs ?? 0;
const CONFIG_TTL_MS = 5 * 60 * 1000;

interface UserRow {
  userid: string;
  is_digital_human: boolean;
  username: string | null;
  gender: string | null;
  personality: string | null;
  age: number | null;
  bio: string | null;
  profession: string | null;
  location_name: string | null;
  timezone: string | null;
  avatar: string | null;
}

async function ensurePrompts() {
  if (Date.now() - promptCacheTs <= PROMPT_TTL_MS && promptCache.size > 0) return;
  const { data } = await supabase
    .from('SystemPrompts')
    .select('gender, personality, system_prompt, active_greeting_enabled, active_greeting_prompt, created_at')
    .order('created_at', { ascending: false });
  const next = new Map<string, CachedPrompt>();
  for (const row of data ?? []) {
    const key = `${(row.gender || '').trim()}:${(row.personality || '').trim()}`;
    if (next.has(key)) continue;
    next.set(key, {
      template: row.system_prompt,
      activeGreetingEnabled: row.active_greeting_enabled || false,
      activeGreetingPrompt: row.active_greeting_prompt || undefined,
    });
  }
  promptCache = next;
  promptCacheTs = Date.now();
  (globalThis as any).__dhNearbyPromptCache = promptCache;
  (globalThis as any).__dhNearbyPromptCacheTs = promptCacheTs;
}

async function ensureStyles() {
  if (Date.now() - stylesTs <= CONFIG_TTL_MS && openerStyles.length > 0) return;
  const { data } = await supabase
    .from('digital_human_config')
    .select('value')
    .eq('key', 'nearby_opener_styles')
    .maybeSingle();
  try {
    const parsed = JSON.parse(data?.value ?? '[]');
    openerStyles = Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string' && s.trim()) : [];
  } catch {
    openerStyles = [];
  }
  if (openerStyles.length === 0) {
    openerStyles = ['keep it to 2-6 words', 'react to noticing they are nearby', 'ask one tiny question'];
  }
  stylesTs = Date.now();
  (globalThis as any).__dhNearbyStyles = openerStyles;
  (globalThis as any).__dhNearbyStylesTs = stylesTs;
}

function getPromptConfig(user: Pick<UserRow, 'gender' | 'personality'>): CachedPrompt | undefined {
  const g = (user.gender || 'Female').trim();
  const p = (user.personality || 'General').trim();
  return promptCache.get(`${g}:${p}`) ?? promptCache.get(`${g}:General`);
}

// ── Prompt composition (inlined from dh-greeting) ───────────────────────────────
const DEFAULT_TZ = 'America/Los_Angeles';
function describeLocalTime(timezone?: string | null): string {
  const tz = timezone || DEFAULT_TZ;
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(now);
    const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
    const h23 = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
    const partOfDay = h23 < 5 ? 'late at night' : h23 < 12 ? 'in the morning' : h23 < 17 ? 'in the afternoon' : h23 < 21 ? 'in the evening' : 'at night';
    const approx = timezone ? '' : ' (approx — timezone unknown)';
    return `${get('weekday')} ${get('hour')}:${get('minute')} ${get('dayPeriod')}, ${partOfDay}${approx}`;
  } catch {
    return new Date().toISOString();
  }
}

function botBlock(b: UserRow): string {
  return `<bot_profile>
**Name:** ${b.username || 'Unknown'}
**Age:** ${b.age ?? '—'}
**Archetype:** ${b.profession || 'Digital Human'}
**Background:** ${b.bio || '—'}
</bot_profile>`;
}
function userBlock(u: UserRow): string {
  return `<user_profile>
**Username:** ${u.username || 'N/A'}
**Bio:** ${u.bio || 'N/A'}
**Age:** ${u.age ?? '—'}
**Location:** ${u.location_name || 'Unknown'}
**Profession:** ${u.profession || 'N/A'}
**Their local time right now:** ${describeLocalTime(u.timezone)}
</user_profile>`;
}
function composeSystemText(template: string, bot: UserRow, human: UserRow): string {
  let prompt = template;
  prompt = prompt.replace(/<bot_profile>[\s\r\n]*BOT_PROFILE_DETAILS[\s\r\n]*<\/bot_profile>/i, botBlock(bot));
  prompt = prompt.replace(/<user_profile>[\s\r\n]*USER_PROFILE_DETAILS[\s\r\n]*<\/user_profile>/i, userBlock(human));
  return prompt;
}

function pickStyle(): string {
  if (openerStyles.length === 0) return 'keep it short and casual';
  return openerStyles[Math.floor(Math.random() * openerStyles.length)];
}

async function generateOpener(bot: UserRow, human: UserRow, cfg: CachedPrompt): Promise<string> {
  const systemText = composeSystemText(cfg.template, bot, human);
  const base = (cfg.activeGreetingPrompt || '').trim() ||
    'Send a short, friendly opener to start the conversation. Keep it natural and concise.';
  const style = pickStyle();
  const greetingPrompt = `${base}\nYou noticed this person is nearby. Open with a casual hello. Style for THIS message: ${style}. Do not repeat a generic template — make it feel spontaneous and human. Avoid quotation marks.`;

  const chat = model.startChat({
    history: [],
    systemInstruction: { role: 'system', parts: [{ text: systemText }] },
  });
  const result = await chat.sendMessage(`[System: ${greetingPrompt}]`);
  const resp = await result.response;
  const text = resp?.candidates?.[0]?.content?.parts?.[0]?.text || resp?.text?.() || '';
  return text.trim();
}

// ── Push ─────────────────────────────────────────────────────────────────────────
async function sendInvitePush(toUserId: string, dh: UserRow, requestId: string, opener: string) {
  const { data: tokens } = await supabase
    .from('user_push_tokens')
    .select('token')
    .eq('user_id', toUserId);
  if (!tokens || tokens.length === 0) return;
  const fcmTokens = tokens.map((t) => t.token);
  const dhName = dh.username || 'Someone';
  const avatarUrl = dh.avatar && dh.avatar.trim().length > 0 ? dh.avatar.trim() : undefined;
  const message = {
    tokens: fcmTokens,
    notification: {
      title: dhName,
      body: opener || 'sent you an invitation 👋',
      // Shows the DH's photo on the notification (mirrors push-notification).
      ...(avatarUrl ? { imageUrl: avatarUrl } : {}),
    },
    data: {
      type: 'invitation',
      request_id: requestId,
      from_user_id: dh.userid,
      from_username: dhName,
      from_avatar: dh.avatar || '',
      // Keys the iOS Notification Service Extension uses to render the avatar as a
      // communication notification (same shape as push-notification).
      sender_id: dh.userid,
      sender_name: dhName,
      ...(avatarUrl ? { sender_avatar_url: avatarUrl } : {}),
      greeting: opener || '',
    },
    apns: {
      // mutableContent lets the Notification Service Extension attach the avatar image.
      ...(avatarUrl ? { fcmOptions: { imageUrl: avatarUrl } } : {}),
      payload: { aps: { sound: 'default', badge: 1, mutableContent: Boolean(avatarUrl) } },
    },
  };
  try {
    const res = await admin.messaging().sendEachForMulticast(message);
    if (res.failureCount > 0) {
      const bad: string[] = [];
      res.responses.forEach((r, i) => { if (!r.success) bad.push(fcmTokens[i]); });
      if (bad.length) await supabase.from('user_push_tokens').delete().in('token', bad);
    }
  } catch (err) {
    console.error('[dh-nearby-dispatch] push failed', err);
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────────
const USER_FIELDS = 'userid, is_digital_human, username, gender, personality, age, bio, profession, location_name, timezone, avatar';

Deno.serve(async () => {
  try {
    await Promise.all([ensurePrompts(), ensureStyles()]);

    const limit = parseInt(Deno.env.get('NEARBY_DISPATCH_LIMIT') ?? '30', 10);
    const { data: due, error: claimErr } = await supabase.rpc('claim_due_nearby_invites', { p_limit: limit });
    if (claimErr) {
      console.error('[dh-nearby-dispatch] claim error', claimErr);
      return new Response(JSON.stringify({ error: claimErr.message }), { status: 500 });
    }
    if (!due || due.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let sent = 0;
    let skipped = 0;

    for (const row of due) {
      try {
        // Load both profiles
        const { data: users } = await supabase.from('users').select(USER_FIELDS).in('userid', [row.dh_user_id, row.user_id]);
        const dh = (users ?? []).find((u: UserRow) => u.userid === row.dh_user_id) as UserRow | undefined;
        const human = (users ?? []).find((u: UserRow) => u.userid === row.user_id) as UserRow | undefined;

        // Re-check eligibility right before sending
        const stillEligible =
          dh && human && dh.is_digital_human && !human.is_digital_human;
        if (!stillEligible) {
          await supabase.from('scheduled_dh_invites').update({ status: 'skipped' }).eq('id', row.id);
          skipped++;
          continue;
        }
        const { data: existing } = await supabase
          .from('match_requests')
          .select('id')
          .or(`and(from_user_id.eq.${row.dh_user_id},to_user_id.eq.${row.user_id}),and(from_user_id.eq.${row.user_id},to_user_id.eq.${row.dh_user_id})`)
          .limit(1);
        const { data: matched } = await supabase
          .from('user_matches')
          .select('id')
          .eq('user_a', row.dh_user_id < row.user_id ? row.dh_user_id : row.user_id)
          .eq('user_b', row.dh_user_id < row.user_id ? row.user_id : row.dh_user_id)
          .limit(1);
        if ((existing && existing.length) || (matched && matched.length)) {
          await supabase.from('scheduled_dh_invites').update({ status: 'skipped' }).eq('id', row.id);
          skipped++;
          continue;
        }

        // Always let Gemini write the opener (the nearby invite IS the greeting) — do
        // not gate on active_greeting_enabled, which is for the separate proactive-greeting
        // feature and is off for many personalities (that was causing "hey 👋" fallbacks).
        const cfg = getPromptConfig(dh);
        let opener = '';
        if (cfg) {
          try {
            opener = await generateOpener(dh, human, cfg);
          } catch (genErr) {
            console.error('[dh-nearby-dispatch] generation failed', row.id, genErr);
          }
        }
        if (!opener) opener = 'hey 👋';

        const { data: inserted, error: insErr } = await supabase
          .from('match_requests')
          .insert({
            from_user_id: row.dh_user_id,
            to_user_id: row.user_id,
            greeting: opener,
            greeting_generated_at: new Date().toISOString(),
          })
          .select('id')
          .single();
        if (insErr) {
          // Likely a unique (from,to) collision — treat as skipped.
          console.warn('[dh-nearby-dispatch] insert match_request failed', row.id, insErr.message);
          await supabase.from('scheduled_dh_invites').update({ status: 'skipped' }).eq('id', row.id);
          skipped++;
          continue;
        }

        await supabase.from('scheduled_dh_invites').update({ status: 'done' }).eq('id', row.id);
        await sendInvitePush(row.user_id, dh, inserted.id, opener);
        sent++;
      } catch (rowErr) {
        console.error('[dh-nearby-dispatch] row error', row.id, rowErr);
        await supabase.from('scheduled_dh_invites').update({ status: 'pending' }).eq('id', row.id); // let it retry
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, skipped }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[dh-nearby-dispatch] fatal', err);
    return new Response(String(err), { status: 500 });
  }
});
