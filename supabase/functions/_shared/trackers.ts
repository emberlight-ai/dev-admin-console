// @ts-nocheck
// Generic trackers (Skills v2): skills DECLARE what they track; this module
// extracts entries from conversation turns (referee pattern — the actor chats,
// a parallel cheap model records) and renders each skill's computed context
// block. The engine knows aggregates, never domains: calories for Jack, tarot
// pulls for Andy, project ideas for Yossi are all just declarations.
import { supabase, utilityModel } from './clients.ts';

export type TrackerDecl = {
  skill_key: string;
  key: string;
  title: string;
  value_schema: Record<string, string>;
  cadence: string;
  aggregate: 'none' | 'latest' | 'latest_per_subject' | 'sum_today' | 'count_7d';
  value_path: string | null;
};

export type TrackerEntry = {
  tracker_key: string;
  skill_key: string;
  subject: string | null;
  value: Record<string, unknown>;
  source: 'user_message' | 'dh_reply' | 'photo_analysis';
  observed_at?: string;
};

const g = globalThis as any;
const TTL = 5 * 60 * 1000;
const cache: Map<string, { value: TrackerDecl[]; exp: number }> =
  g.__dhTrackerCache instanceof Map ? g.__dhTrackerCache : new Map();
g.__dhTrackerCache = cache;

export async function loadTrackers(skillKeys: string[]): Promise<TrackerDecl[]> {
  if (skillKeys.length === 0) return [];
  const cacheKey = [...skillKeys].sort().join(',');
  const hit = cache.get(cacheKey);
  if (hit && hit.exp > Date.now()) return hit.value;
  const { data, error } = await supabase
    .from('skill_trackers')
    .select('*')
    .in('skill_key', skillKeys);
  if (error) {
    console.error('[dh-trackers] load failed', error);
    return hit?.value ?? [];
  }
  const rows = (data ?? []) as TrackerDecl[];
  cache.set(cacheKey, { value: rows, exp: Date.now() + TTL });
  return rows;
}

// ── Extractor referee ──────────────────────────────────────────────────────────
// One cheap JSON call per turn, schema assembled from the declarations. Scans
// BOTH sides (tarot readings live in the DH's reply) plus the photo description.
export async function extractTrackerEntries(input: {
  trackers: TrackerDecl[];
  userMessage: string | null;
  userImageDesc: string | null;
  dhReply: string | null;
}): Promise<TrackerEntry[]> {
  if (input.trackers.length === 0) return [];
  const declarations = input.trackers
    .map(
      (t) =>
        `- tracker_key "${t.key}" (skill ${t.skill_key}): ${t.title}. Fields: ${JSON.stringify(t.value_schema)}${
          t.aggregate === 'latest_per_subject' ? ' — set "subject" to the entity name.' : ''
        }`
    )
    .join('\n');
  const prompt = `You are a silent data recorder observing one exchange in a chat. Extract ONLY facts that clearly match a declared tracker — never guess, never invent. Estimating a number (e.g. calories from a food description) IS allowed and should be your best rough estimate.

Declared trackers:
${declarations}

Exchange:
User said: ${input.userMessage || '(nothing)'}
${input.userImageDesc ? `User sent a photo described as: ${input.userImageDesc}` : ''}
The companion replied: ${input.dhReply || '(nothing)'}

For each observation output: tracker_key, source ("user_message" | "photo_analysis" | "dh_reply" — where the fact came from), subject (entity name or null), value_json (a JSON object string with the tracker's declared fields). Output {"entries": []} when nothing matches. Respond with JSON only.`;
  try {
    const res = await utilityModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            entries: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  tracker_key: { type: 'STRING' },
                  source: { type: 'STRING' },
                  subject: { type: 'STRING' },
                  value_json: { type: 'STRING' },
                },
                required: ['tracker_key', 'source', 'value_json'],
              },
            },
          },
          required: ['entries'],
        },
      },
    });
    const txt = res.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const parsed = JSON.parse(txt);
    const byKey = new Map(input.trackers.map((t) => [t.key, t]));
    const out: TrackerEntry[] = [];
    for (const e of parsed.entries ?? []) {
      const decl = byKey.get(e.tracker_key);
      if (!decl) continue;
      let value: Record<string, unknown>;
      try {
        value = JSON.parse(e.value_json);
      } catch {
        continue;
      }
      const source = ['user_message', 'dh_reply', 'photo_analysis'].includes(e.source)
        ? e.source
        : 'user_message';
      out.push({
        tracker_key: decl.key,
        skill_key: decl.skill_key,
        subject: typeof e.subject === 'string' && e.subject.trim() ? e.subject.trim() : null,
        value,
        source,
      });
    }
    return out;
  } catch (err) {
    console.error('[dh-trackers] extractor failed (non-fatal)', err);
    return [];
  }
}

export async function recordEntries(input: {
  entries: TrackerEntry[];
  userId: string;
  dhId: string;
  sourceMessageId: string | null;
}): Promise<void> {
  if (input.entries.length === 0) return;
  const { error } = await supabase.from('tracker_entries').insert(
    input.entries.map((e) => ({
      user_id: input.userId,
      dh_user_id: input.dhId,
      skill_key: e.skill_key,
      tracker_key: e.tracker_key,
      subject: e.subject,
      value: e.value,
      source: e.source,
      source_message_id: input.sourceMessageId,
    }))
  );
  if (error) console.error('[dh-trackers] record failed', error);
}

// ── Computed context (never model arithmetic) ──────────────────────────────────
function dayKeyInTz(iso: string, timezone: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'America/Los_Angeles',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export async function renderTrackerContext(input: {
  trackers: TrackerDecl[];
  userId: string;
  dhId: string;
  timezone: string | null;
}): Promise<string | null> {
  if (input.trackers.length === 0) return null;
  const { data } = await supabase
    .from('tracker_entries')
    .select('skill_key, tracker_key, subject, value, observed_at')
    .eq('user_id', input.userId)
    .eq('dh_user_id', input.dhId)
    .in('skill_key', [...new Set(input.trackers.map((t) => t.skill_key))])
    .order('observed_at', { ascending: false })
    .limit(60);
  const entries = data ?? [];
  const today = dayKeyInTz(new Date().toISOString(), input.timezone);
  const lines: string[] = [];

  for (const t of input.trackers) {
    const mine = entries.filter((e) => e.skill_key === t.skill_key && e.tracker_key === t.key);
    switch (t.aggregate) {
      case 'sum_today': {
        const todays = mine.filter((e) => dayKeyInTz(e.observed_at, input.timezone) === today);
        const sum = todays.reduce((acc, e) => acc + (Number(e.value?.[t.value_path ?? '']) || 0), 0);
        lines.push(
          todays.length === 0
            ? `- ${t.title}: nothing logged yet today — ask about it when natural.`
            : `- ${t.title} today: ~${Math.round(sum)} (${todays.length} logged: ${todays
                .map((e) => String(e.value?.meal_type ?? e.value?.items ?? '').trim())
                .filter(Boolean)
                .join(', ')})`
        );
        break;
      }
      case 'latest': {
        if (mine[0]) lines.push(`- Last ${t.title.toLowerCase()}: ${JSON.stringify(mine[0].value)}`);
        break;
      }
      case 'latest_per_subject': {
        const seen = new Set<string>();
        const latest = mine.filter((e) => {
          const s = e.subject ?? '';
          if (!s || seen.has(s)) return false;
          seen.add(s);
          return true;
        });
        if (latest.length > 0) {
          lines.push(`- ${t.title}:`);
          for (const e of latest.slice(0, 5)) lines.push(`  · ${e.subject}: ${JSON.stringify(e.value)}`);
        }
        break;
      }
      case 'count_7d': {
        const cutoff = Date.now() - 7 * 86400_000;
        const n = mine.filter((e) => new Date(e.observed_at).getTime() > cutoff).length;
        if (n > 0) lines.push(`- ${t.title}: ${n} in the last 7 days`);
        break;
      }
      default:
        break;
    }
  }
  if (lines.length === 0) return null;
  return `<tracker_context>\nWhat you're keeping track of for him (computed — trust these numbers, never re-derive):\n${lines.join('\n')}\n</tracker_context>`;
}
