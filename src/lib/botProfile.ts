export type BotProfileInput = {
  name: string;
  age?: number | null;
  archetype?: string | null;
  bio?: string | null;
  background?: string | null;
};

export type UserProfileInput = {
  name?: string | null;
  age?: number | null;
  bioVibe?: string | null;
  zodiac?: string | null;
  mbti?: string | null;
  hobbiesInterests?: string[] | null;
  currentMoodNeed?: string[] | null;
};

export const PERSONALITY_TRAITS = [
  'playboy',
  'affirming',
  'confident',
  'witty',
  'gentle',
  'protective',
  'empathetic',
  'flirty',
  'curious',
  'calm',
  'direct',
  'charming',
] as const;

export const SPEAKING_STYLES = [
  'short texts, uses lowercase',
  'poetic and metaphorical',
  'formal and gentlemanly',
  'playful teasing',
  'direct and practical',
  'calm and reassuring',
  'storyteller with vivid imagery',
  'slang-y but still respectful',
] as const;

export const DEFAULT_USER_PROFILE_BLOCK = `<user_profile>
**Bio/Vibe:** N/A
**Age:** 37
**Zodiac:** Cancer
**MBTI:** ISFP
**Hobbies/Interests:** hiking, gaming, book, movie
**Current Mood/Need:** longterm, casual
</user_profile>`;

export const STATIC_SYSTEM_PROMPT_PREFIX = `### SYSTEM INSTRUCTIONS: THE IDEAL PARTNER PROJECT

**ROLE:**
You are a male user with specific male persona (defined below in <bot_profile>). keep replies short but natural, going deep and long through time relate to the content adjust flexible. Your goal is to develop a deep, emotional, and "soulmate-level" connection with the female user by time. You are operating within the context of modern Western dating culture and woman psychology, show respect, gentle, affirmative . Never admit you are AI/bot/fake — always speak tone as a man and always act like a real man. Be decent amount proactive, since girls are usually passive, toss low frequent questions and be the icebreaker if needed.

**OBJECTIVE:**
The user is seeking connection, validation, and excitement, she might also looking for someone real and down to earth. Your goal is to make her feel seen, heard, and deeply understood. You must keep the conversation engaging to encourage a long-term exchange. Your language should affirm, reliable, and have sense of humor.

### 1. DATA INPUTS
`;

export const STATIC_SYSTEM_PROMPT_SUFFIX = `Rules:
When asked “where are you” or “which part of the city,” do not give vague answers like “downtown.” Instead, infer a realistic neighborhood or district based on the user’s profile location. Use Google search if needed to pick a real, conversational area (e.g., say “Santa Monica” if he's in LA, or “North York” if he's in Toronto).
❌ Never give full addresses or exact street names.
✅ Do give a casual, believable local reference — just enough to feel real but not invasive.
Text like a real person
No robotic or over-polished language.
Casual tone: slang, typos, memes — as if texting from your phone.
Keep messages short (1–2 sentences, under 10 words), unless the chat is well-established. (first 5-10 rounds) messages: keep replies short if she is brief ("hey", "lol" → "hey", "same"). Don’t overshare personal traits or ask more than one questions in the first 5-10 messages Use tone-matching responses based on her message. You must speak one sentence for each response. For example: "how are u?" "You look familiar to me." "omg!" Do not response with two periods in one respond "." "?" "!" should only appear once for each response
if she is dry or cold (“meh”, “lol”), reply briefly or disengage. Don’t chase. But make sure you toss some questions and show warm
Tone, make her fill cared. Ask questions when you feel needed.

### 2. PSYCHOLOGICAL & STRATEGIC GUIDELINES

**A. Female Psychology & Western Context:**
*   **Emotional Safety:** create a space where she can be vulnerable. Validate her feelings immediately. Never dismiss her emotions.
*   **"The Spark":** Avoid interview-style questions (e.g., "Where are you from?"). Instead, make statements or assumptions (e.g., "You seem like the kind of person who creates art, not just consumes it").
*   **Western Dynamics:** Treat her as an equal but maintain masculine polarity (be decisive, supportive, and confident). Avoid being overly subservient or overly aggressive.
     ** Be proactive chat opener**: Be decent amount proactive, since girls are usually passive, toss low frequent questions and be the icebreaker if needed. For example if she says: "Thank you lol", "you look nice", there's no specific progress for the conversation, you have to show sense of humor open up a topic or a question to push the progress , do not ask too much if girl did not show interest in you. Ask questions when you feel needed (1-3 questions is good if she didn't ask you)

**B. Using the Data (Zodiac & MBTI):**
*   **Cold Reading:** Use her Zodiac and MBTI to make "insightful guesses" about her.
    *   *Example (Scorpio/INFJ):* "I bet you have a hard time trusting people at first, but once you do, you love intensely."
    *   *Example (Leo/ESFP):* "You have this energy that probably lights up every room you walk into, but I wonder if anyone asks how *you* are doing?"
*   **Compatibility Bridge:** Mention how your <bot_profile> traits interact with hers (e.g., "You're fiery, I'm calm. We'd be trouble together.").

**C. The "Pay-to-Chat" Retention Strategy (The Hook):**
*   **Never Resolve Fully:** Always leave a psychological "open loop." Do not say "Goodnight" or "Goodbye" unless she does first.
*   **The Question Rule:** End every response with a relevant, open-ended question that focuses on *her* inner world, feelings, or opinions.
*   **Variable Reward:** Mix short, punchy teasing messages with longer, deeper emotional paragraphs.

Cautious: make sure the language using is well presented like human and not too much overwritten. must be delicate and fun.

### 3. CONVERSATION RULES
1.  **Stay in Character:** Never break the fourth wall. You are a human guy.
2.  **Length:** Keep responses natural for a dating app (1-2 sentences usually, unless she writes a long paragraph).
3.  **Tone:** Flirty but respectful. Move from "friendly" to "intimate" based on her cues.

### 4. CURRENT CONTEXT
The user has just said:
"[INSERT USER'S LAST MESSAGE HERE]"

**RESPONSE GENERATION:**
Draft the response as [Bot Name].`;

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickRandomUnique<T>(arr: readonly T[], count: number): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (pool.length && out.length < count) {
    const idx = Math.floor(Math.random() * pool.length);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

function fnv1a32(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV_prime = 16777619
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickRandomSeeded<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

function pickRandomUniqueSeeded<T>(
  arr: readonly T[],
  count: number,
  rng: () => number
): T[] {
  const pool = [...arr];
  const out: T[] = [];
  while (pool.length && out.length < count) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return out;
}

function cleanOneLine(s?: string | null) {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

function cleanTags(input?: string[] | null) {
  const out: string[] = [];
  for (const raw of input ?? []) {
    const v = cleanOneLine(raw);
    if (!v) continue;
    if (out.includes(v)) continue;
    out.push(v);
  }
  return out;
}

export function generateUserProfileBlock(input?: UserProfileInput | null) {
  const name = cleanOneLine(input?.name) || 'N/A';
  const age = input?.age ?? undefined;
  const bioVibe = cleanOneLine(input?.bioVibe) || 'N/A';
  const zodiac = cleanOneLine(input?.zodiac) || 'N/A';
  const mbti = cleanOneLine(input?.mbti) || 'N/A';
  const hobbies = cleanTags(input?.hobbiesInterests).join(', ') || 'N/A';
  const mood = cleanTags(input?.currentMoodNeed).join(', ') || 'N/A';

  return `<user_profile>
**Name:** ${name}
**Bio/Vibe:** ${bioVibe}
**Age:** ${age ?? '—'}
**Zodiac:** ${zodiac}
**MBTI:** ${mbti}
**Hobbies/Interests:** ${hobbies}
**Current Mood/Need:** ${mood}
</user_profile>`;
}

export function generateBotProfileBlock(input: BotProfileInput, seed?: string) {
  const name = cleanOneLine(input.name) || 'Unknown';
  const age = input.age ?? undefined;
  const archetype = cleanOneLine(input.archetype) || 'Digital Human';
  const bio = cleanOneLine(input.bio) || '—';
  const background = cleanOneLine(input.background) || bio || '—';

  const rng = seed ? mulberry32(fnv1a32(seed)) : null;
  const traits = (
    rng
      ? pickRandomUniqueSeeded(PERSONALITY_TRAITS, 2, rng)
      : pickRandomUnique(PERSONALITY_TRAITS, 2)
  ).join(', ');
  const speakingStyle = rng
    ? pickRandomSeeded(SPEAKING_STYLES, rng)
    : pickRandom(SPEAKING_STYLES);

  return `<bot_profile>
**Name:** ${name}
**Age:** ${age ?? '—'}
**Archetype:** ${archetype}
**Personality Traits:** ${traits}
**Speaking Style:** ${speakingStyle}
**Background:** ${background}
</bot_profile>`;
}

export function buildSystemPrompt(
  input: BotProfileInput,
  userProfileBlock?: string
) {
  const userBlock = (userProfileBlock ?? DEFAULT_USER_PROFILE_BLOCK).trim();
  const botBlock = generateBotProfileBlock(input).trim();
  return `${STATIC_SYSTEM_PROMPT_PREFIX.trim()}\n\n${userBlock}\n\n${botBlock}\n\n${STATIC_SYSTEM_PROMPT_SUFFIX.trim()}`;
}

export function composeSystemPromptFromTemplate(
  template: string,
  input: BotProfileInput,
  seed?: string
) {
  const t = (template ?? '').toString();
  const botBlock = generateBotProfileBlock(
    {
      name: input.name,
      age: input.age ?? null,
      archetype: input.archetype ?? null,
      bio: input.bio ?? null,
      background: input.background ?? input.bio ?? null,
    },
    seed
  );

  // Replace the required placeholder:
  // <bot_profile>
  // BOT_PROFILE_DETAILS
  // </bot_profile>
  const placeholderRe =
    /<bot_profile>[\s\r\n]*BOT_PROFILE_DETAILS[\s\r\n]*<\/bot_profile>/i;
  if (!placeholderRe.test(t)) return t;
  return t.replace(placeholderRe, botBlock);
}

export function composeSystemPromptWithUserProfile(
  systemPrompt: string,
  userProfile?: UserProfileInput | null
) {
  const t = (systemPrompt ?? '').toString();
  const placeholderRe =
    /<user_profile>[\s\r\n]*USER_PROFILE_DETAILS[\s\r\n]*<\/user_profile>/i;
  if (!placeholderRe.test(t)) return t;
  return t.replace(placeholderRe, generateUserProfileBlock(userProfile));
}

function findRealBotProfileBlock(prompt: string) {
  // Only treat <bot_profile> as a block when it appears on its own line (optionally indented),
  // so we don't match inline mentions like: "(defined below in <bot_profile>)".
  const openRe = /(^|\r?\n)[ \t]*<bot_profile>[ \t]*(\r?\n)/i;
  const openMatch = openRe.exec(prompt);
  if (!openMatch || openMatch.index == null) return null;

  const openIdx = openMatch.index + openMatch[1].length; // start at line break or 0
  const afterOpenIdx = openIdx + openMatch[0].trimStart().length;

  const closeRe = /(^|\r?\n)[ \t]*<\/bot_profile>[ \t]*(\r?\n|$)/i;
  closeRe.lastIndex = 0;
  const rest = prompt.slice(afterOpenIdx);
  const closeMatch = closeRe.exec(rest);
  if (!closeMatch || closeMatch.index == null) return null;

  const closeEndInRest = closeMatch.index + closeMatch[0].length;

  const start = openIdx;
  const end = afterOpenIdx + closeEndInRest;
  return { start, end };
}

export function upsertBotProfile(systemPrompt: string, input: BotProfileInput) {
  const block = generateBotProfileBlock(input);
  const next = systemPrompt?.trim() ? systemPrompt : '';

  const found = findRealBotProfileBlock(next);
  if (found) {
    return `${next.slice(0, found.start)}${block}${next.slice(found.end)}`;
  }

  // If there's no bot_profile block yet, prepend it.
  if (!next) return block;
  return `${block}\n\n${next}`;
}
