import { NextResponse } from 'next/server';
import { generateGeminiContent } from '@/lib/gemini';

export const runtime = 'nodejs';
// Never cache — every call must return a different review.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Dimensions we randomly sample from to make every prompt unique.
 * By composing a different theme + tone + length + persona + seed on every
 * request, Gemini is pushed to generate a fresh compliment each time instead
 * of converging on the same "Best app ever!" template.
 */
const REVIEW_THEMES = [
  'finding a soul mate / serious relationship success story',
  'the quality and warmth of the people you meet on the app',
  'the beautiful, modern UI and polished design details',
  "the matching feels accurate — it's like the app actually listens",
  'how refreshingly different this is from other dating apps',
  'a specific first date that went really well',
  "you kept coming back because it's genuinely fun to use",
  'encouraging the team to keep shipping updates — the app is getting better',
  'smooth and fast chat experience with real people (not bots)',
  'the vibe feels authentic and safe compared to other dating apps',
  'great profile prompts that helped you open up',
  'you finally deleted your other dating apps after trying this one',
  'meaningful connections, not just swiping for the sake of it',
  'the onboarding was easy and respectful of your time',
];

const REVIEW_TONES = [
  'warm and sincere',
  'excited and a little giddy',
  'casual, like texting a friend',
  'reflective and grateful',
  'enthusiastic with a short punchy rhythm',
  'understated — quietly impressed',
  'playful and light-hearted',
];

const REVIEW_LENGTHS = [
  { label: 'very short (1 sentence)', sentences: '1 sentence' },
  { label: 'short (2 sentences)', sentences: '2 sentences' },
  { label: 'medium (3 sentences)', sentences: '3 sentences' },
  { label: 'medium-long (4 short sentences)', sentences: '4 short sentences' },
];

const REVIEW_PERSONAS = [
  'a busy professional in their late 20s',
  'someone in their 30s who had almost given up on dating apps',
  'a first-time dating-app user',
  'someone who just moved to a new city',
  'a recent long-term-relationship convert',
  'a design-conscious iPhone user',
  'a user who values privacy and safety',
  'someone who values real conversation over endless swipes',
];

/**
 * Local fallback templates in case Gemini is unavailable. Kept intentionally
 * short and varied so the endpoint still returns a reasonable review.
 */
const FALLBACK_REVIEWS: { title: string; body: string }[] = [
  {
    title: 'Met my person on Amber',
    body: "I've tried a lot of dating apps, but Amber is the one that actually worked for me. I met someone amazing within a few weeks and we're still going strong.",
  },
  {
    title: 'Beautifully designed',
    body: 'The UI is clean, thoughtful, and easy on the eyes. You can tell real care went into this app — the little details matter.',
  },
  {
    title: 'Keep it up team',
    body: "Every update makes Amber better. Keep shipping — this is genuinely one of the best dating apps I've used.",
  },
  {
    title: 'I keep coming back',
    body: "I installed Amber out of curiosity and somehow I keep opening it every day. It's fun without being addictive in a bad way.",
  },
  {
    title: 'Real people, real conversations',
    body: "Finally, a dating app that doesn't feel like a game. The conversations feel real and the matches actually match.",
  },
  {
    title: 'Refreshing',
    body: "Amber feels different from the other apps — calmer, more intentional. I'm glad I tried it.",
  },
];

/** Deterministic-ish random pick, re-seeded each call by Date.now() + crypto entropy. */
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function randomSeed(): string {
  // Short hex seed used only to force Gemini's prompt text to differ between calls.
  // globalThis.crypto is available in the Next.js Node runtime.
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function buildPrompt(): string {
  const theme = pickRandom(REVIEW_THEMES);
  const tone = pickRandom(REVIEW_TONES);
  const length = pickRandom(REVIEW_LENGTHS);
  const persona = pickRandom(REVIEW_PERSONAS);
  const seed = randomSeed();
  const now = new Date().toISOString();

  return [
    'You are helping draft a sample 5-star App Store review for a dating app called "Amber".',
    '',
    'Write ONE short review that a real user might leave. Do NOT copy any phrasing from earlier reviews; make it feel freshly written.',
    '',
    `Reviewer persona: ${persona}.`,
    `Tone: ${tone}.`,
    `Theme / angle: ${theme}.`,
    `Length: ${length.sentences}.`,
    '',
    'Rules:',
    '- It must clearly be 5 stars in sentiment (positive, genuine, specific).',
    '- Mention "Amber" at most once. You can also refer to it as "this app".',
    '- No emojis. No hashtags. No quotation marks around the whole review.',
    '- Do not mention competitor app names.',
    '- Do not mention that you are an AI or that this is a template.',
    '- Avoid generic phrases like "best app ever" or "10/10" — be specific.',
    '- Title should be short (max 5 words).',
    '',
    `Uniqueness seed (do not mention in output): ${seed} @ ${now}`,
    '',
    'Return ONLY minified JSON in this exact shape, no markdown, no code fences:',
    '{"title":"<short title>","body":"<the review body>"}',
  ].join('\n');
}

type ReviewShape = { title: string; body: string };

function tryParseReview(text: string): ReviewShape | null {
  if (!text) return null;
  // Strip accidental ```json fences the model sometimes adds.
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  // Find the first {...} block in case the model added stray prose.
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonSlice = start !== -1 && end !== -1 ? cleaned.slice(start, end + 1) : cleaned;

  try {
    const parsed = JSON.parse(jsonSlice) as Partial<ReviewShape>;
    if (typeof parsed.title === 'string' && typeof parsed.body === 'string') {
      return { title: parsed.title.trim(), body: parsed.body.trim() };
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * GET — returns a freshly generated 5-star App Store review template.
 * Every call produces a different compliment because the underlying prompt
 * is assembled from randomly sampled theme/tone/length/persona + a random seed.
 */
export async function GET() {
  const prompt = buildPrompt();

  try {
    const text = await generateGeminiContent(prompt);
    const parsed = tryParseReview(text);

    if (parsed) {
      return NextResponse.json(
        {
          rating: 5,
          title: parsed.title,
          body: parsed.body,
          source: 'gemini',
          generated_at: new Date().toISOString(),
        },
        {
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          },
        }
      );
    }

    // Gemini replied but we couldn't parse JSON — fall through to fallback below.
  } catch (err) {
    console.error('[app-store-template] Gemini error:', err);
  }

  const fallback = pickRandom(FALLBACK_REVIEWS);
  return NextResponse.json(
    {
      rating: 5,
      title: fallback.title,
      body: fallback.body,
      source: 'fallback',
      generated_at: new Date().toISOString(),
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    }
  );
}
