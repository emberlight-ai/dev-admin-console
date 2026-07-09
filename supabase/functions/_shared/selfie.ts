// @ts-nocheck
// The selfie system, now behind a tool the MODEL calls. The executor enforces
// policy and can refuse with a reason — that observability (the model SEES the
// refusal or the sent caption) is what fixes promise-then-ghost and photos out
// of nowhere. Reuses the ledger, tier fallback chain, and caption backfill.
import { encodeBase64 } from 'jsr:@std/encoding@1/base64';
import { supabase, utilityModel } from './clients.ts';
import { sendMessageWithOptionalIntimacy } from './pacing.ts';
import type { SelfieConfig } from './store.ts';
import type { IntimacyResult } from './critic.ts';

export type ImageTier = 'casual' | 'tease' | 'reward';

export const IMAGE_TIER_RANK: Record<ImageTier, number> = {
  casual: 0,
  tease: 1,
  reward: 2,
};

export function tierForIntimacy(
  intimacy: number,
  cfg: { teaseThreshold: number; rewardThreshold: number }
): ImageTier {
  if (intimacy >= cfg.rewardThreshold) return 'reward';
  if (intimacy >= cfg.teaseThreshold) return 'tease';
  return 'casual';
}

type DhSelfie = {
  id: string;
  public_url: string;
  ordinal: number;
  image_tier: ImageTier | 'unspecified';
  caption: string | null;
};

// Lowest-ordinal unsent selfie for the target tier, FALLING BACK down the
// ladder (and finally to 'unspecified') when the target tier is exhausted. We
// never fall UP the ladder: a casual moment doesn't get a reward-tier photo.
export async function pickUnsentSelfie(
  dhId: string,
  matchId: string,
  tier: ImageTier
): Promise<DhSelfie | null> {
  const { data: imgs } = await supabase
    .from('dh_chat_images')
    .select('id, public_url, ordinal, image_tier, caption')
    .eq('dh_user_id', dhId)
    .eq('active', true)
    .order('ordinal', { ascending: true });
  if (!imgs || imgs.length === 0) return null;
  const { data: sent } = await supabase
    .from('dh_sent_images')
    .select('image_id')
    .eq('match_id', matchId);
  const sentIds = new Set((sent ?? []).map((s: { image_id: string }) => s.image_id));

  const fallbackChain: Array<ImageTier | 'unspecified'> =
    tier === 'reward'
      ? ['reward', 'tease', 'casual', 'unspecified']
      : tier === 'tease'
        ? ['tease', 'casual', 'unspecified']
        : ['casual', 'unspecified'];

  const pool = imgs as DhSelfie[];
  for (const t of fallbackChain) {
    const hit = pool.find((img) => img.image_tier === t && !sentIds.has(img.id));
    if (hit) return hit;
  }
  return null;
}

export async function countActiveSelfies(dhId: string): Promise<number> {
  const { count } = await supabase
    .from('dh_chat_images')
    .select('id', { count: 'exact', head: true })
    .eq('dh_user_id', dhId)
    .eq('active', true);
  return count ?? 0;
}

export async function getHighestSentSelfieTier(matchId: string): Promise<ImageTier | null> {
  const { data: sent } = await supabase
    .from('dh_sent_images')
    .select('image_id')
    .eq('match_id', matchId);
  const imageIds = Array.from(
    new Set((sent ?? []).map((s: { image_id?: string | null }) => s.image_id).filter(Boolean))
  ) as string[];
  if (imageIds.length === 0) return null;

  const { data: imgs } = await supabase
    .from('dh_chat_images')
    .select('id, image_tier')
    .in('id', imageIds);

  let highest: ImageTier | null = null;
  for (const img of imgs ?? []) {
    const tier = (img as { image_tier?: string | null }).image_tier;
    if (tier !== 'casual' && tier !== 'tease' && tier !== 'reward') continue;
    if (!highest || IMAGE_TIER_RANK[tier] > IMAGE_TIER_RANK[highest]) highest = tier;
  }
  return highest;
}

// One-time caption backfill: the first time a photo goes out, describe it with
// the vision model and store the caption, so the DH "remembers" what she
// shared. Best-effort.
export async function captionDhImageIfNeeded(imageId: string, publicUrl: string, existing: string | null): Promise<string | null> {
  if (existing && existing.trim().length > 0) return existing;
  try {
    const res = await fetch(publicUrl);
    if (!res.ok) return null;
    const base64Data = encodeBase64(new Uint8Array(await res.arrayBuffer()));
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    const out = await utilityModel.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          { text: 'This is a photo a woman shares in a dating-app chat. Describe it in ONE short sentence from her perspective (what she is wearing/doing/where), so she can refer to it later. No preamble.' },
        ],
      }],
    });
    const caption =
      out.response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ??
      out.response?.text?.()?.trim() ?? '';
    if (caption) {
      await supabase.from('dh_chat_images').update({ caption }).eq('id', imageId);
      return caption;
    }
    return null;
  } catch (err) {
    console.error('[dh-selfie] caption backfill failed (non-fatal)', imageId, err);
    return null;
  }
}

export type SelfieAttempt =
  | { sent: true; tier: ImageTier | 'unspecified'; caption: string | null; sentAt: string }
  | { sent: false; reason: 'selfies_disabled' | 'cooldown' | 'tier_locked' | 'no_photo_available' | 'send_failed' };

// Policy-enforcing executor for the send_selfie tool. The model asks; the
// harness decides. On success the image goes out IMMEDIATELY (before the text
// bubbles land, like a real person sending a pic mid-thought) and the model
// receives {sent, caption} so it can weave the photo into its reply.
export async function trySendSelfie(input: {
  dhId: string;
  matchId: string;
  requestedTier: ImageTier;
  userSentImage: boolean;       // reciprocation cue, known without the critic
  selfieCfg: SelfieConfig;
  lastSelfieSentAt: string | null;
  criticPromise: Promise<IntimacyResult | null>;
  fallbackIntimacy: number | null;
}): Promise<SelfieAttempt> {
  const cfg = input.selfieCfg;
  if (!cfg.enabled) return { sent: false, reason: 'selfies_disabled' };

  // Intimacy tier ceiling + photo-request signal from the referee (await the
  // in-flight critic; latency is max not sum since it started long ago).
  const critic = await input.criticPromise;
  const intimacy = critic?.intimacy ?? input.fallbackIntimacy;

  // Anti-spam pacing: a strong cue (he asked / he sent a photo of his own)
  // only needs the short gap; spontaneous sends pace by the longer cooldown.
  const strongCue =
    (input.userSentImage && cfg.reciprocateOnUserImage) || !!critic?.userRequestedPhoto;
  const lastMs = input.lastSelfieSentAt ? new Date(input.lastSelfieSentAt).getTime() : 0;
  const requiredGapMs = (strongCue ? cfg.reciprocateGapMinutes : cfg.cooldownMinutes) * 60_000;
  if (lastMs && Date.now() - lastMs < requiredGapMs) {
    return { sent: false, reason: 'cooldown' };
  }
  const ceiling: ImageTier = intimacy == null ? 'casual' : tierForIntimacy(intimacy, cfg);
  let tier: ImageTier = input.requestedTier;
  if (IMAGE_TIER_RANK[tier] > IMAGE_TIER_RANK[ceiling]) tier = ceiling;

  // Tier never downgrades: once he has seen tease, casual would feel off.
  const highestSent = await getHighestSentSelfieTier(input.matchId);
  if (highestSent && IMAGE_TIER_RANK[tier] < IMAGE_TIER_RANK[highestSent]) {
    if (IMAGE_TIER_RANK[highestSent] <= IMAGE_TIER_RANK[ceiling]) {
      tier = highestSent;
    } else {
      return { sent: false, reason: 'tier_locked' };
    }
  }

  const selfie = await pickUnsentSelfie(input.dhId, input.matchId, tier);
  if (!selfie) return { sent: false, reason: 'no_photo_available' };

  const { data: imgMsg, error: imgErr } = await sendMessageWithOptionalIntimacy({
    matchId: input.matchId,
    mediaUrl: selfie.public_url,
    senderId: input.dhId,
    intimacyScore: intimacy,
  });
  if (imgErr) {
    console.error('[dh-selfie] selfie send failed', imgErr);
    return { sent: false, reason: 'send_failed' };
  }

  const sentAt = new Date().toISOString();
  // Record it in the per-match ledger so it's never resent. A silent failure
  // here is the one thing that breaks the no-repeat guarantee, so log loudly.
  const { error: ledgerErr } = await supabase.from('dh_sent_images').insert({
    match_id: input.matchId,
    image_id: selfie.id,
    message_id: (imgMsg as { id?: string } | null)?.id ?? null,
  });
  if (ledgerErr) {
    console.error('[dh-selfie] Failed to record selfie in dh_sent_images (may resend)', selfie.id, ledgerErr);
  }

  // Caption synchronously if missing — the model needs it NOW to reference the
  // photo in its reply text (that's the whole point of the tool result).
  const caption = await captionDhImageIfNeeded(selfie.id, selfie.public_url, selfie.caption);
  console.log('[dh-selfie] Sent selfie', selfie.id, 'ordinal', selfie.ordinal, 'tier', selfie.image_tier, 'to match', input.matchId);
  return { sent: true, tier: selfie.image_tier, caption, sentAt };
}
