import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';
import { BUILTIN_NAMES, type ToolParamSpec } from '@/lib/agent-tools';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const NAME_RE = /^[a-z][a-z0-9_]{2,49}$/;

function validateToolInput(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!NAME_RE.test(name)) {
    throw new Error('name must be snake_case (lowercase letters, digits, underscores; 3-50 chars)');
  }
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) throw new Error('description is required');

  const kind = body.kind;
  if (kind !== 'http' && kind !== 'js' && kind !== 'builtin') {
    throw new Error('kind must be "http" or "js"');
  }
  if (kind === 'builtin' && !BUILTIN_NAMES.includes(name)) {
    throw new Error(`"${name}" has no builtin implementation`);
  }

  const schema = Array.isArray(body.input_schema) ? (body.input_schema as ToolParamSpec[]) : [];
  for (const p of schema) {
    if (!p?.name || typeof p.name !== 'string') throw new Error('every parameter needs a name');
  }

  const config = (body.config && typeof body.config === 'object' ? body.config : {}) as Record<string, unknown>;
  if (kind === 'http' && typeof config.url_template !== 'string') {
    throw new Error('http tools need config.url_template');
  }
  if (kind === 'js' && typeof config.code !== 'string') {
    throw new Error('js tools need config.code');
  }

  return { name, description, kind, input_schema: schema, config };
}

// GET — full registry for the Tools page.
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { data, error } = await supabaseAdmin
    .from('agent_tools')
    .select('*')
    .order('created_at');
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ tools: data ?? [] });
}

// POST — create a tool (from the Add Tool dialog).
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  try {
    const body = await req.json();
    const tool = validateToolInput(body);
    const { data, error } = await supabaseAdmin
      .from('agent_tools')
      .insert(tool)
      .select('*')
      .single();
    if (error) {
      return jsonError(
        error.code === '23505' ? `A tool named "${tool.name}" already exists` : error.message,
        400
      );
    }
    return NextResponse.json({ tool: data });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : 'Invalid request', 400);
  }
}
