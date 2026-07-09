// @ts-nocheck
// Delivery mechanics: Realtime typing/activity broadcasts, the resilient
// rpc_send_message wrapper, and human-like paced multi-bubble sending.
import { supabase, SUPABASE_URL, SERVICE_ROLE_KEY } from './clients.ts';
import type { CachedPrompt } from './store.ts';

const REALTIME_BROADCAST_URL = `${SUPABASE_URL}/realtime/v1/api/broadcast`;

// The iOS client subscribes to `chat:<match_id>` and renders "Typing…" from
// broadcasts on the `typing` event; `dh_status` drives "Viewing profiles…".
async function broadcast(matchId: string, event: string, payload: Record<string, unknown>): Promise<void> {
  try {
    await fetch(REALTIME_BROADCAST_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
      body: JSON.stringify({
        messages: [
          { topic: `chat:${matchId.toLowerCase()}`, event, payload, private: false },
        ],
      }),
    });
  } catch (err) {
    // Presence is best-effort cosmetic — never let it break a reply.
    console.error('[dh-pacing] broadcast failed', event, err);
  }
}

// Heartbeat contract: the client auto-clears the indicator a few seconds after
// the last event; the returned stop() cancels the heartbeat and broadcasts the
// clear exactly once.
function startHeartbeat(fire: (active: boolean) => void): () => Promise<void> {
  fire(true);
  const interval = setInterval(() => fire(true), 3000);
  let stopped = false;
  return async () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    await fire(false);
  };
}

export function startTypingHeartbeat(matchId: string, dhId: string): () => Promise<void> {
  return startHeartbeat((active) =>
    broadcast(matchId, 'typing', { user_id: dhId, typing: active })
  );
}

export function startActivityHeartbeat(matchId: string, dhId: string, status: string): () => Promise<void> {
  return startHeartbeat((active) =>
    broadcast(matchId, 'dh_status', { user_id: dhId, status: active ? status : null })
  );
}

// ── Message send (rpc_send_message with intimacy-arg fallback) ────────────────
export type SendMessageResult = {
  data: { id?: string } | null;
  error: unknown | null;
};

function canRetryWithoutIntimacyScore(error: unknown) {
  const err = error as { code?: string; message?: string } | null;
  const message = err?.message ?? String(error ?? '');
  return (
    err?.code === 'PGRST202' ||
    message.includes('message_intimacy_score') ||
    message.includes('intimacy_score') ||
    (message.includes('rpc_send_message') && message.includes('schema cache'))
  );
}

export async function sendMessageWithOptionalIntimacy(args: {
  matchId: string;
  senderId: string;
  content?: string | null;
  mediaUrl?: string | null;
  intimacyScore?: number | null;
}): Promise<SendMessageResult> {
  const baseArgs = {
    match_id: args.matchId,
    ...(args.content ? { content: args.content } : {}),
    ...(args.mediaUrl ? { media_url: args.mediaUrl } : {}),
    sender_id: args.senderId,
  };

  const withScore = await supabase.rpc('rpc_send_message', {
    ...baseArgs,
    message_intimacy_score: args.intimacyScore ?? null,
  });

  if (!withScore.error || !canRetryWithoutIntimacyScore(withScore.error)) {
    return withScore as SendMessageResult;
  }

  console.error(
    '[dh-pacing] rpc_send_message rejected message_intimacy_score; retrying legacy signature',
    withScore.error
  );
  const legacy = await supabase.rpc('rpc_send_message', baseArgs);

  const messageId = (legacy.data as { id?: string } | null)?.id;
  if (!legacy.error && messageId && args.intimacyScore != null) {
    const { error: updateErr } = await supabase
      .from('messages')
      .update({ intimacy_score: args.intimacyScore })
      .eq('id', messageId);
    if (updateErr) {
      console.error('[dh-pacing] Failed to backfill message intimacy_score after legacy send', updateErr);
    }
  }
  return legacy as SendMessageResult;
}

// ── Human-like paced delivery ──────────────────────────────────────────────────
// First bubble: derive a target from its length (read lead + "typing" time at
// the personality's chars/sec), count already-elapsed generation time toward
// it, bound by the personality's min/max. Subsequent bubbles: short typing
// gaps scaled by their own length.
export async function deliverBubbles(input: {
  matchId: string;
  senderId: string;
  bubbles: string[];
  intimacyScore: number | null;
  promptConfig: CachedPrompt | undefined;
  turnStartedAt: number;
  tag: string;
}): Promise<void> {
  const { bubbles, promptConfig } = input;
  const charsPerSec = Math.max(1, promptConfig?.replyCharsPerSecond ?? 15);
  const READ_LEAD_MS = 800;
  const minSendDelayMs = Math.max(0, (promptConfig?.replyMinDelaySeconds ?? 2)) * 1000;
  const maxSendDelayMs = Math.min(60, Math.max(0, (promptConfig?.replyMaxDelaySeconds ?? 18))) * 1000;
  const jitter = 0.85 + Math.random() * 0.3; // ±15% so the cadence isn't metronomic
  const typingTargetMs = (READ_LEAD_MS + (bubbles[0].length / charsPerSec) * 1000) * jitter;
  const elapsedMs = Date.now() - input.turnStartedAt;
  const firstDelayMs = Math.min(
    maxSendDelayMs,
    Math.max(minSendDelayMs, Math.round(typingTargetMs) - elapsedMs)
  );
  console.log(
    `[${input.tag}] sending`, bubbles.length, 'bubble(s), first delay', firstDelayMs,
    'ms for', input.matchId, '(elapsed', elapsedMs, 'ms, cps', charsPerSec, ')'
  );

  for (let i = 0; i < bubbles.length; i++) {
    const delayMs = i === 0
      ? firstDelayMs
      : Math.min(6000, Math.max(1200, Math.round((bubbles[i].length / charsPerSec) * 1000 * jitter)));
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    const { error: sendError } = await sendMessageWithOptionalIntimacy({
      matchId: input.matchId,
      content: bubbles[i],
      senderId: input.senderId,
      intimacyScore: input.intimacyScore,
    });
    if (sendError) throw sendError;
  }
}
