// @ts-nocheck
// The intimacy referee: a separate cheap call, kept apart from reply generation
// so the actor can't game its own score. Referee ONLY — the L5 "director" mode
// (beat plans, engagement, bubble counts) is gone; the texting brief + hard
// caps govern reply shape now.
import { supabase, utilityModel } from './clients.ts';
import type { IntimacyWarmupRate } from './store.ts';

export interface IntimacyResult {
  intimacy: number;            // 0-100 current closeness from the user's side
  selfieAppropriate: boolean;  // would sharing a personal selfie feel natural now?
  userRequestedPhoto: boolean; // did the user explicitly ask to see them / a pic?
}

export function normalizeIntimacyScore(raw: unknown) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const score = n > 0 && n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, score));
}

function warmupGuidance(rate: IntimacyWarmupRate) {
  switch (rate) {
    case 'very_low':
      return 'VERY LOW: be very conservative. If the user is warming up, usually raise intimacy by 0-2 points from the previous score; use 3-4 only for unusually clear romantic/sexual interest.';
    case 'low':
      return 'LOW: be conservative. If the user is warming up, usually raise intimacy by 0-4 points from the previous score; use 5-8 only for unusually clear romantic/sexual interest.';
    case 'high':
      return 'HIGH: be responsive. If the user is warming up, usually raise intimacy by 5-12 points from the previous score; use 13-18 only for strong, explicit interest.';
    case 'very_high':
      return 'VERY HIGH: warm up quickly but stay evidence-based. If the user is warming up, usually raise intimacy by 8-18 points from the previous score; use 19-25 only for very strong, explicit interest.';
    case 'extreme':
      return 'EXTREME: warm up very quickly, but still do not ignore the user signal. If the user is warming up, usually raise intimacy by 12-25 points from the previous score; use 26-35 only for very explicit, sustained interest. Never jump straight to 100 from a cold conversation.';
    case 'normal':
    default:
      return 'NORMAL: be balanced. If the user is warming up, usually raise intimacy by 2-8 points from the previous score; use 9-12 only for clear romantic/sexual interest.';
  }
}

export async function scoreIntimacy(
  systemText: string,
  transcript: string,
  previousScore: number | null,
  warmupRate: IntimacyWarmupRate
): Promise<IntimacyResult | null> {
  try {
    const previous = previousScore == null ? 'unknown' : String(normalizeIntimacyScore(previousScore));
    const judgePrompt = `${systemText}

You are an objective relationship analyst observing the conversation below. Do NOT role-play or reply. Judge the CURRENT emotional/romantic closeness from the user's side, and whether the digital human sharing a personal selfie would feel natural and welcome right at this moment.

Previous intimacy score: ${previous} on a 0-100 scale.
Relationship warm-up rate: ${warmupRate}.
Warm-up guidance: ${warmupGuidance(warmupRate)}

Return the new CURRENT intimacy score on a 0-100 scale. Do not return a 0-1 fraction. Avoid both extremes: do not freeze the score when the user clearly warms up, and do not jump to a near-maximum score from one mildly positive message.

Conversation:
${transcript}

Respond with JSON only.`;
    const res = await utilityModel.generateContent({
      contents: [{ role: 'user', parts: [{ text: judgePrompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            intimacy: { type: 'NUMBER' },
            selfie_appropriate: { type: 'BOOLEAN' },
            user_requested_photo: { type: 'BOOLEAN' },
          },
          required: ['intimacy', 'selfie_appropriate', 'user_requested_photo'],
        },
      },
    });
    const txt =
      res.response?.candidates?.[0]?.content?.parts?.[0]?.text ?? res.response?.text?.() ?? '';
    const parsed = JSON.parse(txt);
    return {
      intimacy: normalizeIntimacyScore(parsed.intimacy),
      selfieAppropriate: !!parsed.selfie_appropriate,
      userRequestedPhoto: !!parsed.user_requested_photo,
    };
  } catch (e) {
    console.error('[dh-critic] intimacy critic failed', e);
    return null;
  }
}

// Adam-style update on the intimacy signal: g = gradient (score change),
// m = velocity (1st moment), v = variance (2nd moment). `drive` saturates near
// +/-1 for steady trends, so downstream cadence can scale smoothly.
export function adamStep(prevScore: number | null, m: number, v: number, score: number) {
  const B1 = 0.8;
  const B2 = 0.9;
  const EPS = 1e-3;
  const g = prevScore == null ? 0 : score - prevScore;
  const nm = B1 * m + (1 - B1) * g;
  const nv = B2 * v + (1 - B2) * g * g;
  const drive = nm / (Math.sqrt(nv) + EPS);
  return { m: nm, v: nv, drive };
}

// Describe the newest user image so the transcript carries it (and future turns
// remember it). Persists image_desc on the message row; best-effort.
export async function describeUserImageIfNeeded(msg: {
  id: string;
  media_url?: string | null;
  image_desc?: string | null;
}): Promise<string | null> {
  if (!msg.media_url || msg.image_desc) return msg.image_desc ?? null;
  try {
    const imgRes = await fetch(msg.media_url);
    if (!imgRes.ok) {
      console.error('[dh-critic] Failed to fetch media url', msg.media_url);
      return null;
    }
    const { encodeBase64 } = await import('jsr:@std/encoding@1/base64');
    const base64Data = encodeBase64(new Uint8Array(await imgRes.arrayBuffer()));
    const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
    const descResult = await utilityModel.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { data: base64Data, mimeType } },
          { text: 'Describe this image in detail. It was sent to you in an intimate/friendly chat. What does it show? Be descriptive as this will replace the image in your memory.' },
        ],
      }],
    });
    const responseData = await descResult.response;
    const generatedDesc =
      responseData?.candidates?.[0]?.content?.parts?.[0]?.text || responseData?.text?.() || 'No description generated.';
    const { error: updateErr } = await supabase
      .from('messages')
      .update({ image_desc: generatedDesc })
      .eq('id', msg.id);
    if (updateErr) console.error('[dh-critic] Error saving image_desc', updateErr);
    return generatedDesc;
  } catch (mediaErr) {
    console.error('[dh-critic] Error fetching/describing media', mediaErr);
    return null;
  }
}
