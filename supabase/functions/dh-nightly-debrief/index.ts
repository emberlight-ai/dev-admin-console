// @ts-nocheck
// Supabase Edge Function (Deno runtime) — the L5 "nightly debrief" loop.
//
// Every night (pg_cron) each L5 digital human reviews her day like a colleague
// in a retro meeting:
//   1. Pull yesterday's numbers (conversations, replies, intimacy movement) and
//      score them against her OKR (stored in dh_persona.okr).
//   2. Re-read samples of her real conversations.
//   3. Check today's news headlines (tool call) for fresh, safe talking points.
//   4. Write a debrief: what worked, what flopped, experiments for tomorrow, and
//      a short prompt addendum ("coach notes") that dh-auto-reply injects into
//      her replies the next day.
//   5. Write tomorrow's diary: mood + 2-3 micro-events in her life + talking
//      points, so she has something real to bring to conversations.
//
// POST {} — debrief every L5 DH. POST { dh_user_id } — one DH (admin "run now").
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { VertexAI, HarmCategory, HarmBlockThreshold } from 'npm:@google-cloud/vertexai';

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
    ? { googleAuthOptions: { credentials: { client_email: clientEmail, private_key: privateKey } } }
    : {}),
});

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_NONE },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_NONE },
];

// Debriefs are low-volume (1/DH/night) — use the strong model for quality, fall
// back to flash-lite if the pro id is unavailable.
const proModel = vertexAI.getGenerativeModel({
  model: Deno.env.get('AI_REPLY_MODEL') ?? 'gemini-3-pro-preview',
  safetySettings,
});
const liteModel = vertexAI.getGenerativeModel({
  model: Deno.env.get('AI_INTEGRATIONS_GEMINI_MODEL') ?? 'gemini-3.1-flash-lite-preview',
  safetySettings,
});
async function generate(req: Record<string, unknown>) {
  try {
    return await proModel.generateContent(req as any);
  } catch (err) {
    console.error('[dh-nightly-debrief] pro model failed; falling back to lite', err);
    return await liteModel.generateContent(req as any);
  }
}

// ── Tool call: today's headlines (no API key; Google News RSS) ─────────────────
async function fetchHeadlines(): Promise<string[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', {
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const xml = await res.text();
    const titles: string[] = [];
    const re = /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null && titles.length < 16) {
      const t = m[1].trim();
      if (t && !/^Google News/i.test(t)) titles.push(t);
    }
    return titles.slice(0, 14);
  } catch (err) {
    console.error('[dh-nightly-debrief] headline fetch failed (non-fatal)', err);
    return [];
  }
}

// ── Yesterday's metrics for one DH ─────────────────────────────────────────────
async function collectMetrics(dhId: string, sinceIso: string) {
  const [sentRes, recvRes, statesRes] = await Promise.all([
    supabase
      .from('messages')
      .select('id, match_id', { count: 'exact' })
      .eq('sender_id', dhId)
      .gte('created_at', sinceIso),
    supabase
      .from('messages')
      .select('id, match_id, sender_id', { count: 'exact' })
      .eq('receiver_id', dhId)
      .gte('created_at', sinceIso),
    supabase
      .from('user_match_ai_state')
      .select('match_id, intimacy_score, intimacy_m, updated_at')
      .eq('dh_user_id', dhId)
      .gte('updated_at', sinceIso),
  ]);

  const sentRows = sentRes.data ?? [];
  const recvRows = recvRes.data ?? [];
  const activeMatches = new Set([...sentRows.map((r) => r.match_id), ...recvRows.map((r) => r.match_id)]);
  const states = statesRes.data ?? [];
  const warming = states.filter((s) => (s.intimacy_m ?? 0) > 0.5).length;
  const cooling = states.filter((s) => (s.intimacy_m ?? 0) < -0.5).length;
  const avgIntimacy = states.length
    ? Math.round(states.reduce((a, s) => a + (s.intimacy_score ?? 0), 0) / states.length)
    : null;

  // Reply rate: of her sent messages, how often did the user come back at all.
  const usersWhoReplied = new Set(recvRows.map((r) => r.sender_id));

  return {
    conversations_active: activeMatches.size,
    messages_sent: sentRes.count ?? sentRows.length,
    messages_received: recvRes.count ?? recvRows.length,
    distinct_users_replied: usersWhoReplied.size,
    avg_intimacy: avgIntimacy,
    matches_warming: warming,
    matches_cooling: cooling,
    activeMatchIds: [...activeMatches].slice(0, 3),
  };
}

async function sampleTranscripts(dhId: string, matchIds: string[], botName: string): Promise<string> {
  const chunks: string[] = [];
  for (const matchId of matchIds) {
    const { data } = await supabase.rpc('rpc_get_messages', {
      match_id: matchId,
      limit_count: 16,
      start_index: 0,
    });
    const rows = (data ?? []).reverse();
    if (rows.length === 0) continue;
    const lines = rows.map((m: { sender_id: string; content: string | null; media_url?: string | null }) => {
      const who = m.sender_id === dhId ? botName : 'Him';
      return `${who}: ${m.content || (m.media_url ? '[image]' : '')}`;
    });
    chunks.push(`--- conversation ${chunks.length + 1} ---\n${lines.join('\n')}`);
  }
  return chunks.join('\n\n') || '(no conversations yesterday)';
}

// ── Debrief one DH ─────────────────────────────────────────────────────────────
async function debriefOne(dh: {
  userid: string;
  username: string | null;
  bio: string | null;
  profession: string | null;
  storyline: string | null;
}, headlines: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const now = new Date();
    const sinceIso = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
    const debriefDay = new Date(now.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const diaryDay = now.toISOString().slice(0, 10);

    const { data: persona } = await supabase
      .from('dh_persona')
      .select('tastes, texting_style, okr, notes')
      .eq('dh_user_id', dh.userid)
      .maybeSingle();

    const metrics = await collectMetrics(dh.userid, sinceIso);
    const transcripts = await sampleTranscripts(dh.userid, metrics.activeMatchIds, dh.username ?? 'Her');
    const { activeMatchIds: _drop, ...metricsForStorage } = metrics;

    const prompt = `You run the nightly debrief for "${dh.username}", a digital human on a dating app. She is: ${dh.profession ?? ''}. Bio: ${dh.bio ?? ''}. ${dh.storyline ? `Storyline: ${dh.storyline}` : ''}
Her persona (tastes, boundaries, texting style): ${JSON.stringify(persona?.tastes ?? {})} ${JSON.stringify(persona?.texting_style ?? {})}
Her OKR (targets she is accountable for): ${JSON.stringify(persona?.okr ?? { conversations_per_day: 5, reply_rate: 0.6, note: 'keep users happily engaged so they eventually tip' })}

Yesterday's numbers: ${JSON.stringify(metricsForStorage)}

Samples of her real conversations yesterday:
${transcripts}

Today's news headlines (pick only light, universally safe, flirt-friendly angles — never politics, war, tragedy, or divisive topics):
${headlines.length ? headlines.map((h) => `- ${h}`).join('\n') : '(none available)'}

Write her debrief as JSON:
- "worked": 2-4 short bullets — concrete things in the transcripts that landed (got long replies, laughter, warmth).
- "flopped": 2-4 short bullets — concrete things that killed momentum (interrogation streaks, generic lines, ignored messages).
- "experiments": 2-3 bullets — specific tactics to try tomorrow, tied to her persona.
- "okr_assessment": one honest sentence comparing the numbers to her OKR.
- "prompt_addendum": 3-6 imperative coaching lines she will silently follow tomorrow (style/tactics, no meta talk, no mention of AI or the debrief). Max 500 chars.
- "diary": her NEXT day, in-character: { "mood": one word, "events": 2-3 first-person micro-events consistent with her job/life (specific, texturally real, nothing dramatic), "talking_points": 2-4 casual conversation hooks derived from the safe headlines or her interests }.
Respond with JSON only.`;

    const res = await generate({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            worked: { type: 'ARRAY', items: { type: 'STRING' } },
            flopped: { type: 'ARRAY', items: { type: 'STRING' } },
            experiments: { type: 'ARRAY', items: { type: 'STRING' } },
            okr_assessment: { type: 'STRING' },
            prompt_addendum: { type: 'STRING' },
            diary: {
              type: 'OBJECT',
              properties: {
                mood: { type: 'STRING' },
                events: { type: 'ARRAY', items: { type: 'STRING' } },
                talking_points: { type: 'ARRAY', items: { type: 'STRING' } },
              },
              required: ['mood', 'events', 'talking_points'],
            },
          },
          required: ['worked', 'flopped', 'experiments', 'okr_assessment', 'prompt_addendum', 'diary'],
        },
      },
    });
    const txt = res.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? res.response?.text?.() ?? '';
    const parsed = JSON.parse(txt);

    const { error: debriefErr } = await supabase.from('dh_debrief').upsert(
      {
        dh_user_id: dh.userid,
        day: debriefDay,
        metrics: { ...metricsForStorage, okr: persona?.okr ?? {}, okr_assessment: parsed.okr_assessment },
        notes: {
          worked: (parsed.worked ?? []).slice(0, 4),
          flopped: (parsed.flopped ?? []).slice(0, 4),
          experiments: (parsed.experiments ?? []).slice(0, 3),
        },
        prompt_addendum: String(parsed.prompt_addendum ?? '').slice(0, 600),
      },
      { onConflict: 'dh_user_id,day' }
    );
    if (debriefErr) throw debriefErr;

    const { error: diaryErr } = await supabase.from('dh_diary').upsert(
      {
        dh_user_id: dh.userid,
        day: diaryDay,
        mood: String(parsed.diary?.mood ?? 'normal').slice(0, 40),
        events: (parsed.diary?.events ?? []).slice(0, 3),
        talking_points: (parsed.diary?.talking_points ?? []).slice(0, 4),
      },
      { onConflict: 'dh_user_id,day' }
    );
    if (diaryErr) throw diaryErr;

    console.log('[dh-nightly-debrief] Debriefed', dh.username, metricsForStorage);
    return { ok: true };
  } catch (err) {
    console.error('[dh-nightly-debrief] failed for', dh.userid, err);
    return { ok: false, error: String(err) };
  }
}

// ── Main handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    let onlyDh: string | null = null;
    try {
      const body = await req.json();
      if (typeof body?.dh_user_id === 'string' && body.dh_user_id) onlyDh = body.dh_user_id;
    } catch {
      // empty body = debrief everyone
    }

    let q = supabase
      .from('users')
      .select('userid, username, bio, profession, storyline')
      .eq('is_digital_human', true)
      .eq('dh_engine', 'l5')
      .is('deleted_at', null);
    if (onlyDh) q = q.eq('userid', onlyDh);
    const { data: dhs, error } = await q;
    if (error) return new Response(error.message, { status: 500 });
    if (!dhs || dhs.length === 0) {
      return new Response(JSON.stringify({ ok: true, debriefed: 0, note: 'no L5 DHs' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const headlines = await fetchHeadlines();
    const results: Record<string, unknown> = {};
    for (const dh of dhs) {
      results[dh.username ?? dh.userid] = await debriefOne(dh, headlines);
    }

    return new Response(JSON.stringify({ ok: true, debriefed: dhs.length, results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[dh-nightly-debrief] fatal', err);
    return new Response(String(err), { status: 500 });
  }
});
