import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { generateGeminiContent } from '@/lib/gemini';
import { supabaseAdmin } from '@/lib/supabase';
import { withLogging } from '@/lib/with-logging';

export const runtime = 'nodejs';

/**
 * POST /api/ios/coach/scan-meal   { match_id, media_url }
 *
 * The meal scanner in one round trip. Analyses the photo and writes ONE
 * message row that holds BOTH the photo and everything extracted from it:
 *
 *   type    = 'component'
 *   content = {"component":"nutrition_result", props:{ photo_url, meal,
 *              calories, protein_g, carbs_g, fat_g, note }}
 *
 * The photo rides in `props.photo_url`, NOT the `media_url` column, on
 * purpose: rpc_locked_received_image_ids counts any received row with a
 * media_url toward the paywalled daily image allowance regardless of type, so
 * a nutrition card would silently burn a free user's photo for the day.
 * Everything still lives in one row — `content->'props'->>'photo_url'` sits
 * right next to the macros.
 *
 * Keeping them together is the point: a later query over
 * `type = 'component'` can reconstruct the whole meal log — picture and
 * macros — without stitching adjacent rows back together by timestamp.
 *
 * The photo is validated as food FIRST. A mouse, a desk or a selfie gets a
 * short in-character reply from the coach instead of invented macros.
 */

type Analysis = {
  is_food: boolean;
  meal?: string | null;
  calories?: number | null;
  protein_g?: number | null;
  carbs_g?: number | null;
  fat_g?: number | null;
  note?: string | null;
  /** What the model sees when it is NOT food — drives the coach's reply. */
  subject?: string | null;
};

const VISION_PROMPT = `You are a nutrition estimator for a health-coaching app.

STEP 1 — Decide whether the image actually shows FOOD or a DRINK intended for a person to consume.
Anything else (a computer mouse, keyboard, desk, phone, pet, person, screenshot, landscape, packaging with no visible food) is NOT food.
Be strict: if you cannot clearly identify something edible in the frame, it is NOT food.

STEP 2 — Reply with ONLY a JSON object, no markdown fence, no prose.

If it IS food:
{"is_food": true, "meal": "<short dish name, max 5 words>", "calories": <int>, "protein_g": <int>, "carbs_g": <int>, "fat_g": <int>, "note": "<one short encouraging coaching line about this meal>"}
Estimate for the portion actually visible. Be realistic, not round numbers.

If it is NOT food:
{"is_food": false, "subject": "<2-4 words naming what you actually see>"}`;

function parseAnalysis(raw: string): Analysis | null {
  // Models like to wrap JSON in fences despite instructions.
  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    if (typeof parsed?.is_food !== 'boolean') return null;
    return parsed as Analysis;
  } catch {
    return null;
  }
}

function intOr(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
}

async function handlePOST(req: NextRequest) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const token = authHeader.split(' ')[1] ?? '';
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { match_id?: string; media_url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const matchId = body.match_id?.trim();
  const mediaUrl = body.media_url?.trim();
  if (!matchId || !mediaUrl) {
    return NextResponse.json({ error: 'match_id and media_url are required' }, { status: 400 });
  }

  // We fetch this URL server-side, so it must be one of ours — otherwise the
  // endpoint is an SSRF lever pointed at anything the server can reach.
  const storagePrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/`;
  if (!mediaUrl.startsWith(storagePrefix)) {
    return NextResponse.json({ error: 'media_url must be an uploaded image' }, { status: 400 });
  }

  // The caller must be a participant, and the coach is the other side.
  const { data: match } = await supabaseAdmin
    .from('user_matches')
    .select('user_a, user_b')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return NextResponse.json({ error: 'Match not found' }, { status: 404 });
  if (match.user_a !== user.id && match.user_b !== user.id) {
    return NextResponse.json({ error: 'Not your conversation' }, { status: 403 });
  }
  const coachId = match.user_a === user.id ? match.user_b : match.user_a;

  // ── Vision ────────────────────────────────────────────────────────────────
  let analysis: Analysis | null = null;
  try {
    const imageRes = await fetch(mediaUrl);
    if (!imageRes.ok) throw new Error(`image fetch ${imageRes.status}`);
    const bytes = Buffer.from(await imageRes.arrayBuffer());
    const mimeType = imageRes.headers.get('content-type') ?? 'image/jpeg';

    const raw = await generateGeminiContent(
      [
        VISION_PROMPT,
        { inlineData: { data: bytes.toString('base64'), mimeType } },
      ],
      'gemini-2.5-flash'
    );
    analysis = parseAnalysis(raw);
  } catch (err) {
    console.error('[scan-meal] vision failed', err);
  }

  // ── Not food (or analysis unavailable): a short human reply, no fake macros ──
  if (!analysis || analysis.is_food !== true) {
    const subject = analysis?.subject?.trim().toLowerCase();
    const content = subject
      ? `That looks like ${subject} 😄 send me the actual plate and I'll break it down for you.`
      : `I couldn't tell what's on that plate — try a clearer shot of the food and I'll break it down.`;

    const { error } = await supabaseAdmin.from('messages').insert({
      match_id: matchId,
      sender_id: coachId,
      receiver_id: user.id,
      content,
      type: 'text',
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, is_food: false, subject: subject ?? null });
  }

  // ── Food: one row carrying the photo AND the extracted nutrition ──────────
  const props = {
    meal: (analysis.meal ?? 'Your meal').toString().trim().slice(0, 100),
    calories: intOr(analysis.calories, 0),
    protein_g: intOr(analysis.protein_g, 0),
    carbs_g: intOr(analysis.carbs_g, 0),
    fat_g: intOr(analysis.fat_g, 0),
    ...(analysis.note ? { note: analysis.note.toString().trim().slice(0, 240) } : {}),
    // The scanned photo lives with its own analysis — one row, one object.
    photo_url: mediaUrl,
  };

  const payload = {
    component: 'nutrition_result',
    v: 1,
    text: `🍽️ ${props.meal} · ${props.calories} kcal`,
    props,
  };

  const { data: inserted, error } = await supabaseAdmin
    .from('messages')
    .insert({
      match_id: matchId,
      sender_id: coachId,
      receiver_id: user.id,
      content: JSON.stringify(payload),
      type: 'component',
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, is_food: true, id: inserted.id, payload });
}

export const POST = withLogging(handlePOST);
