// @ts-nocheck
// Runtime tool surface for the DH agent loop.
//
//   Registry tools (`agent_tools` table, managed on /admin/tools):
//     builtin — Deno ports below (keyless public APIs + our DB, service-role)
//     http    — declarative URL template with {param} placeholders
//     js      — proxied to the Vercel tool runner (POST /api/tools/execute)
//   Local tools (context-bound, defined by the caller): send_selfie, get_my_details.
//
// `user_id`-typed params are STRIPPED from the model-visible declaration and
// injected by the harness (ctx.realUserId) — the model never guesses UUIDs.
// Every result is truncated to a hard cap and bounded by a timeout.
import { supabase, SERVICE_ROLE_KEY } from './clients.ts';

export type ToolParamSpec = {
  name: string;
  type?: string;
  description?: string;
  example?: string;
  required?: boolean;
};

export type AgentToolRow = {
  id?: string;
  name: string;
  description: string;
  input_schema: ToolParamSpec[];
  kind: 'builtin' | 'http' | 'js';
  config: Record<string, unknown>;
  enabled?: boolean;
};

export type ToolEvent = { name: string; args: Record<string, unknown>; ok: boolean; ms: number };

const RESULT_CHAR_LIMIT = 6000;
const TOOL_TIMEOUT_MS = 12_000;
const REGISTRY_TTL_MS = 5 * 60 * 1000;

const g = globalThis as any;
let registryCache: { value: AgentToolRow[]; exp: number } = g.__dhToolRegistry ?? { value: [], exp: 0 };

function withTimeout<T>(p: Promise<T>, ms = TOOL_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Tool timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function truncateResult(value: unknown): unknown {
  const s = JSON.stringify(value);
  if (s.length <= RESULT_CHAR_LIMIT) return value;
  return { truncated: true, preview: s.slice(0, RESULT_CHAR_LIMIT) };
}

/** Parse the items of an RSS feed (Google News flavor) without a DOM. */
function parseRssItems(xml: string, limit: number) {
  const items: Array<{ title: string; published?: string; source?: string }> = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/g;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null && items.length < limit) {
    const block = m[1];
    const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim();
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim();
    const source = block.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1]?.trim();
    if (title) items.push({ title, published: pubDate, source });
  }
  return items;
}

async function googleNewsSearch(query: string, limit = 8) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (AmberTools)' } });
  if (!res.ok) throw new Error(`News fetch failed: ${res.status}`);
  return parseRssItems(await res.text(), limit);
}

// Open-Meteo WMO weather codes → human phrases (the interesting subset).
const WEATHER_CODES: Record<number, string> = {
  0: 'clear sky', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
  45: 'fog', 48: 'freezing fog', 51: 'light drizzle', 53: 'drizzle',
  55: 'heavy drizzle', 61: 'light rain', 63: 'rain', 65: 'heavy rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 80: 'rain showers',
  81: 'rain showers', 82: 'violent rain showers', 95: 'thunderstorm',
  96: 'thunderstorm with hail', 99: 'thunderstorm with heavy hail',
};

// ── Builtin implementations (Deno ports of src/lib/agent-tools.ts) ────────────
const builtins: Record<string, (params: Record<string, string>) => Promise<unknown>> = {
  async get_sports_news(params) {
    const sport = params.sport?.trim();
    if (!sport) throw new Error('sport is required');
    const stories = await googleNewsSearch(`${sport} latest`, 8);
    return { sport, stories };
  },

  async get_local_news(params) {
    const location = params.location?.trim();
    if (!location) throw new Error('location is required');
    const stories = await googleNewsSearch(`${location} local news`, 8);
    return { location, stories };
  },

  async get_local_weather(params) {
    const location = params.location?.trim();
    if (!location) throw new Error('location is required');

    const geoRes = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(location)}&count=1&language=en`
    );
    if (!geoRes.ok) throw new Error(`Geocoding failed: ${geoRes.status}`);
    const geo = await geoRes.json();
    const place = geo.results?.[0];
    if (!place) throw new Error(`Could not find location "${location}"`);

    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
        `&temperature_unit=fahrenheit&timezone=auto&forecast_days=3`
    );
    if (!wxRes.ok) throw new Error(`Weather fetch failed: ${wxRes.status}`);
    const wx = await wxRes.json();

    return {
      place: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
      now: {
        temp_f: Math.round(wx.current.temperature_2m),
        feels_like_f: Math.round(wx.current.apparent_temperature),
        conditions: WEATHER_CODES[wx.current.weather_code] ?? 'unknown',
        wind_mph: Math.round(wx.current.wind_speed_10m),
      },
      next_days: wx.daily.time.map((day: string, i: number) => ({
        day,
        high_f: Math.round(wx.daily.temperature_2m_max[i]),
        low_f: Math.round(wx.daily.temperature_2m_min[i]),
        rain_chance_pct: wx.daily.precipitation_probability_max[i],
        conditions: WEATHER_CODES[wx.daily.weather_code[i]] ?? 'unknown',
      })),
    };
  },

  // One call, the full picture of who she's talking to: profile + registration
  // + his local time right now.
  async get_user_info(params) {
    const userId = params.user_id?.trim();
    if (!userId) throw new Error('user_id is required');
    const { data, error } = await supabase
      .from('users')
      .select('username, age, gender, bio, profession, education, location_name, timezone, created_at, is_digital_human, deleted_at')
      .eq('userid', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.deleted_at) throw new Error('User not found');

    const registered = data.created_at ? new Date(data.created_at) : null;
    const daysAgo = registered ? Math.floor((Date.now() - registered.getTime()) / 86_400_000) : null;

    const tz = data.timezone || 'America/Los_Angeles';
    const now = new Date();
    const localTime = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(now);
    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
    const partOfDay = h < 5 ? 'late night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';

    return {
      username: data.username,
      age: data.age,
      gender: data.gender,
      profile_description: data.bio || '(no bio)',
      profession: data.profession,
      education: data.education,
      location: data.location_name || '(no location set)',
      registered_at: data.created_at,
      registered_days_ago: daysAgo,
      local_time: localTime,
      part_of_day: partOfDay,
      timezone: tz,
      timezone_known: !!data.timezone,
      is_digital_human: !!data.is_digital_human,
    };
  },

  async get_trending_topics() {
    try {
      const res = await fetch('https://trends.google.com/trending/rss?geo=US', {
        headers: { 'User-Agent': 'Mozilla/5.0 (AmberTools)' },
      });
      if (res.ok) {
        const items = parseRssItems(await res.text(), 10);
        if (items.length > 0) {
          return { source: 'google_trends_us', topics: items.map((i) => ({ title: i.title })) };
        }
      }
    } catch {
      // fall through to headlines
    }
    const res = await fetch('https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en', {
      headers: { 'User-Agent': 'Mozilla/5.0 (AmberTools)' },
    });
    if (!res.ok) throw new Error(`Trending fetch failed: ${res.status}`);
    return { source: 'top_headlines', topics: parseRssItems(await res.text(), 10) };
  },
};

// ── Registry ───────────────────────────────────────────────────────────────────
export async function loadEnabledRegistryTools(): Promise<AgentToolRow[]> {
  if (Date.now() < registryCache.exp) return registryCache.value;
  const { data, error } = await supabase
    .from('agent_tools')
    .select('id, name, description, input_schema, kind, config, enabled')
    .eq('enabled', true);
  if (error) {
    console.error('[dh-tools] registry load failed', error);
    return registryCache.value; // stale is better than none
  }
  registryCache = { value: (data ?? []) as AgentToolRow[], exp: Date.now() + REGISTRY_TTL_MS };
  g.__dhToolRegistry = registryCache;
  return registryCache.value;
}

function isInjectedParam(spec: ToolParamSpec): boolean {
  return spec.name === 'user_id' || spec.type === 'user_id';
}

// Gemini FunctionDeclaration for a registry tool, with harness-injected params
// stripped from what the model sees.
export function declarationForRegistryTool(tool: AgentToolRow) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const spec of tool.input_schema ?? []) {
    if (isInjectedParam(spec)) continue;
    properties[spec.name] = {
      type: 'STRING',
      description: [spec.description, spec.example ? `e.g. "${spec.example}"` : '']
        .filter(Boolean)
        .join(' — '),
    };
    if (spec.required) required.push(spec.name);
  }
  return {
    name: tool.name,
    description: tool.description,
    parameters: { type: 'OBJECT', properties, ...(required.length ? { required } : {}) },
  };
}

async function runHttp(tool: AgentToolRow, params: Record<string, string>): Promise<unknown> {
  const cfg = tool.config as { url_template?: string; method?: string; headers?: Record<string, string> };
  if (!cfg.url_template) throw new Error('http tool is missing config.url_template');
  const url = cfg.url_template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const v = params[key];
    if (v === undefined) throw new Error(`Missing parameter: ${key}`);
    return encodeURIComponent(v);
  });
  const res = await fetch(url, {
    method: cfg.method ?? 'GET',
    headers: { 'User-Agent': 'AmberTools/1.0', ...(cfg.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    return { text: text.slice(0, RESULT_CHAR_LIMIT) };
  }
}

// js tools keep executing on Vercel (the admin Tools page + its sandbox live
// there); the edge function proxies with the service-role key it already holds.
async function runJsViaProxy(tool: AgentToolRow, params: Record<string, string>): Promise<unknown> {
  const appBase = Deno.env.get('APP_BASE_URL');
  if (!appBase) throw new Error('APP_BASE_URL is not configured (required for js tools)');
  const res = await fetch(`${appBase.replace(/\/$/, '')}/api/tools/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify({ name: tool.name, params }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw new Error(`Tool proxy failed: HTTP ${res.status}`);
  if (body.ok === false) throw new Error(body.error ?? 'Tool failed');
  return body.result;
}

// Execute a registry tool with harness param injection. Never throws — the
// model sees {ok:false, error} and can react in character.
export async function executeRegistryTool(
  tool: AgentToolRow,
  rawArgs: Record<string, unknown>,
  ctx: { realUserId: string }
): Promise<{ ok: boolean; result?: unknown; error?: string; ms: number }> {
  const started = Date.now();
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawArgs ?? {})) {
    if (v !== undefined && v !== null) params[k] = String(v);
  }
  for (const spec of tool.input_schema ?? []) {
    if (isInjectedParam(spec)) params[spec.name] = ctx.realUserId;
  }
  try {
    for (const spec of tool.input_schema ?? []) {
      if (spec.required && !params[spec.name]?.trim()) {
        throw new Error(`Missing required parameter: ${spec.name}`);
      }
    }
    let result: unknown;
    if (tool.kind === 'builtin') {
      const impl = builtins[tool.name];
      if (!impl) throw new Error(`No builtin implementation for "${tool.name}"`);
      result = await withTimeout(impl(params));
    } else if (tool.kind === 'http') {
      result = await withTimeout(runHttp(tool, params));
    } else {
      result = await withTimeout(runJsViaProxy(tool, params));
    }
    return { ok: true, result: truncateResult(result), ms: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      ms: Date.now() - started,
    };
  }
}
