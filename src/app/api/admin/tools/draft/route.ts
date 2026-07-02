import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { generateGeminiContent } from '@/lib/gemini';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const DRAFT_PROMPT = `You design tools for an AI-companion dating app. A tool gives digital humans fresh, real information to talk about. The operator describes what they want; you produce a complete tool definition as JSON.

A tool definition:
{
  "name": "snake_case_name",
  "description": "One or two sentences: what it returns and when a digital human should use it.",
  "kind": "http" | "js",
  "input_schema": [{"name":"param_name","type":"string","description":"...","example":"...","required":true}],
  "config": { ... }
}

Rules for choosing kind:
- "http" when ONE public GET request does the job. config = {"url_template": "https://...{param}...", "method": "GET"} — {param} placeholders are URL-encoded automatically. Prefer keyless public APIs (open-meteo.com, news.google.com/rss/search?q={q}&hl=en-US&gl=US&ceid=US:en, reddit .json endpoints, wttr.in).
- "js" when you need multiple requests, parsing, or shaping. config = {"code": "..."} where code is the BODY of: async (params, ctx) => { ... } — use ctx.fetch for requests, return a small JSON object. No imports, no process/env access. Keep results short and information-dense (they are read by an LLM composing chat messages).

Never invent API keys — only keyless public endpoints. If the request truly needs a paid/keyed API, still produce the tool but add a "note" field explaining what key is needed and where to put it (config.headers).

Operator's request:
<<REQUEST>>

Respond with ONLY the JSON object, no markdown fences.`;

// POST — { description } → a draft tool definition the operator can review/edit.
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  try {
    const body = await req.json();
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    if (!description) return jsonError('description is required', 400);

    const raw = await generateGeminiContent(
      DRAFT_PROMPT.replace('<<REQUEST>>', description),
      'gemini-3-pro-preview'
    );

    // Tolerate accidental markdown fences.
    const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    let draft: Record<string, unknown>;
    try {
      draft = JSON.parse(jsonText);
    } catch {
      return jsonError('The model returned an unparseable draft — try rephrasing the description', 502);
    }
    return NextResponse.json({ draft });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : 'Draft generation failed', 500);
  }
}
