import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { executeTool, loadTool, type AgentTool } from '@/lib/agent-tools';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST — run a tool from the admin console (test drawer + test-before-save).
 * Accepts either:
 *   { name, params }  — run a SAVED tool by name
 *   { tool, params }  — run an UNSAVED draft (the Add Tool dialog's Test run)
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  try {
    const body = await req.json();
    const params = (body.params ?? {}) as Record<string, unknown>;

    let tool: AgentTool | null = null;
    if (body.tool && typeof body.tool === 'object') {
      tool = body.tool as AgentTool;
    } else if (typeof body.name === 'string') {
      tool = await loadTool(body.name);
      if (!tool) return jsonError(`No tool named "${body.name}"`, 404);
    } else {
      return jsonError('Provide "name" (saved tool) or "tool" (draft)', 400);
    }

    const run = await executeTool(tool, params);
    return NextResponse.json(run);
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : 'Invalid request', 400);
  }
}
