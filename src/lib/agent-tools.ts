import { supabaseAdmin } from '@/lib/supabase';

/**
 * Agent tools — the execution engine behind the /admin/tools registry.
 *
 * A tool is a row in `agent_tools`; this module knows how to run each kind:
 *   builtin — native implementations below (keyless public APIs + our DB)
 *   http    — declarative URL template with {param} placeholders
 *   js      — stored JavaScript body compiled as async (params, ctx) => result
 *
 * Every result is plain JSON meant to be READ BY AN LLM (a digital human
 * composing conversation), so implementations favor short, information-dense
 * shapes over exhaustive payloads, and everything is truncated defensively.
 */

export type ToolParamSpec = {
  name: string;
  type?: string;
  description?: string;
  example?: string;
  required?: boolean;
};

export type AgentTool = {
  id?: string;
  name: string;
  description: string;
  input_schema: ToolParamSpec[];
  kind: 'builtin' | 'http' | 'js';
  config: Record<string, unknown>;
  enabled?: boolean;
};

export type ToolRunResult = {
  ok: boolean;
  result?: unknown;
  error?: string;
  ms: number;
};

const RESULT_CHAR_LIMIT = 6000;
const TOOL_TIMEOUT_MS = 12_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Builtins ──────────────────────────────────────────────────────────────────

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
    const geo = (await geoRes.json()) as {
      results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country?: string }>;
    };
    const place = geo.results?.[0];
    if (!place) throw new Error(`Could not find location "${location}"`);

    const wxRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
        `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
        `&temperature_unit=fahrenheit&timezone=auto&forecast_days=3`
    );
    if (!wxRes.ok) throw new Error(`Weather fetch failed: ${wxRes.status}`);
    const wx = (await wxRes.json()) as {
      current: { temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
      daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; weather_code: number[] };
    };

    return {
      place: [place.name, place.admin1, place.country].filter(Boolean).join(', '),
      now: {
        temp_f: Math.round(wx.current.temperature_2m),
        feels_like_f: Math.round(wx.current.apparent_temperature),
        conditions: WEATHER_CODES[wx.current.weather_code] ?? 'unknown',
        wind_mph: Math.round(wx.current.wind_speed_10m),
      },
      next_days: wx.daily.time.map((day, i) => ({
        day,
        high_f: Math.round(wx.daily.temperature_2m_max[i]),
        low_f: Math.round(wx.daily.temperature_2m_min[i]),
        rain_chance_pct: wx.daily.precipitation_probability_max[i],
        conditions: WEATHER_CODES[wx.daily.weather_code[i]] ?? 'unknown',
      })),
    };
  },

  async read_user_profile(params) {
    const userId = params.user_id?.trim();
    if (!userId) throw new Error('user_id is required');
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('username, age, gender, bio, profession, education, location_name, timezone, created_at, is_digital_human, deleted_at')
      .eq('userid', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data || data.deleted_at) throw new Error('User not found');

    const registered = data.created_at ? new Date(data.created_at) : null;
    const daysAgo = registered ? Math.floor((Date.now() - registered.getTime()) / 86_400_000) : null;
    return {
      username: data.username,
      age: data.age,
      gender: data.gender,
      profile_description: data.bio || '(no bio)',
      profession: data.profession,
      education: data.education,
      location: data.location_name || '(no location set)',
      timezone: data.timezone,
      registered_at: data.created_at,
      registered_days_ago: daysAgo,
      is_digital_human: !!data.is_digital_human,
    };
  },

  async get_trending_topics() {
    const res = await fetch('https://www.reddit.com/r/popular/top.json?limit=10&t=day', {
      headers: { 'User-Agent': 'AmberTools/1.0' },
    });
    if (!res.ok) throw new Error(`Trending fetch failed: ${res.status}`);
    const json = (await res.json()) as {
      data?: { children?: Array<{ data?: { title?: string; subreddit?: string; ups?: number } }> };
    };
    return {
      topics: (json.data?.children ?? [])
        .map((c) => ({ title: c.data?.title, community: c.data?.subreddit, upvotes: c.data?.ups }))
        .filter((t) => t.title),
    };
  },

  async get_user_local_time(params) {
    const userId = params.user_id?.trim();
    if (!userId) throw new Error('user_id is required');
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('username, timezone')
      .eq('userid', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new Error('User not found');
    const tz = data.timezone || 'America/Los_Angeles';
    const now = new Date();
    const local = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
    }).format(now);
    const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
    const partOfDay = h < 5 ? 'late night' : h < 12 ? 'morning' : h < 17 ? 'afternoon' : h < 21 ? 'evening' : 'night';
    return { username: data.username, timezone: tz, local_time: local, part_of_day: partOfDay, timezone_known: !!data.timezone };
  },
};

// ── Kind runners ──────────────────────────────────────────────────────────────

async function runHttp(tool: AgentTool, params: Record<string, string>): Promise<unknown> {
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

async function runJs(tool: AgentTool, params: Record<string, string>): Promise<unknown> {
  const cfg = tool.config as { code?: string };
  if (!cfg.code) throw new Error('js tool is missing config.code');
  // The stored code is the BODY of: async (params, ctx) => { <code> }
  // ctx deliberately exposes fetch only — no process, no env, no DB handle.
  // This is an admin-only surface (tools are created by operators, not users),
  // but we still keep the blast radius small.
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (params: Record<string, string>, ctx: { fetch: typeof fetch }) => Promise<unknown>;
  const fn = new AsyncFunction('params', 'ctx', cfg.code);
  return fn(params, { fetch });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function loadTool(name: string): Promise<AgentTool | null> {
  const { data } = await supabaseAdmin
    .from('agent_tools')
    .select('id, name, description, input_schema, kind, config, enabled')
    .eq('name', name)
    .maybeSingle();
  return (data as AgentTool | null) ?? null;
}

/** Run a tool definition (saved or draft) against params. Never throws. */
export async function executeTool(tool: AgentTool, rawParams: Record<string, unknown>): Promise<ToolRunResult> {
  const started = Date.now();
  const params: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawParams ?? {})) {
    if (v !== undefined && v !== null) params[k] = String(v);
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
      result = await withTimeout(runJs(tool, params));
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

export const BUILTIN_NAMES = Object.keys(builtins);
