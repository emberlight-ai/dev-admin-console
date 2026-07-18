// Validation for the ops-declared tracker/check-in surface of a skill
// (Skills v2). The edge engine consumes these rows verbatim — anything that
// gets past here reaches the extractor's JSON schema — so parse strictly and
// reject rather than coerce.

export const TRACKER_AGGREGATES = ['none', 'latest', 'latest_per_subject', 'sum_today', 'count_7d'] as const;
export const CHECK_IN_SLOTS = ['morning', 'lunch', 'evening'] as const;

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
