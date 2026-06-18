import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const GREEN_MODE_KEY = 'green_mode_personalities';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizePersonality(value: unknown) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePersonalities(value: string | null | undefined) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const personalities: string[] = [];
    for (const item of parsed) {
      const personality = normalizePersonality(item);
      if (!personality) continue;
      const key = personality.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      personalities.push(personality);
    }
    return personalities;
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const { data: configRow, error: configError } = await supabaseAdmin
    .from('digital_human_config')
    .select('value')
    .eq('key', GREEN_MODE_KEY)
    .maybeSingle();
  if (configError) return jsonError(configError.message, 500);

  const { data: rows, error: personalitiesError } = await supabaseAdmin
    .from('users')
    .select('personality')
    .eq('is_digital_human', true)
    .is('deleted_at', null)
    .not('personality', 'is', null)
    .order('personality', { ascending: true });
  if (personalitiesError) return jsonError(personalitiesError.message, 500);

  const seen = new Set<string>();
  const availablePersonalities: string[] = [];
  for (const row of rows ?? []) {
    const personality = normalizePersonality((row as { personality?: unknown }).personality);
    if (!personality) continue;
    const key = personality.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    availablePersonalities.push(personality);
  }

  return NextResponse.json({
    data: {
      personalities: parsePersonalities(configRow?.value),
      availablePersonalities,
    },
  });
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const rawPersonalities =
    body && typeof body === 'object' && Array.isArray((body as { personalities?: unknown }).personalities)
      ? (body as { personalities: unknown[] }).personalities
      : [];

  const seen = new Set<string>();
  const personalities: string[] = [];
  for (const item of rawPersonalities) {
    const personality = normalizePersonality(item);
    if (!personality) continue;
    const key = personality.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    personalities.push(personality);
  }

  const { error } = await supabaseAdmin
    .from('digital_human_config')
    .upsert(
      {
        key: GREEN_MODE_KEY,
        value: JSON.stringify(personalities),
        description:
          'When non-empty, matching feed candidates are limited to these personalities.',
      },
      { onConflict: 'key' }
    );
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ success: true, data: { personalities } });
}
