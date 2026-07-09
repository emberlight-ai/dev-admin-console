import { NextRequest, NextResponse } from 'next/server';

import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function resolveMatchSides(matchId: string) {
  const { data, error } = await supabaseAdmin
    .from('user_match_ai_state')
    .select('match_id, dh_user_id, real_user_id, intimacy_score')
    .eq('match_id', matchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * GET ?match_id — the digital human's selfie inventory for this conversation:
 * every active image with tier/caption plus whether the per-match ledger says
 * it was already sent. Feeds the admin "Send image" picker.
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  const matchId = req.nextUrl.searchParams.get('match_id');
  if (!matchId) return jsonError('Missing match_id', 400);

  try {
    const state = await resolveMatchSides(matchId);
    if (!state?.dh_user_id) return jsonError('No digital human on this match', 404);

    const [imgsRes, sentRes] = await Promise.all([
      supabaseAdmin
        .from('dh_chat_images')
        .select('id, public_url, ordinal, image_tier, caption')
        .eq('dh_user_id', state.dh_user_id)
        .eq('active', true)
        .order('ordinal', { ascending: true }),
      supabaseAdmin.from('dh_sent_images').select('image_id').eq('match_id', matchId),
    ]);
    if (imgsRes.error) return jsonError(imgsRes.error.message, 500);
    if (sentRes.error) return jsonError(sentRes.error.message, 500);

    const sentIds = new Set((sentRes.data ?? []).map((s) => s.image_id));
    return NextResponse.json({
      dh_user_id: state.dh_user_id,
      images: (imgsRes.data ?? []).map((img) => ({
        ...img,
        already_sent: sentIds.has(img.id),
      })),
    });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : 'Failed to load inventory', 500);
  }
}

/**
 * POST {match_id, image_id} — send one of the DH's preserved selfies into the
 * conversation AS the digital human. Mirrors the engine's send path: message +
 * dh_sent_images ledger row (keeps the no-repeat guarantee) + arms the selfie
 * cooldown, so a manual send and an engine send are indistinguishable downstream.
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);

  let matchId: string;
  let imageId: string;
  try {
    const body = await req.json();
    if (typeof body?.match_id !== 'string' || !body.match_id) return jsonError('match_id is required', 400);
    if (typeof body?.image_id !== 'string' || !body.image_id) return jsonError('image_id is required', 400);
    matchId = body.match_id;
    imageId = body.image_id;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  try {
    const state = await resolveMatchSides(matchId);
    if (!state?.dh_user_id || !state.real_user_id) {
      return jsonError('No digital human on this match', 404);
    }

    const { data: img, error: imgErr } = await supabaseAdmin
      .from('dh_chat_images')
      .select('id, public_url, image_tier, caption, dh_user_id, active')
      .eq('id', imageId)
      .maybeSingle();
    if (imgErr) return jsonError(imgErr.message, 500);
    if (!img || !img.active) return jsonError('Image not found or inactive', 404);
    if (img.dh_user_id !== state.dh_user_id) {
      return jsonError('Image belongs to a different digital human', 403);
    }

    const { data: msg, error: sendErr } = await supabaseAdmin.rpc('rpc_send_message', {
      match_id: matchId,
      media_url: img.public_url,
      sender_id: state.dh_user_id,
      receiver_id: state.real_user_id,
      message_intimacy_score: state.intimacy_score ?? null,
    });
    if (sendErr) return jsonError(sendErr.message, 500);

    const messageId = (msg as { id?: string } | null)?.id ?? null;
    const { error: ledgerErr } = await supabaseAdmin.from('dh_sent_images').insert({
      match_id: matchId,
      image_id: img.id,
      message_id: messageId,
    });
    // The message is out either way; a ledger failure risks a future repeat, so
    // surface it loudly instead of pretending everything is fine.
    if (ledgerErr) {
      console.error('[admin/chat/selfie] ledger insert failed (may resend later)', img.id, ledgerErr);
    }

    await supabaseAdmin
      .from('user_match_ai_state')
      .update({ last_selfie_sent_at: new Date().toISOString() })
      .eq('match_id', matchId);

    return NextResponse.json({
      message: msg,
      ledger_recorded: !ledgerErr,
      image: { id: img.id, image_tier: img.image_tier, caption: img.caption },
    });
  } catch (err: unknown) {
    return jsonError(err instanceof Error ? err.message : 'Failed to send image', 500);
  }
}
