export type BotProfileInput = {
  name: string
  age?: number | null
  archetype?: string | null
  bio?: string | null
}

export const PERSONALITY_TRAITS = [
  "playboy",
  "affirming",
  "confident",
  "witty",
  "gentle",
  "protective",
  "empathetic",
  "flirty",
  "curious",
  "calm",
  "direct",
  "charming",
] as const

export const SPEAKING_STYLES = [
  "short texts, uses lowercase",
  "poetic and metaphorical",
  "formal and gentlemanly",
  "playful teasing",
  "direct and practical",
  "calm and reassuring",
  "storyteller with vivid imagery",
  "slang-y but still respectful",
] as const

function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function pickRandomUnique<T>(arr: readonly T[], count: number): T[] {
  const pool = [...arr]
  const out: T[] = []
  while (pool.length && out.length < count) {
    const idx = Math.floor(Math.random() * pool.length)
    out.push(pool[idx])
    pool.splice(idx, 1)
  }
  return out
}

function cleanOneLine(s?: string | null) {
  return (s ?? "").replace(/\s+/g, " ").trim()
}

export function generateBotProfileBlock(input: BotProfileInput) {
  const name = cleanOneLine(input.name) || "Unknown"
  const age = input.age ?? undefined
  const archetype = cleanOneLine(input.archetype) || "Digital Human"
  const bio = cleanOneLine(input.bio) || "—"

  const traits = pickRandomUnique(PERSONALITY_TRAITS, 2).join(", ")
  const speakingStyle = pickRandom(SPEAKING_STYLES)

  return `<bot_profile>
**Name:** ${name}
** Age** :${age ?? "—"}
**Archetype:** ${archetype}
**Personality Traits:** ${traits}
**Speaking Style:** ${speakingStyle}
**Bio:** ${bio}
</bot_profile>`
}

function findRealBotProfileBlock(prompt: string) {
  // Only treat <bot_profile> as a block when it appears on its own line (optionally indented),
  // so we don't match inline mentions like: "(defined below in <bot_profile>)".
  const openRe = /(^|\r?\n)[ \t]*<bot_profile>[ \t]*(\r?\n)/i
  const openMatch = openRe.exec(prompt)
  if (!openMatch || openMatch.index == null) return null

  const openIdx = openMatch.index + openMatch[1].length // start at line break or 0
  const afterOpenIdx = openIdx + openMatch[0].trimStart().length

  const closeRe = /(^|\r?\n)[ \t]*<\/bot_profile>[ \t]*(\r?\n|$)/i
  closeRe.lastIndex = 0
  const rest = prompt.slice(afterOpenIdx)
  const closeMatch = closeRe.exec(rest)
  if (!closeMatch || closeMatch.index == null) return null

  const closeStartInRest = closeMatch.index + closeMatch[1].length
  const closeEndInRest = closeMatch.index + closeMatch[0].length

  const start = openIdx
  const end = afterOpenIdx + closeEndInRest
  return { start, end }
}

export function upsertBotProfile(systemPrompt: string, input: BotProfileInput) {
  const block = generateBotProfileBlock(input)
  const next = systemPrompt?.trim() ? systemPrompt : ""

  const found = findRealBotProfileBlock(next)
  if (found) {
    return `${next.slice(0, found.start)}${block}${next.slice(found.end)}`
  }

  // If there's no bot_profile block yet, prepend it.
  if (!next) return block
  return `${block}\n\n${next}`
}


