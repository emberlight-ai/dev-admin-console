import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { parseCheckIns, parseCoachProgram, parseTrackers } from '@/lib/skill-trackers';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * GET /api/admin/skills
 * → { data: [{...skill, tool_ids, dh_count}], tools: [{id, name, is_core, enabled}] }
 * One payload for the Skills page: the skills, their authorized tools, and the
 * full tool library (for the drag tray).
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const [skillsRes, toolLinksRes, toolsRes, countsRes, trackersRes] = await Promise.all([
    supabaseAdmin.from('skills').select('*').order('sort_order'),
    supabaseAdmin.from('skill_tools').select('skill_key, tool_id'),
    supabaseAdmin.from('agent_tools').select('id, name, description, is_core, enabled').order('name'),
    supabaseAdmin.from('dh_skills').select('skill_key'),
    supabaseAdmin.from('skill_trackers').select('*').order('key'),
  ]);
  if (skillsRes.error) return jsonError(skillsRes.error.message, 500);
  if (toolLinksRes.error) return jsonError(toolLinksRes.error.message, 500);
  if (toolsRes.error) return jsonError(toolsRes.error.message, 500);
  if (countsRes.error) return jsonError(countsRes.error.message, 500);
  if (trackersRes.error) return jsonError(trackersRes.error.message, 500);

  const toolsBySkill: Record<string, string[]> = {};
  for (const l of toolLinksRes.data ?? []) {
    (toolsBySkill[l.skill_key] ??= []).push(l.tool_id);
  }
  const counts: Record<string, number> = {};
  for (const r of countsRes.data ?? []) {
    counts[r.skill_key] = (counts[r.skill_key] ?? 0) + 1;
  }
  const trackersBySkill: Record<string, unknown[]> = {};
  for (const t of trackersRes.data ?? []) {
    (trackersBySkill[t.skill_key] ??= []).push(t);
  }

  return NextResponse.json({
    data: (skillsRes.data ?? []).map((s) => ({
      ...s,
      tool_ids: toolsBySkill[s.key] ?? [],
      dh_count: counts[s.key] ?? 0,
      trackers: trackersBySkill[s.key] ?? [],
    })),
    tools: toolsRes.data ?? [],
  });
}

/**
 * POST /api/admin/skills
 * { name, key?, description?, prompt_block, opener_prompt?,
 *   check_in_slots?, check_in_prompt?, trackers?,
 *   intake_questions?, plan_prompt?, demo_checkins?, components? }
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  const b = body as Record<string, unknown>;
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  const promptBlock = typeof b.prompt_block === 'string' ? b.prompt_block.trim() : '';
  if (!name) return jsonError('name is required', 400);
  if (!promptBlock) return jsonError('prompt_block is required', 400);
  const key = typeof b.key === 'string' && b.key.trim() ? slugify(b.key) : slugify(name);
  if (!key) return jsonError('Could not derive a key', 400);

  const checkIns = parseCheckIns(b);
  if ('error' in checkIns) return jsonError(checkIns.error, 400);
  const coach = parseCoachProgram(b);
  if ('error' in coach) return jsonError(coach.error, 400);
  const trackers = 'trackers' in b ? parseTrackers(b.trackers) : { rows: [] };
  if ('error' in trackers) return jsonError(trackers.error, 400);

  const { data: maxRow } = await supabaseAdmin
    .from('skills')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabaseAdmin
    .from('skills')
    .insert({
      key,
      name,
      description: typeof b.description === 'string' ? b.description.trim() : null,
      prompt_block: promptBlock,
      opener_prompt:
        typeof b.opener_prompt === 'string' && b.opener_prompt.trim() ? b.opener_prompt.trim() : null,
      sort_order: (maxRow?.sort_order ?? 0) + 10,
      ...checkIns.patch,
      ...coach.patch,
    })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') return jsonError(`Skill "${key}" already exists`, 409);
    return jsonError(error.message, 500);
  }

  if (trackers.rows.length > 0) {
    const { error: trkErr } = await supabaseAdmin
      .from('skill_trackers')
      .insert(trackers.rows.map((t) => ({ ...t, skill_key: key })));
    if (trkErr) {
      // Roll the half-created skill back so a retry doesn't 409 on the key.
      await supabaseAdmin.from('skills').delete().eq('key', key);
      return jsonError(trkErr.message, 500);
    }
  }
  return NextResponse.json({ data });
}
