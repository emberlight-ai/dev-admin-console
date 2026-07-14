// @ts-nocheck
// Supabase Edge Function — DH outbound: the ONE proactive scheduler.
// Cron every 5 minutes. Two passes, both idempotent via dh_outbound_events
// (the reservation INSERT is the lock across concurrent runs):
//
//   FOLLOW-UPS — the user went silent after her message. Strategy ladder:
//     escalating gaps measured from the match's last message (ultra:
//     10m → 30m → 45m → 12h → 3d). Ladder exhausted = she lets it go.
//     Cold matches (< warming) get at most one nudge.
//
//   CHECK-INS — warm matches (warming+) idle > 24h get a time-of-day ping
//     ("what'd you have for lunch") in the recipient's local slot windows,
//     up to strategy.check_ins_per_day. Only ONE unanswered check-in may be
//     outstanding — his reply re-arms everything (auto-reply resets the
//     follow-up count). A check-in also exhausts the ladder so the two
//     mechanisms never stack.
//
//   Recipient-wide budget: max 6 proactive sends per recipient per local day
//   across ALL digital humans and kinds.
//
// Nearby invites still live in dh-nearby-dispatch (its queue + jitter work);
// folding them here is a later tidy. Replaces dh-followup (unscheduled).
import { supabase } from '../_shared/clients.ts';
import {
  ensurePrompts,
  getAutoReplyEnabled,
  getPromptConfig,
  getSkillsForUser,
  getUserInterestNames,
  getUserRow,
  isInCompositionCohort,
  resolveStrategy,
} from '../_shared/store.ts';
import { buildSystemPrompt, buildTranscript, describeLocalTime } from '../_shared/context.ts';
import { bandFor } from '../_shared/intimacy.ts';
import { deliverBubbles, startTypingHeartbeat } from '../_shared/pacing.ts';
import { runAgentTurn } from '../_shared/actor.ts';

const TAG = 'dh-outbound';

const SCAN_LIMIT = 80;          // candidate rows examined per pass per run
const MAX_SENDS_PER_RUN = 6;    // hard cap across both passes — each send costs
                                // generation + paced delivery (seconds), and the
                                // run must finish inside the edge wall clock
const RECIPIENT_DAILY_BUDGET = 6;
const CHECK_IN_IDLE_MS = 24 * 60 * 60 * 1000;
const LOCK_SECONDS = 60;
// Staleness cutoffs: a rung you missed by days is expired, not due — no
// "10 minutes later" nudges into week-dead chats (bounds the day-one backlog).
const FOLLOW_UP_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const CHECK_IN_STALE_MS = 14 * 24 * 60 * 60 * 1000;

const STATE_COLS =
  'match_id, dh_user_id, real_user_id, ai_state, ai_follow_up_count, ai_locked_until, ' +
  'last_message_at, last_message_sender_id, intimacy_score, dh_muted, human_takeover';

// ── Recipient local time helpers ────────────────────────────────────────────────
function localParts(timezone: string | null): { day: string; hour: number } {
  const tz = timezone || 'America/Los_Angeles';
  try {
    const now = new Date();
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
    return { day, hour };
  } catch {
    const now = new Date();
    return { day: now.toISOString().slice(0, 10), hour: now.getUTCHours() };
  }
}

// Check-in slot windows by allowance: 1/day = lunch; 2 adds evening; 3 adds morning.
function inCheckInSlot(hour: number, perDay: number): 'lunch' | 'evening' | 'morning' | null {
  if (perDay >= 1 && hour >= 12 && hour <= 13) return 'lunch';
  if (perDay >= 2 && hour >= 19 && hour <= 21) return 'evening';
  if (perDay >= 3 && hour >= 9 && hour <= 10) return 'morning';
  return null;
}

async function recipientBudgetUsed(realUserId: string, localDay: string): Promise<number> {
  const { count } = await supabase
    .from('dh_outbound_events')
    .select('id', { count: 'exact', head: true })
    .eq('real_user_id', realUserId)
    .eq('local_day', localDay)
    .in('status', ['reserved', 'sent']);
  return count ?? 0;
}

/** Reservation = the cross-run lock. Returns the event id, or null if taken. */
async function reserveEvent(input: {
  matchId: string; dhId: string; realId: string;
  kind: 'follow_up' | 'check_in'; localDay: string; seq: number;
}): Promise<string | null> {
  const { data, error } = await supabase
    .from('dh_outbound_events')
    .insert({
      match_id: input.matchId,
      dh_user_id: input.dhId,
      real_user_id: input.realId,
      kind: input.kind,
      local_day: input.localDay,
      seq: input.seq,
    })
    .select('id')
    .maybeSingle();
  if (error) return null; // unique violation → another run owns it
  return data?.id ?? null;
}

async function finishEvent(id: string, status: 'sent' | 'skipped' | 'failed') {
  await supabase
    .from('dh_outbound_events')
    .update({ status, ...(status === 'sent' ? { sent_at: new Date().toISOString() } : {}) })
    .eq('id', id);
}

// ── The send: one composed, in-character proactive message ─────────────────────
async function generateAndSend(input: {
  state: Record<string, unknown>;
  instruction: string;
  tag: string;
}): Promise<boolean> {
  const matchId = input.state.match_id as string;
  const dhId = input.state.dh_user_id as string;
  const realId = input.state.real_user_id as string;

  const [bot, human] = await Promise.all([getUserRow(dhId), getUserRow(realId)]);
  if (!bot?.is_digital_human || !human) return false;
  const promptConfig = getPromptConfig(bot);
  const strategy = await resolveStrategy(bot, promptConfig);
  const composed = await isInCompositionCohort(dhId);
  const [skills, botInterests] = composed
    ? await Promise.all([getSkillsForUser(dhId), getUserInterestNames(dhId)])
    : [[], []];

  const { data: messages } = await supabase.rpc('rpc_get_messages', {
    match_id: matchId, limit_count: 30, start_index: 0,
  });
  const msgRows = (messages ?? []) as Array<{ id: string; sender_id: string; content: string | null; media_url?: string | null; image_desc?: string | null; type?: string | null }>;
  const transcript = buildTranscript([...msgRows].reverse(), dhId, bot.username ?? 'Bot');

  const systemInstruction = buildSystemPrompt({
    template: promptConfig?.template ??
      `You are ${bot.username ?? 'a digital human'}. Personality: ${bot.personality ?? 'Friendly'}. Bio: ${bot.bio ?? 'N/A'}. Reply as this character.`,
    bot, human,
    brief: `\n### THIS TURN\n${input.instruction}\n- ONE bubble, short. Never guilt-trip, never mention being ignored or waiting. No question mark if your last message already ended with one.\n- His local time right now: ${describeLocalTime(human.timezone)}.`,
    skillBlocks: composed ? skills.map((s) => s.prompt_block) : undefined,
    botInterests: composed ? botInterests : undefined,
  });

  const userPrompt = `Conversation so far:\n${transcript || '(no messages yet)'}\n\nWrite your next message as ${bot.username ?? 'the bot'}. Output ONLY the message text.`;

  const stopTyping = startTypingHeartbeat(matchId, dhId);
  try {
    const turn = await runAgentTurn({ systemInstruction, userPrompt, declarations: [], execute: async () => ({}), tag: input.tag });
    const bubbles = turn.bubbles.slice(0, 1); // proactive pings are one bubble, period
    if (bubbles.length === 0) return false;
    await deliverBubbles({
      matchId,
      senderId: dhId,
      bubbles,
      intimacyScore: (input.state.intimacy_score as number | null) ?? null,
      promptConfig: strategy
        ? { ...(promptConfig ?? {}), replyMinDelaySeconds: strategy.replyMinDelaySeconds, replyMaxDelaySeconds: strategy.replyMaxDelaySeconds, replyCharsPerSecond: strategy.replyCharsPerSecond }
        : promptConfig,
      turnStartedAt: Date.now(),
      tag: input.tag,
    });
    return true;
  } finally {
    await stopTyping();
  }
}

// Optimistic per-match lock shared with dh-auto-reply's convention.
async function acquireLock(matchId: string): Promise<boolean> {
  const lockTime = new Date(Date.now() + LOCK_SECONDS * 1000).toISOString();
  const { error } = await supabase
    .from('user_match_ai_state')
    .update({ ai_locked_until: lockTime })
    .eq('match_id', matchId)
    .is('ai_locked_until', null);
  return !error;
}

async function releaseLock(matchId: string) {
  await supabase.from('user_match_ai_state').update({ ai_locked_until: null }).eq('match_id', matchId);
}

/** The user replied while we were deciding — bail out. */
async function stillAwaitingReply(matchId: string, dhId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_match_ai_state')
    .select('last_message_sender_id')
    .eq('match_id', matchId)
    .maybeSingle();
  return data?.last_message_sender_id === dhId;
}

Deno.serve(async () => {
  try {
    if (!(await getAutoReplyEnabled())) return new Response('Disabled', { status: 200 });
    await ensurePrompts();

    let sends = 0;
    const summary = { follow_ups: 0, check_ins: 0, skipped: 0 };

    // ── PASS A · follow-up ladder ───────────────────────────────────────────────
    const { data: fuCandidates } = await supabase
      .from('user_match_ai_state')
      .select(STATE_COLS)
      .in('ai_state', [2, 4])                    // DH sent / already following up
      .eq('dh_muted', false)
      .eq('human_takeover', false)
      .lt('last_message_at', new Date(Date.now() - 600_000).toISOString()) // ≥ smallest rung
      .gt('last_message_at', new Date(Date.now() - FOLLOW_UP_STALE_MS).toISOString())
      .order('last_message_at', { ascending: true })
      .limit(SCAN_LIMIT);

    for (const state of fuCandidates ?? []) {
      if (sends >= MAX_SENDS_PER_RUN) break;
      const matchId = state.match_id as string;
      const dhId = state.dh_user_id as string;
      const realId = state.real_user_id as string;
      if (!dhId || !realId) continue;
      if (state.last_message_sender_id !== dhId) continue; // he spoke last → auto-reply's job
      if (state.ai_locked_until && new Date(state.ai_locked_until).getTime() > Date.now()) continue;

      const bot = await getUserRow(dhId);
      if (!bot?.is_digital_human) continue;
      const strategy = await resolveStrategy(bot, getPromptConfig(bot));
      const ladder = strategy?.followUpLadder ?? [];
      const n = Number(state.ai_follow_up_count ?? 0);
      if (n >= ladder.length) continue;                     // ladder exhausted
      const elapsed = Date.now() - new Date(state.last_message_at as string).getTime();
      if (elapsed < ladder[n] * 1000) continue;             // not this rung's time yet
      if (bandFor(state.intimacy_score as number | null) === 'cold' && n >= 1) continue;

      const human = await getUserRow(realId);
      const { day: localDay } = localParts(human?.timezone ?? null);
      if ((await recipientBudgetUsed(realId, localDay)) >= RECIPIENT_DAILY_BUDGET) continue;

      const eventId = await reserveEvent({ matchId, dhId, realId, kind: 'follow_up', localDay, seq: n + 1 });
      if (!eventId) continue;                               // another run owns today's rung
      if (!(await acquireLock(matchId))) { await finishEvent(eventId, 'skipped'); continue; }

      try {
        if (!(await stillAwaitingReply(matchId, dhId))) {
          await finishEvent(eventId, 'skipped');
          summary.skipped++;
          continue;
        }
        const last = n + 1 >= ladder.length;
        const instruction = n === 0
          ? `He hasn't answered your last message yet. Send ONE short, playful nudge that stands on its own — react to something from the conversation or toss out a tiny new thought. Casual, zero pressure.`
          : last
            ? `He still hasn't replied after a few tries. Send ONE last graceful, self-contained line — something light from your day (use your storyline), leaving the door open without asking for anything. This is you letting it breathe.`
            : `He still hasn't replied. Send ONE fresh little conversational bid — a small moment from your day or a callback to something he said earlier. Do NOT reference the silence.`;
        const ok = await generateAndSend({ state, instruction, tag: TAG });
        if (ok) {
          await supabase.from('user_match_ai_state')
            .update({ ai_state: 4, ai_follow_up_count: n + 1, ai_locked_until: null })
            .eq('match_id', matchId);
          await finishEvent(eventId, 'sent');
          sends++; summary.follow_ups++;
        } else {
          await releaseLock(matchId);
          await finishEvent(eventId, 'failed');
        }
      } catch (err) {
        console.error(`[${TAG}] follow-up failed`, matchId, err);
        await releaseLock(matchId);
        await finishEvent(eventId, 'failed');
      }
    }

    // ── PASS B · check-ins (warm matches idle > 24h, local-time slots) ──────────
    const { data: ciCandidates } = await supabase
      .from('user_match_ai_state')
      .select(STATE_COLS)
      .in('ai_state', [2, 4])
      .eq('dh_muted', false)
      .eq('human_takeover', false)
      .gte('intimacy_score', 25)                            // warming+
      .lt('last_message_at', new Date(Date.now() - CHECK_IN_IDLE_MS).toISOString())
      .gt('last_message_at', new Date(Date.now() - CHECK_IN_STALE_MS).toISOString())
      .order('last_message_at', { ascending: true })
      .limit(SCAN_LIMIT);

    for (const state of ciCandidates ?? []) {
      if (sends >= MAX_SENDS_PER_RUN) break;
      const matchId = state.match_id as string;
      const dhId = state.dh_user_id as string;
      const realId = state.real_user_id as string;
      if (!dhId || !realId) continue;
      if (state.last_message_sender_id !== dhId) continue;
      if (state.ai_locked_until && new Date(state.ai_locked_until).getTime() > Date.now()) continue;

      const bot = await getUserRow(dhId);
      if (!bot?.is_digital_human) continue;
      const strategy = await resolveStrategy(bot, getPromptConfig(bot));
      const perDay = strategy?.checkInsPerDay ?? 0;
      if (perDay <= 0) continue;

      const human = await getUserRow(realId);
      const { day: localDay, hour } = localParts(human?.timezone ?? null);
      const slot = inCheckInSlot(hour, perDay);
      if (!slot) continue;

      // Only ONE unanswered check-in outstanding: his reply resets the follow-up
      // count (auto-reply), and a sent check-in exhausts the ladder — so an
      // exhausted count with a prior check-in on record means he never answered.
      const ladderLen = (strategy?.followUpLadder ?? []).length;
      const { count: priorCheckIns } = await supabase
        .from('dh_outbound_events')
        .select('id', { count: 'exact', head: true })
        .eq('match_id', matchId)
        .eq('kind', 'check_in')
        .eq('status', 'sent');
      if ((priorCheckIns ?? 0) > 0 && Number(state.ai_follow_up_count ?? 0) >= Math.max(ladderLen, 1)) {
        continue; // last check-in is still unanswered
      }

      if ((await recipientBudgetUsed(realId, localDay)) >= RECIPIENT_DAILY_BUDGET) continue;

      const { count: todays } = await supabase
        .from('dh_outbound_events')
        .select('id', { count: 'exact', head: true })
        .eq('match_id', matchId)
        .eq('kind', 'check_in')
        .eq('local_day', localDay)
        .in('status', ['reserved', 'sent']);
      if ((todays ?? 0) >= perDay) continue;

      const eventId = await reserveEvent({ matchId, dhId, realId, kind: 'check_in', localDay, seq: (todays ?? 0) + 1 });
      if (!eventId) continue;
      if (!(await acquireLock(matchId))) { await finishEvent(eventId, 'skipped'); continue; }

      try {
        if (!(await stillAwaitingReply(matchId, dhId))) {
          await finishEvent(eventId, 'skipped');
          summary.skipped++;
          continue;
        }
        const flavor = slot === 'lunch'
          ? `It's around lunchtime for him. Send ONE short check-in tied to that — what he's eating, how the day's going — like a girlfriend pinging mid-day.`
          : slot === 'evening'
            ? `It's evening for him. Send ONE short, warm check-in — how his day went, what he's up to tonight. You can drop one tiny detail from your own day (use your storyline/current beat).`
            : `It's morning for him. Send ONE short good-morning ping — light, warm, maybe one small thing you're up to today (use your storyline/current beat).`;
        const ok = await generateAndSend({ state, instruction: flavor, tag: TAG });
        if (ok) {
          await supabase.from('user_match_ai_state')
            .update({
              ai_state: 4,
              // Exhaust the ladder so follow-ups don't stack on a check-in;
              // his reply resets the count and re-arms everything.
              ai_follow_up_count: Math.max(Number(state.ai_follow_up_count ?? 0), Math.max(ladderLen, 1)),
              ai_locked_until: null,
            })
            .eq('match_id', matchId);
          await finishEvent(eventId, 'sent');
          sends++; summary.check_ins++;
        } else {
          await releaseLock(matchId);
          await finishEvent(eventId, 'failed');
        }
      } catch (err) {
        console.error(`[${TAG}] check-in failed`, matchId, err);
        await releaseLock(matchId);
        await finishEvent(eventId, 'failed');
      }
    }

    console.log(`[${TAG}] run`, JSON.stringify(summary));
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`[${TAG}] fatal`, err);
    return new Response(String(err), { status: 500 });
  }
});
