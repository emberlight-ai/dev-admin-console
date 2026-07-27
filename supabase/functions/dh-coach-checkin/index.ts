// @ts-nocheck
// Supabase Edge Function — coach check-in dispatcher (pg_cron, every minute).
//
// Delivers due dh_coach_checkins rows: each row's prompt becomes the turn
// instruction for a proactive coach message, generated with the DH's full
// persona/skills/plan context and delivered through the same paced pipeline
// as replies (typing indicator included), plus any coach components the model
// attaches. Scheduling happens in _shared/coach.ts when the plan turn lands.
import { supabase } from '../_shared/clients.ts';
import {
  ensurePrompts,
  getAutoReplyEnabled,
  getPromptConfig,
  getSkillsForUser,
  getUserInterestNames,
  getUserRow,
} from '../_shared/store.ts';
import { buildSystemPrompt, buildTranscript } from '../_shared/context.ts';
import { deliverBubbles, startTypingHeartbeat } from '../_shared/pacing.ts';
import { runAgentTurn } from '../_shared/actor.ts';
import {
  coachSkillOf,
  componentCatalogNote,
  extractComponents,
  loadCoachState,
  sendComponentMessages,
} from '../_shared/coach.ts';

const TAG = 'dh-coach-checkin';
const BATCH = 5;

async function markStatus(id: string, status: string) {
  const { error } = await supabase.from('dh_coach_checkins').update({ status }).eq('id', id);
  if (error) console.error(`[${TAG}] status update failed`, id, status, error);
}

async function deliverCheckin(row: { id: string; match_id: string; prompt: string }): Promise<void> {
  const startTime = Date.now();
  const matchId = row.match_id;

  const { data: match } = await supabase
    .from('user_matches')
    .select('user_a, user_b')
    .eq('id', matchId)
    .maybeSingle();
  if (!match) return markStatus(row.id, 'skipped');

  const [a, b] = await Promise.all([getUserRow(match.user_a), getUserRow(match.user_b)]);
  const bot = a?.is_digital_human ? a : b?.is_digital_human ? b : null;
  const human = bot === a ? b : a;
  if (!bot || !human || human.is_digital_human) return markStatus(row.id, 'skipped');

  // Respect the same conversation guards as replies.
  const { data: aiState } = await supabase
    .from('user_match_ai_state')
    .select('human_takeover, dh_muted, intimacy_score, ai_locked_until')
    .eq('match_id', matchId)
    .maybeSingle();
  if (aiState?.human_takeover || aiState?.dh_muted) return markStatus(row.id, 'skipped');

  // Share the reply worker's match lock: a check-in must never land while the
  // user is actively receiving a generated response. A busy match is retried
  // on the next cron tick rather than discarded.
  if (aiState?.ai_locked_until && new Date(aiState.ai_locked_until).getTime() > Date.now()) {
    return markStatus(row.id, 'pending');
  }
  const lockUntil = new Date(Date.now() + 60_000).toISOString();
  let lockQuery = supabase
    .from('user_match_ai_state')
    .update({ ai_locked_until: lockUntil })
    .eq('match_id', matchId);
  lockQuery = aiState?.ai_locked_until
    ? lockQuery.eq('ai_locked_until', aiState.ai_locked_until)
    : lockQuery.is('ai_locked_until', null);
  const { data: lock } = await lockQuery.select('match_id').maybeSingle();
  if (!lock) return markStatus(row.id, 'pending');

  let stopTyping: (() => Promise<void>) | null = null;
  try {
    const promptConfig = getPromptConfig(bot);
    const [skills, botInterests] = await Promise.all([
      getSkillsForUser(bot.userid),
      getUserInterestNames(bot.userid),
    ]);
    const coachSkill = coachSkillOf(skills);
    if (!coachSkill) return markStatus(row.id, 'skipped');
    const state = await loadCoachState({ matchId, userId: human.userid, dhId: bot.userid, skillKey: coachSkill.key });
    if (state.phase !== 'active') return markStatus(row.id, 'skipped');

    const { data: messages } = await supabase.rpc('rpc_get_messages', {
    match_id: matchId,
    limit_count: 30,
    start_index: 0,
  });
    const transcript = buildTranscript(
    [...(messages ?? [])].reverse(),
    bot.userid,
    bot.username ?? 'Bot',
  );

    const brief = `
### COACH CHECK-IN (you are reaching out first)
${state?.plan ? `The plan you two agreed on:\n${state.plan}\n` : ''}
Your check-in instruction for RIGHT NOW:
${row.prompt}

Keep it to 1-2 short warm bubbles, like a coach texting a client she's excited about. Reference his actual plan/answers when natural. If the instruction names a component, attach it.`;

    const componentNote = coachSkill.components.length > 0
    ? componentCatalogNote(coachSkill.components)
    : '';

    const systemInstruction = buildSystemPrompt({
    template: promptConfig?.template ??
      `You are ${bot.username ?? 'a digital human'}. Personality: ${bot.personality ?? 'Friendly'}. Bio: ${bot.bio ?? 'N/A'}. Reply as this character.`,
    bot,
    human,
    brief,
    toolNotes: componentNote || undefined,
    skillBlocks: skills.map((s) => s.prompt_block),
    botInterests,
  });

    const userPrompt = `Conversation so far:\n${transcript}\n\nWrite your check-in message(s) as ${bot.username ?? 'the coach'}. Output ONLY the message text — separate bubbles with a blank line.`;

    stopTyping = startTypingHeartbeat(matchId, bot.userid);
    const turn = await runAgentTurn({
      systemInstruction,
      userPrompt,
      declarations: [],
      execute: async () => ({ ok: false, error: 'No tools on check-ins' }),
      tag: TAG,
    });
    const { textBubbles, components } = extractComponents(turn.bubbles, coachSkill.components);
    if (textBubbles.length === 0 && components.length === 0) throw new Error('Empty check-in from model');

    if (textBubbles.length > 0) {
      await deliverBubbles({
        matchId,
        senderId: bot.userid,
        bubbles: textBubbles.slice(0, 2),
        intimacyScore: aiState?.intimacy_score ?? null,
        promptConfig,
        turnStartedAt: startTime,
        tag: TAG,
      });
    }
    if (components.length > 0) {
      await sendComponentMessages({
        matchId,
        senderId: bot.userid,
        receiverId: human.userid,
        components,
        tag: TAG,
      });
    }

    await supabase
      .from('user_match_ai_state')
      .update({ ai_state: 2, ai_locked_until: null })
      .eq('match_id', matchId);
    await markStatus(row.id, 'sent');
    console.log(`[${TAG}] check-in delivered`, JSON.stringify({
      match: matchId,
      bubbles: textBubbles.length,
      components: components.map((c) => c.component),
      ms: Date.now() - startTime,
    }));
  } finally {
    if (stopTyping) await stopTyping();
    await supabase
      .from('user_match_ai_state')
      .update({ ai_locked_until: null })
      .eq('match_id', matchId)
      .eq('ai_locked_until', lockUntil);
  }
}

Deno.serve(async () => {
  try {
    await ensurePrompts();
    if (!(await getAutoReplyEnabled())) {
      return new Response(JSON.stringify({ ok: true, delivered: 0, disabled: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    const { data: due, error } = await supabase.rpc('claim_due_coach_checkins', { p_limit: BATCH });
    if (error) throw error;
    const rows = due ?? [];
    if (rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, delivered: 0 }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let delivered = 0;
    for (const row of rows) {
      try {
        await deliverCheckin(row);
        delivered += 1;
      } catch (err) {
        console.error(`[${TAG}] check-in failed`, row.id, err);
        await markStatus(row.id, 'failed');
      }
    }
    return new Response(JSON.stringify({ ok: true, delivered }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(`[${TAG}] fatal`, err);
    return new Response(String(err), { status: 500 });
  }
});
