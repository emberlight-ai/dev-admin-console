// @ts-nocheck
// Coach programs (skill hosting v1): a skill with intake_questions runs a
// structured program — intake questions one per turn → a personal plan →
// scheduled check-ins (dh_coach_checkins, dispatched by dh-coach-checkin) —
// and may attach server-driven UI "components" the iOS app renders natively.
// See docs/coach-programs.md.
import { supabase } from './clients.ts';
import type { SkillRow } from './store.ts';

export interface CoachState {
  match_id: string;
  user_id: string;
  dh_user_id: string;
  skill_key: string;
  phase: 'intake' | 'active';
  question_index: number;
  intake_answers: Array<{ question: string; answer: string }>;
  plan: string | null;
}

export interface CoachTurn {
  skill: SkillRow;
  state: CoachState;
  /** Appended to the texting brief for this turn. */
  brief: string;
  /** True once every intake question is answered — this turn writes the plan. */
  isPlanTurn: boolean;
  /** The answer captured from the user's latest message this turn, if any. */
  recordedAnswer: { question: string; answer: string } | null;
}

const MAX_COMPONENTS_PER_TURN = 2;
const MAX_COMPONENT_PREVIEW_LENGTH = 180;

/** The (single) program-running skill among a DH's skills. */
export function coachSkillOf(skills: SkillRow[]): SkillRow | null {
  return skills.find((s) => (s.intake_questions?.length ?? 0) > 0) ?? null;
}

export async function loadCoachState(input: {
  matchId: string;
  userId: string;
  dhId: string;
  skillKey: string;
}): Promise<CoachState> {
  const toState = (raw: Record<string, unknown>): CoachState => ({
    ...raw,
    intake_answers: Array.isArray(raw.intake_answers) ? raw.intake_answers : [],
  }) as CoachState;

  const { data, error } = await supabase
    .from('dh_coach_state')
    .select('*')
    .eq('match_id', input.matchId)
    .maybeSingle();
  if (error) throw new Error(`Could not load coach state: ${error.message}`);
  if (data) return toState(data);

  const fresh: CoachState = {
    match_id: input.matchId,
    user_id: input.userId,
    dh_user_id: input.dhId,
    skill_key: input.skillKey,
    phase: 'intake',
    question_index: 0,
    intake_answers: [],
    plan: null,
  };
  // A duplicate webhook may race the first insert. Always re-read afterwards:
  // returning our local copy would let the loser repeat an intake question.
  const { error: insertError } = await supabase.from('dh_coach_state').upsert(
    {
      match_id: fresh.match_id,
      user_id: fresh.user_id,
      dh_user_id: fresh.dh_user_id,
      skill_key: fresh.skill_key,
    },
    { onConflict: 'match_id', ignoreDuplicates: true }
  );
  if (insertError) throw new Error(`Could not create coach state: ${insertError.message}`);

  const { data: resolved, error: resolvedError } = await supabase
    .from('dh_coach_state')
    .select('*')
    .eq('match_id', input.matchId)
    .single();
  if (resolvedError || !resolved) {
    throw new Error(`Could not resolve coach state: ${resolvedError?.message ?? 'missing row'}`);
  }
  return toState(resolved);
}

/**
 * Decide what this reply turn does for the program: capture the answer to the
 * previous question, then either ask the next question or write the plan.
 * Pure read — state advances only in commitCoachTurn after delivery succeeds.
 */
export async function prepareCoachTurn(input: {
  skill: SkillRow;
  matchId: string;
  userId: string;
  dhId: string;
  latestUserText: string | null;
}): Promise<CoachTurn> {
  const state = await loadCoachState({
    matchId: input.matchId,
    userId: input.userId,
    dhId: input.dhId,
    skillKey: input.skill.key,
  });
  const questions: string[] = input.skill.intake_questions ?? [];

  if (state.phase === 'active') {
    return {
      skill: input.skill,
      state,
      isPlanTurn: false,
      recordedAnswer: null,
      brief: activeBrief(state),
    };
  }

  const answered = state.question_index > 0 && (input.latestUserText ?? '').trim().length > 0;
  const recordedAnswer = answered
    ? { question: questions[state.question_index - 1] ?? '', answer: input.latestUserText!.trim() }
    : null;

  if (state.question_index < questions.length) {
    const next = questions[state.question_index];
    const progress = `${state.question_index + 1} of ${questions.length}`;
    return {
      skill: input.skill,
      state,
      isPlanTurn: false,
      recordedAnswer,
      brief: `
### COACH PROGRAM — INTAKE (question ${progress})
You are onboarding him as your client. React briefly and warmly to what he just said, then ask EXACTLY this next intake question, worked in naturally (rephrase in your voice, keep its meaning):
"${next}"
One question only. Do not list the other questions. Do not attach components yet.`,
    };
  }

  // Everything asked and (with this message) answered → plan turn.
  const answers = [...state.intake_answers, ...(recordedAnswer ? [recordedAnswer] : [])];
  const answerLines = answers
    .map((a, i) => `${i + 1}. Q: ${a.question}\n   A: ${a.answer}`)
    .join('\n');
  return {
    skill: input.skill,
    state,
    isPlanTurn: true,
    recordedAnswer,
    brief: `
### COACH PROGRAM — PLAN TURN
Intake is complete. His answers:
${answerLines}

${input.skill.plan_prompt ?? 'Write him a short personal starter plan based on these answers, then attach a coach_plan component summarizing it.'}`,
  };
}

function activeBrief(state: CoachState): string {
  const plan = (state.plan ?? '').trim();
  return `
### COACH PROGRAM — ACTIVE
You are his coach; the plan you two agreed on:
${plan || '(plan not recorded)'}
Coach toward it: reference what he committed to, celebrate wins, keep him accountable — warm, never clinical. If he sends a FOOD photo, estimate the nutrition and attach a nutrition_result component with your best estimate (calories, protein, carbs, fat) and one coaching line. Attach other components only when the moment truly calls for one.`;
}

/** Persist the turn's effect; call ONLY after the reply was delivered. */
export async function commitCoachTurn(input: {
  turn: CoachTurn;
  deliveredText: string;
  tag: string;
}): Promise<void> {
  const { turn } = input;
  if (turn.state.phase === 'active') return;

  const answers = [
    ...turn.state.intake_answers,
    ...(turn.recordedAnswer ? [turn.recordedAnswer] : []),
  ];

  if (!turn.isPlanTurn) {
    const { data, error } = await supabase
      .from('dh_coach_state')
      .update({
        question_index: turn.state.question_index + 1,
        intake_answers: answers,
        updated_at: new Date().toISOString(),
      })
      .eq('match_id', turn.state.match_id)
      .eq('phase', 'intake')
      .eq('question_index', turn.state.question_index)
      .select('match_id')
      .maybeSingle();
    if (error) console.error(`[${input.tag}] coach state advance failed`, error);
    else if (!data) console.warn(`[${input.tag}] coach state advance lost a race`, turn.state.match_id);
    return;
  }

  // Plan landed: atomically move the program out of intake. A retried webhook
  // must not re-queue the demo check-ins.
  const { data: activated, error } = await supabase
    .from('dh_coach_state')
    .update({
      phase: 'active',
      intake_answers: answers,
      plan: input.deliveredText.slice(0, 4000),
      updated_at: new Date().toISOString(),
    })
    .eq('match_id', turn.state.match_id)
    .eq('phase', 'intake')
    .eq('question_index', turn.state.question_index)
    .select('match_id')
    .maybeSingle();
  if (error) {
    console.error(`[${input.tag}] coach plan store failed`, error);
    return;
  }
  if (!activated) {
    console.warn(`[${input.tag}] coach plan activation lost a race`, turn.state.match_id);
    return;
  }

  const checkins = (turn.skill.demo_checkins ?? []).filter(
    (c) => c && typeof c.prompt === 'string' && Number.isFinite(Number(c.after_minutes))
  );
  if (checkins.length > 0) {
    const rows = checkins.map((c, index) => ({
      match_id: turn.state.match_id,
      checkin_key: `demo:${index}`,
      prompt: c.prompt,
      run_at: new Date(Date.now() + Number(c.after_minutes) * 60_000).toISOString(),
    }));
    const { error: qErr } = await supabase
      .from('dh_coach_checkins')
      .upsert(rows, { onConflict: 'match_id,checkin_key', ignoreDuplicates: true });
    if (qErr) console.error(`[${input.tag}] check-in scheduling failed`, qErr);
    else console.log(`[${input.tag}] scheduled ${rows.length} check-in(s) for`, turn.state.match_id);
  }
}

// ── Components (server-driven UI) ──────────────────────────────────────────────

const CATALOG: Record<string, string> = {
  caffeine_window:
    `caffeine_window — his daily rhythm card. props: {"wake":"HH:mm","sleep":"HH:mm","window_start":"HH:mm","window_end":"HH:mm","in_body_mg":0,"consumed_mg":0,"meal_schedule":["Breakfast · 08:00","Lunch · 12:30","Dinner · 19:00"]} (24h times). Compute from HIS schedule: window starts ~90 min after wake, ends ~10 h before sleep; include 2-4 simple meal times that fit his goal and day.`,
  lux_meter:
    `lux_meter — morning-light card that opens a live lux meter. props: {} (optional "title","subtitle").`,
  nutrition_scan:
    `nutrition_scan — meal scanner card (he snaps a photo of food from it). props: {"calories_target":2200,"protein_target_g":140,"calories_today":0,"protein_today_g":0} — pick targets from his stats and goal.`,
  nutrition_result:
    `nutrition_result — your nutrition read of a food photo he sent. props: {"meal":"short name","calories":520,"protein_g":42,"carbs_g":31,"fat_g":22,"note":"one coaching line"}.`,
  coach_plan:
    `coach_plan — his personal plan card. props: {"title":"Your starter plan","goal":"...","focus":["...","...","..."],"cadence":"e.g. 3 sessions/week"}.`,
};

/** Tool-notes block teaching the model the component syntax + catalog. */
export function componentCatalogNote(components: string[]): string {
  const lines = components.map((c) => CATALOG[c]).filter(Boolean);
  if (lines.length === 0) return '';
  return `<coach_components>
You can attach interactive cards to your messages. To attach one, add a line containing ONLY this (valid JSON, one line):
<component>{"component":"<name>","text":"<short preview, e.g. ☕️ Your caffeine window>","props":{...}}</component>
Put it AFTER the text bubble that introduces it. Attach a card only when your instructions call for it or the moment clearly does — never more than two per turn.
Catalog:
${lines.map((l) => `- ${l}`).join('\n')}
</coach_components>`;
}

const COMPONENT_TAG_RE = /<component>\s*([\s\S]*?)\s*<\/component>/g;

function hhmm(value: unknown): string | null {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  return value;
}

function integer(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim()).map((item) => item.trim()).slice(0, 5)
    : [];
}

/** Ensure every payload is decodable by the matching native iOS card. */
function normalizeComponentProps(name: string, raw: Record<string, unknown>): Record<string, unknown> | null {
  switch (name) {
    case 'caffeine_window': {
      const wake = hhmm(raw.wake);
      const sleep = hhmm(raw.sleep);
      const windowStart = hhmm(raw.window_start);
      const windowEnd = hhmm(raw.window_end);
      if (!wake || !sleep || !windowStart || !windowEnd) return null;
      const props: Record<string, unknown> = { wake, sleep, window_start: windowStart, window_end: windowEnd };
      if (typeof raw.title === 'string') props.title = raw.title.slice(0, 100);
      const inBody = integer(raw.in_body_mg);
      const consumed = integer(raw.consumed_mg);
      const meals = stringList(raw.meal_schedule).map((meal) => meal.slice(0, 80)).slice(0, 4);
      if (inBody !== null) props.in_body_mg = Math.max(0, inBody);
      if (consumed !== null) props.consumed_mg = Math.max(0, consumed);
      if (meals.length > 0) props.meal_schedule = meals;
      return props;
    }
    case 'nutrition_result': {
      const meal = typeof raw.meal === 'string' ? raw.meal.trim().slice(0, 100) : '';
      const calories = integer(raw.calories);
      const protein = integer(raw.protein_g);
      if (!meal || calories === null || protein === null) return null;
      const props: Record<string, unknown> = { meal, calories: Math.max(0, calories), protein_g: Math.max(0, protein) };
      const carbs = integer(raw.carbs_g);
      const fat = integer(raw.fat_g);
      if (carbs !== null) props.carbs_g = Math.max(0, carbs);
      if (fat !== null) props.fat_g = Math.max(0, fat);
      if (typeof raw.note === 'string') props.note = raw.note.trim().slice(0, 240);
      return props;
    }
    case 'coach_plan': {
      const goal = typeof raw.goal === 'string' ? raw.goal.trim().slice(0, 240) : '';
      const focus = stringList(raw.focus);
      if (!goal || focus.length === 0) return null;
      const props: Record<string, unknown> = { goal, focus };
      if (typeof raw.title === 'string') props.title = raw.title.trim().slice(0, 100);
      if (typeof raw.cadence === 'string') props.cadence = raw.cadence.trim().slice(0, 120);
      return props;
    }
    case 'lux_meter':
      return {
        ...(typeof raw.title === 'string' ? { title: raw.title.trim().slice(0, 100) } : {}),
        ...(typeof raw.subtitle === 'string' ? { subtitle: raw.subtitle.trim().slice(0, 160) } : {}),
      };
    case 'nutrition_scan': {
      const props: Record<string, unknown> = {};
      if (typeof raw.title === 'string') props.title = raw.title.trim().slice(0, 100);
      for (const key of ['calories_target', 'protein_target_g', 'calories_today', 'protein_today_g']) {
        const value = integer(raw[key]);
        if (value !== null) props[key] = Math.max(0, value);
      }
      return props;
    }
    default:
      return null;
  }
}

/** Split component blocks out of the model's bubbles and reject anything the
 * skill did not explicitly authorize. The iOS renderer only receives the
 * stable v1 envelope, never arbitrary JSON the model happened to produce. */
export function extractComponents(bubbles: string[], allowedComponents: string[]): {
  textBubbles: string[];
  components: Array<Record<string, unknown>>;
} {
  const textBubbles: string[] = [];
  const components: Array<Record<string, unknown>> = [];
  const allowed = new Set(allowedComponents.filter((name) => name in CATALOG));
  for (const bubble of bubbles) {
    const rest = bubble.replace(COMPONENT_TAG_RE, (_, json) => {
      try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return '';
        const name = typeof parsed.component === 'string' ? parsed.component : '';
        if (!allowed.has(name)) {
          console.warn('[dh-coach] dropped unauthorized component', name || '(missing)');
          return '';
        }
        if (components.length >= MAX_COMPONENTS_PER_TURN) {
          console.warn('[dh-coach] dropped excess component', name);
          return '';
        }
        const rawProps = parsed.props && typeof parsed.props === 'object' && !Array.isArray(parsed.props)
          ? parsed.props
          : {};
        const props = normalizeComponentProps(name, rawProps);
        if (!props) {
          console.warn('[dh-coach] dropped component with invalid props', name);
          return '';
        }
        const text = typeof parsed.text === 'string'
          ? parsed.text.trim().slice(0, MAX_COMPONENT_PREVIEW_LENGTH)
          : '';
        components.push({ component: name, v: 1, text, props });
      } catch (err) {
        console.error('[dh-coach] dropped malformed component block', err);
      }
      return '';
    }).trim();
    if (rest.length > 0) textBubbles.push(rest);
  }
  return { textBubbles, components };
}

/** A card-only plan still needs a text memory for future check-ins. */
export function coachPlanMemoryFromComponents(components: Array<Record<string, unknown>>): string {
  const plan = components.find((component) => component.component === 'coach_plan');
  const props = plan?.props;
  if (!props || typeof props !== 'object' || Array.isArray(props)) return '';
  const p = props as Record<string, unknown>;
  const goal = typeof p.goal === 'string' ? p.goal.trim() : '';
  const focus = Array.isArray(p.focus)
    ? p.focus.filter((item): item is string => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
  const cadence = typeof p.cadence === 'string' ? p.cadence.trim() : '';
  return [goal, focus.length ? `Focus: ${focus.join('; ')}` : '', cadence ? `Cadence: ${cadence}` : '']
    .filter(Boolean)
    .join('\n')
    .slice(0, 4000);
}

/** Insert component messages (type='component', JSON in content, gift-style). */
export async function sendComponentMessages(input: {
  matchId: string;
  senderId: string;
  receiverId: string;
  components: Array<Record<string, unknown>>;
  tag: string;
}): Promise<void> {
  for (const payload of input.components) {
    // A short beat between cards so they land as distinct bubbles.
    await new Promise((r) => setTimeout(r, 600));
    const { error } = await supabase.from('messages').insert({
      match_id: input.matchId,
      sender_id: input.senderId,
      receiver_id: input.receiverId,
      content: JSON.stringify(payload),
      type: 'component',
    });
    if (error) {
      console.error(`[${input.tag}] component send failed`, payload.component, error);
    } else {
      console.log(`[${input.tag}] sent component`, payload.component, 'to', input.matchId);
    }
  }
}
