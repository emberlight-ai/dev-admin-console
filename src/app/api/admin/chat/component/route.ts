import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

/**
 * Send a coach component message on behalf of the digital human.
 *
 * `rpc_send_message` has no `type` parameter, so component rows go in as a
 * direct service-role insert (the same shape rpc_send_gift uses). The AFTER
 * INSERT triggers, Realtime and the iOS inbox all fire normally.
 *
 * Props are validated per component so a hand-sent card can never reach the
 * app in a shape its native decoder rejects — mirroring the server-side
 * normalization in supabase/functions/_shared/coach.ts.
 */

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function int(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
}

function str(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
}

function strList(value: unknown, max: number, cap: number): string[] {
  return Array.isArray(value)
    ? value
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim().slice(0, max))
        .slice(0, cap)
    : [];
}

/** Returns normalized props, or an error message. */
function normalize(component: string, raw: Record<string, unknown>):
  | { props: Record<string, unknown> }
  | { error: string } {
  switch (component) {
    case 'caffeine_window': {
      const times = ['wake', 'sleep', 'window_start', 'window_end'] as const;
      const props: Record<string, unknown> = {};
      for (const key of times) {
        const v = raw[key];
        if (typeof v !== 'string' || !HHMM.test(v.trim())) {
          return { error: `${key} must be a 24-hour HH:mm time` };
        }
        props[key] = v.trim();
      }
      const title = str(raw.title, 100);
      if (title) props.title = title;
      const inBody = int(raw.in_body_mg);
      const consumed = int(raw.consumed_mg);
      if (inBody !== null) props.in_body_mg = inBody;
      if (consumed !== null) props.consumed_mg = consumed;
      const meals = strList(raw.meal_schedule, 80, 4);
      if (meals.length) props.meal_schedule = meals;
      return { props };
    }
    case 'lux_meter': {
      const props: Record<string, unknown> = {};
      const title = str(raw.title, 100);
      const subtitle = str(raw.subtitle, 160);
      if (title) props.title = title;
      if (subtitle) props.subtitle = subtitle;
      return { props };
    }
    case 'nutrition_scan': {
      const props: Record<string, unknown> = {};
      const title = str(raw.title, 100);
      if (title) props.title = title;
      for (const key of ['calories_target', 'protein_target_g', 'calories_today', 'protein_today_g']) {
        const v = int(raw[key]);
        if (v !== null) props[key] = v;
      }
      return { props };
    }
    case 'nutrition_result': {
      const meal = str(raw.meal, 100);
      const calories = int(raw.calories);
      const protein = int(raw.protein_g);
      if (!meal) return { error: 'meal is required' };
      if (calories === null) return { error: 'calories is required' };
      if (protein === null) return { error: 'protein_g is required' };
      const props: Record<string, unknown> = { meal, calories, protein_g: protein };
      const carbs = int(raw.carbs_g);
      const fat = int(raw.fat_g);
      if (carbs !== null) props.carbs_g = carbs;
      if (fat !== null) props.fat_g = fat;
      const note = str(raw.note, 240);
      if (note) props.note = note;
      return { props };
    }
    case 'coach_plan': {
      const goal = str(raw.goal, 240);
      const focus = strList(raw.focus, 160, 5);
      if (!goal) return { error: 'goal is required' };
      if (focus.length === 0) return { error: 'at least one focus item is required' };
      const props: Record<string, unknown> = { goal, focus };
      const title = str(raw.title, 100);
      const cadence = str(raw.cadence, 120);
      if (title) props.title = title;
      if (cadence) props.cadence = cadence;
      return { props };
    }
    default:
      return { error: `Unknown component "${component}"` };
  }
}

/** POST { match_id, component, text?, props } */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const matchId = str(b.match_id, 64);
  const component = str(b.component, 64);
  if (!matchId) return jsonError('match_id is required', 400);
  if (!component) return jsonError('component is required', 400);

  const rawProps =
    b.props && typeof b.props === 'object' && !Array.isArray(b.props)
      ? (b.props as Record<string, unknown>)
      : {};
  const normalized = normalize(component, rawProps);
  if ('error' in normalized) return jsonError(normalized.error, 400);

  // The DH is the sender; the real user receives.
  const { data: state, error: stateErr } = await supabaseAdmin
    .from('user_match_ai_state')
    .select('dh_user_id, real_user_id')
    .eq('match_id', matchId)
    .maybeSingle();
  if (stateErr) return jsonError(stateErr.message, 500);
  if (!state?.dh_user_id || !state?.real_user_id) {
    return jsonError('No digital human on this match', 404);
  }

  const payload = {
    component,
    v: 1,
    text: str(b.text, 180) ?? '',
    props: normalized.props,
  };

  const { data, error } = await supabaseAdmin
    .from('messages')
    .insert({
      match_id: matchId,
      sender_id: state.dh_user_id,
      receiver_id: state.real_user_id,
      content: JSON.stringify(payload),
      type: 'component',
    })
    .select('id')
    .single();
  if (error) return jsonError(error.message, 500);

  return NextResponse.json({ ok: true, id: data.id, payload });
}
