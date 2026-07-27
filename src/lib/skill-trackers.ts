// Validation for the ops-declared tracker/check-in surface of a skill
// (Skills v2). The edge engine consumes these rows verbatim — anything that
// gets past here reaches the extractor's JSON schema — so parse strictly and
// reject rather than coerce.

export const TRACKER_AGGREGATES = ['none', 'latest', 'latest_per_subject', 'sum_today', 'count_7d'] as const;
export const CHECK_IN_SLOTS = ['morning', 'lunch', 'evening'] as const;
export const COACH_COMPONENTS = ['caffeine_window', 'lux_meter', 'nutrition_scan', 'nutrition_result', 'coach_plan'] as const;

const MAX_INTAKE_QUESTIONS = 12;
const MAX_DEMO_CHECKINS = 10;

export type TrackerInput = {
  key: string;
  title: string;
  value_schema: Record<string, string>;
  cadence: string;
  aggregate: (typeof TRACKER_AGGREGATES)[number];
  value_path: string | null;
};

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * Parse a replace-all `trackers` array from the admin request body.
 * Returns rows ready for insert (minus skill_key), or an error string.
 */
export function parseTrackers(raw: unknown): { rows: TrackerInput[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'trackers must be an array' };
  const rows: TrackerInput[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { error: 'Every datapoint must be an object' };
    }
    const t = item as Record<string, unknown>;
    const title = typeof t.title === 'string' ? t.title.trim() : '';
    if (!title) return { error: 'Every datapoint needs a title' };
    const key = typeof t.key === 'string' && t.key.trim() ? slugify(t.key) : slugify(title);
    if (!key) return { error: `Could not derive a key for "${title}"` };
    if (seen.has(key)) return { error: `Duplicate datapoint key "${key}"` };
    seen.add(key);

    const schemaRaw = t.value_schema;
    if (!schemaRaw || typeof schemaRaw !== 'object' || Array.isArray(schemaRaw)) {
      return { error: `"${title}" needs at least one field` };
    }
    const value_schema: Record<string, string> = {};
    for (const [name, desc] of Object.entries(schemaRaw as Record<string, unknown>)) {
      const field = slugify(name);
      if (!field) {
        if (name.trim()) return { error: `Field name "${name}" of "${title}" has no usable characters` };
        continue;
      }
      if (field in value_schema) {
        return { error: `"${title}" has two fields that both normalize to "${field}"` };
      }
      if (typeof desc !== 'string' || !desc.trim()) {
        return { error: `Field "${name}" of "${title}" needs a description` };
      }
      value_schema[field] = desc.trim();
    }
    if (Object.keys(value_schema).length === 0) return { error: `"${title}" needs at least one field` };

    const aggregate = TRACKER_AGGREGATES.includes(t.aggregate as never)
      ? (t.aggregate as TrackerInput['aggregate'])
      : null;
    if (!aggregate) return { error: `"${title}" has an invalid aggregate` };

    let value_path: string | null = null;
    if (aggregate === 'sum_today') {
      value_path = typeof t.value_path === 'string' ? slugify(t.value_path) : '';
      if (!value_path || !(value_path in value_schema)) {
        return { error: `"${title}" sums per day — pick which field to add up` };
      }
    }
    // Cadence is informational (unused by the engine) but must round-trip, or
    // replace-all saves would silently reset it.
    const cadence = typeof t.cadence === 'string' && t.cadence.trim() ? t.cadence.trim() : 'free';
    rows.push({ key, title, value_schema, cadence, aggregate, value_path });
  }
  return { rows };
}

/**
 * Parse the check-in fields (`check_in_slots`, `check_in_prompt`) from a
 * request body into a skills-table patch. Only touches keys present in `b`.
 */
export function parseCheckIns(b: Record<string, unknown>): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};
  if ('check_in_slots' in b) {
    if (!Array.isArray(b.check_in_slots)) return { error: 'check_in_slots must be an array' };
    const slots = [...new Set(b.check_in_slots.filter((s): s is string => typeof s === 'string'))];
    if (slots.some((s) => !CHECK_IN_SLOTS.includes(s as never))) {
      return { error: `check_in_slots must be among: ${CHECK_IN_SLOTS.join(', ')}` };
    }
    // Store in slot order so the UI and engine read them consistently.
    patch.check_in_slots = CHECK_IN_SLOTS.filter((s) => slots.includes(s));
  }
  if ('check_in_prompt' in b) {
    patch.check_in_prompt =
      typeof b.check_in_prompt === 'string' && b.check_in_prompt.trim() ? b.check_in_prompt.trim() : null;
  }
  return { patch };
}

/**
 * Parse the coach-program fields (`intake_questions`, `plan_prompt`,
 * `demo_checkins`, `components`) from a request body into a skills-table
 * patch. Only touches keys present in `b`. A skill with non-empty
 * intake_questions runs a coach program (see docs/coach-programs.md):
 * intake one question per turn → plan → scheduled check-ins.
 */
export function parseCoachProgram(b: Record<string, unknown>): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};
  if ('intake_questions' in b) {
    if (!Array.isArray(b.intake_questions)) return { error: 'intake_questions must be an array' };
    if (b.intake_questions.length > MAX_INTAKE_QUESTIONS) {
      return { error: `At most ${MAX_INTAKE_QUESTIONS} intake questions` };
    }
    const questions: string[] = [];
    for (const q of b.intake_questions) {
      if (typeof q !== 'string' || !q.trim()) return { error: 'Every intake question must be a non-empty string' };
      questions.push(q.trim());
    }
    patch.intake_questions = questions;
  }
  if ('plan_prompt' in b) {
    patch.plan_prompt = typeof b.plan_prompt === 'string' && b.plan_prompt.trim() ? b.plan_prompt.trim() : null;
  }
  if ('demo_checkins' in b) {
    if (!Array.isArray(b.demo_checkins)) return { error: 'demo_checkins must be an array' };
    if (b.demo_checkins.length > MAX_DEMO_CHECKINS) {
      return { error: `At most ${MAX_DEMO_CHECKINS} scheduled check-ins` };
    }
    const checkins: { after_minutes: number; prompt: string }[] = [];
    for (const item of b.demo_checkins) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return { error: 'Every check-in must be an object' };
      }
      const c = item as Record<string, unknown>;
      const after = typeof c.after_minutes === 'number' && Number.isFinite(c.after_minutes) ? c.after_minutes : NaN;
      if (!(after > 0)) return { error: 'Every check-in needs a positive after_minutes' };
      const prompt = typeof c.prompt === 'string' ? c.prompt.trim() : '';
      if (!prompt) return { error: 'Every check-in needs a prompt' };
      checkins.push({ after_minutes: after, prompt });
    }
    patch.demo_checkins = checkins;
  }
  if ('components' in b) {
    if (!Array.isArray(b.components)) return { error: 'components must be an array' };
    const comps = [...new Set(b.components.filter((c): c is string => typeof c === 'string'))];
    if (comps.some((c) => !COACH_COMPONENTS.includes(c as never))) {
      return { error: `components must be among: ${COACH_COMPONENTS.join(', ')}` };
    }
    // Store in catalog order so the UI and prompt read them consistently.
    patch.components = COACH_COMPONENTS.filter((c) => comps.includes(c));
  }
  return { patch };
}
