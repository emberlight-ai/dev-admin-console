// @ts-nocheck
// Context assembly: one composer for the system prompt (no regex placeholder
// spaghetti — placeholder stanzas are defensively stripped, real blocks are
// appended), the transcript builder, and the single consolidated texting brief.
import type { UserRow } from './store.ts';

// ── Transcript ─────────────────────────────────────────────────────────────────
// `dhPhotoCaptions` maps message_id -> caption for photos the DH herself sent,
// so she remembers sharing them.
// Gift messages store their payload as JSON in content: {gift, name, cost}.
// Render them as a human-readable beat so the model reacts to the gesture
// (and its weight) instead of seeing raw JSON.
function giftLine(content: string | null): string | null {
  if (!content || !content.startsWith('{')) return null;
  try {
    const g = JSON.parse(content);
    if (!g || typeof g.name !== 'string') return null;
    const cost = Number(g.cost);
    const worth = Number.isFinite(cost) ? ` (worth ${cost} tokens)` : '';
    return `[User sent you a gift: ${g.name}${worth}]`;
  } catch {
    return null;
  }
}

export function buildTranscript(
  messages: Array<{ id?: string; sender_id: string; content: string | null; media_url?: string | null; image_desc?: string | null; type?: string | null }>,
  botUserId: string,
  botName: string,
  dhPhotoCaptions: Map<string, string | null> = new Map()
): string {
  return messages
    .map((m) => {
      const isBot = m.sender_id === botUserId;
      const speaker = isBot ? botName : 'User';
      if (m.type === 'gift') {
        const line = giftLine(m.content) ?? '[User sent you a gift]';
        return `${speaker}: ${line}`;
      }
      // Component messages (coach cards) carry JSON — replay as a readable beat.
      if (m.type === 'component') {
        let name = 'interactive';
        try { name = JSON.parse(m.content ?? '{}').component ?? name; } catch { /* keep default */ }
        return `${speaker}: ${isBot ? `[You sent him your ${name} card]` : `[Sent a ${name} card]`}`;
      }
      let text = m.content || '';
      if (m.media_url) {
        if (isBot) {
          const cap = m.id ? dhPhotoCaptions.get(m.id) : null;
          text += cap
            ? `\n[You sent a photo of yourself: ${cap}]`
            : `\n[You sent a photo of yourself]`;
        } else if (m.image_desc) {
          text += `\n[User sent an image described as: ${m.image_desc}]`;
        } else {
          text += `\n[User sent an image]`;
        }
      }
      return `${speaker}: ${text.trim()}`;
    })
    .join('\n');
}

// ── Local time ─────────────────────────────────────────────────────────────────
// Computed server-side from the stored IANA timezone; falls back to Pacific.
const DEFAULT_TZ = 'America/Los_Angeles';
export function describeLocalTime(timezone?: string | null): string {
  const tz = timezone || DEFAULT_TZ;
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(now);
    const get = (t: string) => parts.find((x) => x.type === t)?.value ?? '';
    const h23 = Number(
      new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now)
    );
    const partOfDay =
      h23 < 5 ? 'late at night' : h23 < 12 ? 'in the morning' : h23 < 17 ? 'in the afternoon' : h23 < 21 ? 'in the evening' : 'at night';
    const approx = timezone ? '' : ' (approx — timezone unknown)';
    return `${get('weekday')} ${get('hour')}:${get('minute')} ${get('dayPeriod')}, ${partOfDay}${approx}`;
  } catch {
    return new Date().toISOString();
  }
}

// ── Identity / profile blocks ──────────────────────────────────────────────────
// `interests` are the DH's identity tags (already filtered: active, non-admin)
// — the same tags that drive the iOS Explore categories, finally shaping the
// conversation too.
function botProfileBlock(bot: UserRow, interests: string[] = []): string {
  const into = interests.length ? `\n**Into:** ${interests.join(', ')}` : '';
  return `<bot_profile>
**Name:** ${bot.username || 'Unknown'}
**Age:** ${bot.age ?? '—'}
**Archetype:** ${bot.profession || 'Digital Human'}
**Background:** ${bot.bio || '—'}${into}
</bot_profile>`;
}

function userProfileBlock(human: UserRow): string {
  return `<user_profile>
**Username:** ${human.username || 'N/A'}
**Bio:** ${human.bio || 'N/A'}
**Age:** ${human.age ?? '—'}
**Location:** ${human.location_name || 'Unknown'}
**Profession:** ${human.profession || 'N/A'}
**Their local time right now:** ${describeLocalTime(human.timezone)}
</user_profile>`;
}

// Templates may still carry placeholder stanzas from the interpolation era —
// strip them defensively (no data migration needed) and append real blocks.
const PLACEHOLDER_RES = [
  /\n*<bot_profile>[\s\r\n]*BOT_PROFILE_DETAILS[\s\r\n]*<\/bot_profile>\n*/gi,
  /\n*<user_profile>[\s\r\n]*USER_PROFILE_DETAILS[\s\r\n]*<\/user_profile>\n*/gi,
  /\n*(?:#{1,6}\s*DATA INPUTS[^\n]*\n+)?<bot_storyline>[\s\S]*?<\/bot_storyline>\n*/gi,
];

function stripPlaceholders(template: string): string {
  let out = template;
  for (const re of PLACEHOLDER_RES) out = out.replace(re, '\n');
  return out;
}

// ── Texting brief: ONE consolidated voice (craft + stage + length) ─────────────
// Replaces the stacked CRAFT_RULES + stage guidance + length directive that
// used to fight each other and the persona.
export function textingBrief(input: {
  stage: 'first-chat' | 'established';
  shortUser: boolean;
  lastUserWords: number;
}): string {
  const stageLines =
    input.stage === 'first-chat'
      ? `- STAGE: FIRST CHAT — you two are still strangers. Be a curious, flirty stranger: react briefly to what he said, then ONE light getting-to-know-him question is the RIGHT move (his job, what he's looking for, his week, where he's from). Introduce yourself in DROPS — one small true detail at a time, usually attached to your question.`
      : `- STAGE: ESTABLISHED — you know each other now. Shares and callbacks beat questions: reveal something small and real from your day and let him reciprocate. A callback to an earlier detail lands better than any new topic.`;
  const lengthLine = input.shortUser
    ? `- His last message was only ${input.lastUserWords} word(s): reply with EXACTLY ONE short bubble, roughly matching his length — a quick reaction, tease, or (in first chat) one light question.`
    : `- Reply with 1-3 bubbles (separate bubbles with a blank line). Most turns deserve 1-2; use 3 only when telling a small story.`;
  return `
### HOW YOU TEXT — this brief OVERRIDES any earlier style rules it conflicts with
- TEXT LIKE A PERSON TYPES ON A PHONE, not like prose. Fragments are fine. Lowercase starts are fine. Never write like a letter — "flowers huh" beats a paragraph.
- MATCH HIS LENGTH — hard rule: short message from him = one short bubble from you. You earn more bubbles only when HE writes more.
- At most ONE question mark across ALL bubbles this turn. If your previous turn ended with a question, end this one with a statement.
- If he's low-effort ("yeah", "ok", "lol"), do NOT fire another question — toss out something SMALL to react to and leave room.
- React to what he actually said before steering anywhere new. Never restart with a greeting mid-conversation, never repeat a sentence shape you used recently.
${stageLines}
${lengthLine}`;
}

// ── System prompt composer ─────────────────────────────────────────────────────
// Cache-friendly order, static → dynamic: persona prose, then skill blocks
// (static per character), then identity blocks, then the per-turn tail (user
// profile with live local time + brief).
export function buildSystemPrompt(input: {
  template: string;
  bot: UserRow;
  human: UserRow;
  brief: string;
  toolNotes?: string;
  /** Skill prompt decorations, pre-sorted by skills.sort_order. */
  skillBlocks?: string[];
  /** DH identity tags (active, non-admin interests). */
  botInterests?: string[];
  /** Computed tracker state (Skills v2) — trusted numbers, never re-derived. */
  trackerContext?: string | null;
}): string {
  const parts = [stripPlaceholders(input.template).trim()];
  for (const block of input.skillBlocks ?? []) {
    const b = block.trim();
    if (b) parts.push(b);
  }
  parts.push(botProfileBlock(input.bot, input.botInterests ?? []));
  const storyline = (input.bot.storyline ?? '').trim();
  if (storyline) parts.push(`<bot_storyline>\n${storyline}\n</bot_storyline>`);
  if (input.trackerContext) parts.push(input.trackerContext);
  parts.push(userProfileBlock(input.human));
  if (input.toolNotes) parts.push(input.toolNotes);
  parts.push(input.brief);
  return parts.join('\n\n');
}
