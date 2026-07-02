import { NextRequest, NextResponse } from 'next/server';

import { executeTool, loadTool } from '@/lib/agent-tools';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST — the AGENT-facing tool endpoint. Digital-human edge functions (Supabase)
 * call this with the service-role key they already hold:
 *
 *   fetch(`${APP_URL}/api/tools/execute`, {
 *     method: 'POST',
 *     headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
 *     body: JSON.stringify({ name: 'get_local_weather', params: { location: 'San Jose' } }),
 *   })
 *
 * Draft execution is deliberately NOT supported here — agents may only run
 * saved, enabled tools.
 */
export async function POST(req: NextRequest) {
  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!expected || token !== expected) return jsonError('Unauthorized', 401);

  try {
    const body = await req.json();
    if (typeof body.name !== 'string') return jsonError('name is required', 400);
    const tool = await loadTool(body.name);
    if (!tool) return jsonError(`No tool named "${body.name}"`, 404);
    if (tool.enabled === false) return jsonError(`Tool "${body.name}" is disabled`, 403);

    const run = await executeTool(tool, (body.params ?? {}) as Record<string, unknown>);
    return NextResponse.json(run);
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : 'Invalid request', 400);
  }
}
