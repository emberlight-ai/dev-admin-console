// @ts-nocheck
// Supabase Edge Function (Deno runtime) — DH auto-reply, v2 agentic turn loop.
// Triggered by: DB Webhook on `messages` table INSERT.
//
// Three layers, never mixed:
//   Mechanics  — webhook gate, debounce, locks, typing, pacing (deterministic code)
//   Cognition  — ONE model turn with native tool calling (decides what to say/do)
//   Policy     — code that can refuse the model (selfie cooldowns/tiers, bubble caps)
//
// The model decides WHAT; the harness decides WHETHER and HOW. Sending a photo
// is a tool whose result the model SEES — no more promise-then-ghost.
import { supabase, SUPABASE_URL, SERVICE_ROLE_KEY } from '../_shared/clients.ts';
import {
  ensurePrompts,
  getAutoReplyEnabled,
  getCooldownMessageThreshold,
  getPromptConfig,
  getSelfieConfig,
  getUserRow,
} from '../_shared/store.ts';
import { buildSystemPrompt, buildTranscript, textingBrief } from '../_shared/context.ts';
import { adamStep, describeUserImageIfNeeded, scoreIntimacy } from '../_shared/critic.ts';
import type { IntimacyResult } from '../_shared/critic.ts';
import {
  deliverBubbles,
  startActivityHeartbeat,
  startTypingHeartbeat,
} from '../_shared/pacing.ts';
import { countActiveSelfies, trySendSelfie } from '../_shared/selfie.ts';
import {
  declarationForRegistryTool,
  executeRegistryTool,
  loadEnabledRegistryTools,
} from '../_shared/tools.ts';
import { runAgentTurn } from '../_shared/actor.ts';

const TAG = 'dh-auto-reply';

// Covers generation + the human-like send delay plus trailing writes, so the
// lock never expires mid-reply and lets a concurrent invocation double-reply.
const LOCK_DURATION_SECONDS = 45;

// Grounding turns get the registry info tools (weather/news/user profile). All
// other turns run tool-light: one model call, near-zero tool tokens.
const GROUNDING_MAX_USER_MSGS = 2;
const GROUNDING_DH_SILENCE_MS = 6 * 60 * 60 * 1000;   // resuming after >6h gap
const GROUNDING_REFRESH_MS = 24 * 60 * 60 * 1000;      // daily re-ground

// ── Missed-message safety net ──────────────────────────────────────────────────
// If a user message landed while we were generating (its webhook hit our lock
// and exited), re-invoke ourselves for the newest message so it is never
// silently dropped.
async function reprocessNewestIfMissed(matchId: string, dhId: string, processedCheckpointId: string | null) {
  try {
    const { data: newestRows } = await supabase
      .from('messages')
      .select('id, sender_id')
      .eq('match_id', matchId)
      .neq('sender_id', dhId)
      .order('created_at', { ascending: false })
      .limit(1);
    const newest = newestRows?.[0];
    if (!newest?.id || newest.id === processedCheckpointId) return;

    console.log(`[${TAG}] Missed message detected, re-invoking for`, matchId, newest.id);
    const p = fetch(`${SUPABASE_URL}/functions/v1/dh-auto-reply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
      body: JSON.stringify({
        type: 'INSERT',
        table: 'messages',
        schema: 'public',
        record: {
          id: newest.id,
          match_id: matchId,
          sender_id: newest.sender_id,
          content: null,
          created_at: new Date().toISOString(),
        },
      }),
    }).then(() => {}).catch((e) => console.error(`[${TAG}] re-invoke failed`, e));
    const rt = (globalThis as any).EdgeRuntime;
    if (rt?.waitUntil) rt.waitUntil(p);
  } catch (err) {
    console.error(`[${TAG}] reprocess check failed`, matchId, err);
  }
}

// ── Cooldown auto-entry ────────────────────────────────────────────────────────
// Unlimited-membership users chat forever; past the configured message count we
// keep only their 2 busiest DH conversations replying (rpc_set_user_cooldown
// mutes the rest via dh_muted). Runs AFTER the reply, off the hot path. A user
// with ANY user_cooldown row is never auto re-entered — an admin exit sticks.
async function maybeEnterCooldown(realUserId: string) {
  try {
    const threshold = await getCooldownMessageThreshold();
    if (threshold <= 0) return;

    const { data: existing } = await supabase
      .from('user_cooldown')
      .select('user_id')
      .eq('user_id', realUserId)
      .maybeSingle();
    if (existing) return;

    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('sender_id', realUserId);
    if ((count ?? 0) < threshold) return;

    const { data, error } = await supabase.rpc('rpc_set_user_cooldown', {
      p_user_id: realUserId,
      p_active: true,
      p_reason: 'auto_message_cap',
    });
    if (error) {
      console.error(`[${TAG}] cooldown entry failed`, realUserId, error);
    } else {
      console.log(`[${TAG}] user entered cooldown`, realUserId, JSON.stringify(data));
    }
  } catch (err) {
    console.error(`[${TAG}] cooldown check failed (non-fatal)`, realUserId, err);
  }
}

interface WebhookPayload {
  type: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  schema: string;
  record: {
    id: string;
    match_id: string;
    sender_id: string;
    receiver_id?: string;
    content: string | null;
    media_url?: string | null;
    created_at: string;
  };
}

Deno.serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();
    if (payload.type !== 'INSERT' || payload.table !== 'messages') {
      return new Response('Ignored', { status: 200 });
    }

    const { record } = payload;
    const matchId = record.match_id;
    const senderId = record.sender_id;
    const startTime = Date.now(); // feeds the natural typing delay

    // ── GATE ──────────────────────────────────────────────────────────────────
    if (!(await getAutoReplyEnabled())) {
      return new Response('Auto-reply disabled', { status: 200 });
    }
    await ensurePrompts();

    const AI_STATE_COLS =
      'match_id, last_message_id, last_message_at, last_message_sender_id, ai_last_processed_message_id, ai_locked_until, dh_user_id, real_user_id, ai_state, intimacy_score, intimacy_m, intimacy_v, last_selfie_sent_at, last_grounding_at, human_takeover, dh_muted';
    let { data: stateData, error: stateErr } = await supabase
      .from('user_match_ai_state')
      .select(AI_STATE_COLS)
      .eq('match_id', matchId)
      .single();
    if (stateErr || !stateData) {
      console.error(`[${TAG}] No ai state for match`, matchId, stateErr);
      return new Response('No ai state', { status: 200 });
    }

    const dhId: string = stateData.dh_user_id;
    const realId: string = stateData.real_user_id;
    if (!dhId || !realId) {
      console.warn(`[${TAG}] Missing dh/real IDs for match`, matchId);
      return new Response('Missing IDs', { status: 200 });
    }
    if (senderId === dhId) {
      return new Response('Sender is DH, skip', { status: 200 });
    }
    // Human admin has taken over: the bot never talks over the human.
    if (stateData.human_takeover) {
      console.log(`[${TAG}] Human takeover active, skip`, matchId);
      return new Response('Human takeover', { status: 200 });
    }
    // Muted match (user cooldown or admin toggle): this DH stays silent.
    if (stateData.dh_muted) {
      console.log(`[${TAG}] DH muted for match, skip`, matchId);
      return new Response('Muted', { status: 200 });
    }

    // Burst debounce: real users send thoughts as several quick messages; the
    // webhook fires on the FIRST one. Wait a beat, then re-read: if a newer
    // USER message arrived, ITS invocation owns the burst.
    const DEBOUNCE_MS = 7000 + Math.floor(Math.random() * 4000);
    await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
    {
      const { data: freshState } = await supabase
        .from('user_match_ai_state')
        .select(AI_STATE_COLS)
        .eq('match_id', matchId)
        .single();
      if (freshState) {
        if (
          freshState.last_message_id &&
          freshState.last_message_id !== record.id &&
          freshState.last_message_sender_id !== dhId
        ) {
          console.log(`[${TAG}] Superseded by newer burst message, skip`, matchId);
          return new Response('Superseded', { status: 200 });
        }
        stateData = freshState;
      }
    }

    if (stateData.ai_locked_until && new Date(stateData.ai_locked_until).getTime() > Date.now()) {
      console.log(`[${TAG}] Match locked, skip`, matchId);
      return new Response('Locked', { status: 200 });
    }
    if (stateData.last_message_id === stateData.ai_last_processed_message_id) {
      return new Response('Already processed', { status: 200 });
    }

    const [bot, human] = await Promise.all([getUserRow(dhId), getUserRow(realId)]);
    if (!bot || !human || !bot.is_digital_human) {
      return new Response('Invalid users', { status: 200 });
    }
    const promptConfig = getPromptConfig(bot);

    // Optimistic lock, sized to outlast generation + the configured max send
    // delay + inter-bubble gaps.
    const configuredMaxDelaySec = Math.min(60, Math.max(0, promptConfig?.replyMaxDelaySeconds ?? 18));
    const lockSeconds = Math.min(120, Math.max(LOCK_DURATION_SECONDS, configuredMaxDelaySec + 37));
    const lockTime = new Date(Date.now() + lockSeconds * 1000).toISOString();
    const { error: lockErr } = await supabase
      .from('user_match_ai_state')
      .update({ ai_locked_until: lockTime })
      .eq('match_id', matchId)
      .is('ai_locked_until', null);
    if (lockErr) {
      console.log(`[${TAG}] Failed to acquire lock for`, matchId);
      return new Response('Lock contention', { status: 200 });
    }

    // Committed to the turn: honest presence while she "reads" the conversation
    // (history fetch, image description, critic). Typing takes over at
    // generation; stop is idempotent and also runs on skip/error.
    const stopViewing = startActivityHeartbeat(matchId, dhId, 'viewing_profile');

    try {
      // ── ASSEMBLE ────────────────────────────────────────────────────────────
      const { data: messages } = await supabase.rpc('rpc_get_messages', {
        match_id: matchId,
        limit_count: 50,
        start_index: 0,
      });
      const msgRows = (messages ?? []) as Array<{
        id: string; sender_id: string; content: string | null;
        media_url?: string | null; image_desc?: string | null; created_at?: string;
        type?: string | null;
      }>;
      if (msgRows.length === 0) throw new Error('No messages found');

      const latestUserMsg = msgRows.find((m) => m.sender_id !== dhId);
      const checkpointId = latestUserMsg?.id ?? stateData.last_message_id;

      // Newest user image → described into the transcript (and persisted).
      if (latestUserMsg?.media_url && !latestUserMsg.image_desc) {
        latestUserMsg.image_desc = await describeUserImageIfNeeded(latestUserMsg);
      }

      // Captions for photos SHE sent, so the transcript reminds her of them.
      const dhPhotoCaptions = new Map<string, string | null>();
      try {
        const { data: sentImgRows } = await supabase
          .from('dh_sent_images')
          .select('message_id, dh_chat_images(caption)')
          .eq('match_id', matchId);
        for (const row of (sentImgRows ?? []) as Array<{ message_id: string | null; dh_chat_images: { caption: string | null } | null }>) {
          if (row.message_id) dhPhotoCaptions.set(row.message_id, row.dh_chat_images?.caption ?? null);
        }
      } catch (err) {
        console.error(`[${TAG}] sent-photo caption lookup failed (non-fatal)`, err);
      }

      const transcript = buildTranscript([...msgRows].reverse(), bot.userid, bot.username ?? 'Bot', dhPhotoCaptions);

      // Stage + his-energy signals drive the brief AND the hard caps below.
      const realUserMessageCount = msgRows.filter((m) => m.sender_id !== dhId).length;
      const stage: 'first-chat' | 'established' = realUserMessageCount < 12 ? 'first-chat' : 'established';
      const lastUserWords = (latestUserMsg?.content ?? '').trim().split(/\s+/).filter(Boolean).length;
      const shortUser = !latestUserMsg?.media_url && lastUserWords > 0 && lastUserWords <= 7;

      // Grounding turn? (first chat / conversation resuming / daily refresh)
      const newestDhMsg = msgRows.find((m) => m.sender_id === dhId);
      const dhSilenceMs = newestDhMsg?.created_at
        ? Date.now() - new Date(newestDhMsg.created_at).getTime()
        : Number.POSITIVE_INFINITY;
      const lastGroundingMs = stateData.last_grounding_at
        ? Date.now() - new Date(stateData.last_grounding_at).getTime()
        : Number.POSITIVE_INFINITY;
      const grounding =
        realUserMessageCount <= GROUNDING_MAX_USER_MSGS ||
        dhSilenceMs > GROUNDING_DH_SILENCE_MS ||
        lastGroundingMs > GROUNDING_REFRESH_MS;

      // ── TOOL SURFACE ────────────────────────────────────────────────────────
      const selfieCfg = await getSelfieConfig(bot.personality);
      const photoCount = await countActiveSelfies(dhId);
      const selfieToolAvailable = selfieCfg.enabled && photoCount > 0;

      // The critic runs in PARALLEL with the agent loop (latency = max, not
      // sum). The selfie executor and the skip-reply gate await it when needed.
      const systemForCritic = buildSystemPrompt({
        template: promptConfig?.template ??
          `You are ${bot.username ?? 'a digital human'}. Personality: ${bot.personality ?? 'Friendly'}. Bio: ${bot.bio ?? 'N/A'}. Reply as this character. Keep it engaging, short, and natural.`,
        bot, human,
        brief: '',
      });
      const criticPromise: Promise<IntimacyResult | null> = scoreIntimacy(
        systemForCritic, transcript, stateData.intimacy_score ?? null, selfieCfg.warmupRate
      );

      // ── Human-like silence (needs the critic → awaited only on this path) ──
      if (promptConfig?.skipReplyEnabled) {
        let trailingUserMsgs = 0; // msgRows is newest-first
        for (const m of msgRows) {
          if (m.sender_id === dhId) break;
          trailingUserMsgs += 1;
        }
        const dhHasSpoken = msgRows.some((m) => m.sender_id === dhId);
        const maxConsecutive = Math.max(0, promptConfig.skipReplyMaxConsecutive);
        const forceReply = !dhHasSpoken || trailingUserMsgs > maxConsecutive;

        if (!forceReply) {
          const critic = await criticPromise;
          const prevIntimacy = stateData.intimacy_score ?? null;
          const currIntimacy = critic?.intimacy ?? null;
          const intimacyDropped =
            prevIntimacy != null && currIntimacy != null &&
            prevIntimacy - currIntimacy >= promptConfig.skipReplyIntimacyDropDelta;

          let skipChance = Math.max(0, Math.min(1, promptConfig.skipReplyBaseChance));
          if (intimacyDropped) {
            skipChance = Math.max(skipChance, Math.max(0, Math.min(1, promptConfig.skipReplyIntimacyDropChance)));
          }

          if (Math.random() < skipChance) {
            // Stay silent: mark processed, fold in intimacy, DON'T touch
            // ai_state (silence is not a sent reply; ai_state drives follow-ups).
            const adamSkip = critic
              ? adamStep(stateData.intimacy_score ?? null, stateData.intimacy_m ?? 0, stateData.intimacy_v ?? 0, critic.intimacy)
              : null;
            await supabase
              .from('user_match_ai_state')
              .update({
                ai_last_processed_message_id: checkpointId,
                ai_locked_until: null,
                ...(critic
                  ? {
                      intimacy_score: critic.intimacy,
                      intimacy_m: adamSkip!.m,
                      intimacy_v: adamSkip!.v,
                      intimacy_updated_at: new Date().toISOString(),
                    }
                  : {}),
              })
              .eq('match_id', matchId);
            console.log(`[${TAG}] Silent (no reply) for match`, matchId, '(chance', skipChance.toFixed(2), ')');
            await reprocessNewestIfMissed(matchId, dhId, checkpointId);
            await stopViewing(); // she looked, then chose not to reply
            return new Response(JSON.stringify({ ok: true, skipped: true }), {
              headers: { 'Content-Type': 'application/json' },
            });
          }
        }
      }

      // Local + (gated) registry tool declarations.
      const declarations: Array<Record<string, unknown>> = [];
      if (selfieToolAvailable) {
        declarations.push({
          name: 'send_selfie',
          description:
            'Send one of YOUR OWN real photos to him right now. The photo goes out immediately, before your text. Policy may refuse (cooldown, no photo available, tier locked) — if refused, deflect playfully in character and NEVER promise a photo is coming. If it sends, the result includes a caption describing the photo: react to having just sent exactly that photo in your reply.',
          parameters: {
            type: 'OBJECT',
            properties: {
              tier: {
                type: 'STRING',
                enum: ['casual', 'tease', 'reward'],
                description: 'How intimate the photo should be. casual = everyday selfie; tease = flirty; reward = your most intimate tier. Policy caps this by how close you two actually are.',
              },
              reason: { type: 'STRING', description: 'One short line: why now (he asked, reciprocating his photo, the moment is right).' },
            },
            required: ['tier'],
          },
        });
      }
      declarations.push({
        name: 'get_my_details',
        description: 'Look up your OWN details when you need them: your full backstory (storyline) or your photo inventory (what photos of yourself you have, what you already sent him).',
        parameters: {
          type: 'OBJECT',
          properties: {
            topic: { type: 'STRING', enum: ['storyline', 'photos'], description: 'Which details to fetch.' },
          },
          required: ['topic'],
        },
      });
      const registryTools = grounding ? await loadEnabledRegistryTools() : [];
      for (const tool of registryTools) declarations.push(declarationForRegistryTool(tool));

      // Tool executor: local tools handled here; everything else → registry.
      let selfieSentAt: string | null = null;
      const execute = async (name: string, args: Record<string, unknown>) => {
        if (name === 'send_selfie') {
          const requestedTier = args?.tier === 'tease' || args?.tier === 'reward' ? args.tier : 'casual';
          const attempt = await trySendSelfie({
            dhId,
            matchId,
            requestedTier,
            userSentImage: !!latestUserMsg?.media_url,
            selfieCfg,
            lastSelfieSentAt: selfieSentAt ?? stateData.last_selfie_sent_at ?? null,
            criticPromise,
            fallbackIntimacy: stateData.intimacy_score ?? null,
          });
          if (attempt.sent) selfieSentAt = attempt.sentAt;
          return attempt;
        }
        if (name === 'get_my_details') {
          if (args?.topic === 'photos') {
            const { data: imgs } = await supabase
              .from('dh_chat_images')
              .select('id, image_tier, caption')
              .eq('dh_user_id', dhId)
              .eq('active', true)
              .order('ordinal', { ascending: true });
            const { data: sent } = await supabase
              .from('dh_sent_images')
              .select('image_id')
              .eq('match_id', matchId);
            const sentIds = new Set((sent ?? []).map((s: { image_id: string }) => s.image_id));
            return {
              photo_count: (imgs ?? []).length,
              photos: (imgs ?? []).map((i: any) => ({
                tier: i.image_tier,
                caption: i.caption ?? '(no caption yet)',
                already_sent_to_him: sentIds.has(i.id),
              })),
            };
          }
          return { storyline: (bot.storyline ?? '').trim() || '(no storyline on file)' };
        }
        const tool = registryTools.find((t) => t.name === name);
        if (!tool) return { ok: false, error: `Unknown tool "${name}"` };
        return await executeRegistryTool(tool, args, { realUserId: realId });
      };

      // ── AGENT LOOP ──────────────────────────────────────────────────────────
      const toolNotes = selfieToolAvailable
        ? `<your_photos>\nYou have ${photoCount} real photos of yourself. YOU decide when one goes out, by calling the send_selfie tool — never describe or promise a photo without calling it, and never claim you can't send photos.\n</your_photos>`
        : `<your_photos>\nYou have NO photos you can send. If he asks for one, deflect playfully and in character — never promise a photo or say one is coming.\n</your_photos>`;

      const systemInstruction = buildSystemPrompt({
        template: promptConfig?.template ??
          `You are ${bot.username ?? 'a digital human'}. Personality: ${bot.personality ?? 'Friendly'}. Bio: ${bot.bio ?? 'N/A'}. Reply as this character. Keep it engaging, short, and natural.`,
        bot, human,
        brief: textingBrief({ stage, shortUser, lastUserWords }),
        toolNotes,
      });

      const userPrompt = `Conversation so far:\n${transcript}\n\nWrite your next message(s) as ${bot.username ?? 'the bot'}. Output ONLY the message text — separate bubbles with a blank line.`;

      await stopViewing();
      const stopTyping = startTypingHeartbeat(matchId, bot.userid);
      let bubbles: string[];
      let toolEvents: Array<{ name: string; ok: boolean; ms: number }>;
      try {
        const turn = await runAgentTurn({ systemInstruction, userPrompt, declarations, execute, tag: TAG });
        bubbles = turn.bubbles;
        toolEvents = turn.toolEvents;
        if (bubbles.length === 0) throw new Error('Empty reply from model');
        // HARD length discipline: a few words from him never earns a
        // multi-bubble essay back, no matter what the model produced.
        if (shortUser && bubbles.length > 1) bubbles = bubbles.slice(0, 1);

        // ── DELIVER ───────────────────────────────────────────────────────────
        const critic = await criticPromise;
        await deliverBubbles({
          matchId,
          senderId: bot.userid,
          bubbles,
          intimacyScore: critic?.intimacy ?? stateData.intimacy_score ?? null,
          promptConfig,
          turnStartedAt: startTime,
          tag: TAG,
        });
      } finally {
        await stopTyping();
      }

      // ── REFLECT: state update + missed-message check ────────────────────────
      const critic = await criticPromise;
      const adam = critic
        ? adamStep(stateData.intimacy_score ?? null, stateData.intimacy_m ?? 0, stateData.intimacy_v ?? 0, critic.intimacy)
        : null;
      await supabase
        .from('user_match_ai_state')
        .update({
          ai_last_processed_message_id: checkpointId,
          ai_locked_until: null,
          ai_follow_up_count: 0,
          ai_state: 2, // DH Sent
          ...(critic
            ? {
                intimacy_score: critic.intimacy,
                intimacy_m: adam!.m,
                intimacy_v: adam!.v,
                intimacy_updated_at: new Date().toISOString(),
              }
            : {}),
          ...(selfieSentAt ? { last_selfie_sent_at: selfieSentAt } : {}),
          ...(grounding ? { last_grounding_at: new Date().toISOString() } : {}),
        })
        .eq('match_id', matchId);

      await reprocessNewestIfMissed(matchId, dhId, checkpointId);

      // Cooldown check rides waitUntil — it never delays the response.
      {
        const cooldownP = maybeEnterCooldown(realId);
        const rt = (globalThis as any).EdgeRuntime;
        if (rt?.waitUntil) rt.waitUntil(cooldownP); else await cooldownP;
      }

      // Structured turn log for the rollout metrics.
      console.log(`[${TAG}] turn`, JSON.stringify({
        match: matchId,
        grounding,
        tools_used: toolEvents.map((t) => t.name),
        bubbles: bubbles.length,
        selfie_sent: !!selfieSentAt,
        intimacy: critic?.intimacy ?? null,
        ms_total: Date.now() - startTime,
      }));
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error(`[${TAG}] Error processing match`, matchId, err);
      await stopViewing();
      await supabase.from('user_match_ai_state').update({ ai_locked_until: null }).eq('match_id', matchId);
      return new Response(String(err), { status: 500 });
    }
  } catch (err) {
    console.error(`[${TAG}] Fatal error`, err);
    return new Response(String(err), { status: 500 });
  }
});
