import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import 'dotenv/config'
import {
  composeSystemPromptFromTemplate,
  composeSystemPromptWithUserProfile,
  type BotProfileInput,
  type UserProfileInput,
} from '../src/lib/botProfile'

// ---- Env / clients ----
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const GEMINI_API_KEY = process.env.AI_INTEGRATIONS_GEMINI_API_KEY
const GEMINI_BASE_URL = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) {
  console.error(
    'Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY, or AI_INTEGRATIONS_GEMINI_API_KEY'
  )
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
const model = genAI.getGenerativeModel(
  { model: 'gemini-2.5-flash' },
  {
    baseUrl: GEMINI_BASE_URL,
  }
)

// ---- Types ----
type UUID = string

interface UserRow {
  userid: UUID
  is_digital_human: boolean
  username: string | null
  gender: string | null
  personality: string | null
  age: number | null
  bio: string | null
  profession: string | null
  zipcode: string | null
}

interface UserMatchRow {
  user_a: UUID
  user_b: UUID
}

interface UserMatchAiStateFollowUpCandidateRow {
  match_id: UUID
  last_message_id: UUID | null
  last_message_at: string | null
  last_message_sender_id: UUID | null
  ai_follow_up_count: number | null
  ai_locked_until: string | null
  match: UserMatchRow
}

interface MessageRow {
  id: UUID
  sender_id: UUID
  content: string | null
  media_url: string | null
  created_at: string
}

interface SystemPromptRow {
  gender: string
  personality: string
  system_prompt: string
  response_delay: number | null
  immediate_match_enabled: boolean | null
  follow_up_message_enabled: boolean | null
  follow_up_message_prompt: string | null
  follow_up_delay: number | null
  max_follow_ups: number | null
  active_greeting_enabled: boolean | null
  active_greeting_prompt: string | null
  created_at: string
}

interface DigitalHumanConfigRow {
  key: string
  value: string
}

interface CachedPrompt {
  template: string
  responseDelay: number
  immediateMatchEnabled: boolean
  followUpEnabled: boolean
  followUpPrompt?: string
  followUpDelay: number
  maxFollowUps: number
  activeGreetingEnabled: boolean
  activeGreetingPrompt?: string
}

interface GlobalConfig {
  followUpEnabled: boolean
}

// ---- Config / cache ----
// Follow-ups are hour/day scale; don't poll every second.
const POLLING_INTERVAL_MS = 10_000
const LOCK_DURATION_SECONDS = 30
const PROMPT_REFRESH_INTERVAL_MS = 60 * 60 * 1000
const CONFIG_REFRESH_INTERVAL_MS = 5 * 60 * 1000

let systemPromptCache = new Map<string, CachedPrompt>()
let lastPromptRefresh = 0
let globalConfig: GlobalConfig = { followUpEnabled: true }
let lastConfigRefresh = 0

// Avoid hammering `users` on every poll.
const USER_CACHE_TTL_MS = 10 * 60 * 1000
const userIsDigitalHumanCache = new Map<UUID, { value: boolean; expiresAt: number }>()
const userRowCache = new Map<UUID, { value: UserRow; expiresAt: number }>()

async function getIsDigitalHuman(userid: UUID): Promise<boolean | null> {
  const cached = userIsDigitalHumanCache.get(userid)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const { data, error } = await supabase.from('users').select('is_digital_human').eq('userid', userid).single()
  if (error || !data) return null

  const val = Boolean((data as { is_digital_human?: boolean }).is_digital_human)
  userIsDigitalHumanCache.set(userid, { value: val, expiresAt: Date.now() + USER_CACHE_TTL_MS })
  return val
}

async function getUserRow(userid: UUID): Promise<UserRow | null> {
  const cached = userRowCache.get(userid)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const { data, error } = await supabase
    .from('users')
    .select('userid, is_digital_human, username, gender, personality, age, bio, profession, zipcode')
    .eq('userid', userid)
    .single()

  if (error) {
    console.error(`[dh-followups] Error fetching user ${userid}:`, error)
    return null
  }
  if (!data) {
    console.warn(`[dh-followups] User ${userid} not found`)
    return null
  }
  const row = data as unknown as UserRow
  userRowCache.set(userid, { value: row, expiresAt: Date.now() + USER_CACHE_TTL_MS })
  userIsDigitalHumanCache.set(userid, { value: Boolean(row.is_digital_human), expiresAt: Date.now() + USER_CACHE_TTL_MS })
  return row
}

function getPromptConfigForUser(user: Pick<UserRow, 'gender' | 'personality'>): CachedPrompt | undefined {
  const g = (user.gender || 'Female').trim()
  const p = (user.personality || 'General').trim()
  const cacheKey = `${g}:${p}`
  return systemPromptCache.get(cacheKey) ?? systemPromptCache.get(`${g}:General`)
}

async function refreshSystemPrompts() {
  console.log('[dh-followups] Refreshing system prompts...')
  const { data, error } = await supabase
    .from('SystemPrompts')
    .select(
      'gender, personality, system_prompt, response_delay, immediate_match_enabled, follow_up_message_enabled, follow_up_message_prompt, follow_up_delay, max_follow_ups, active_greeting_enabled, active_greeting_prompt, created_at'
    )
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[dh-followups] Error fetching system prompts:', error)
    return
  }

  const rows = (data ?? []) as unknown as SystemPromptRow[]
  const newCache = new Map<string, CachedPrompt>()
  for (const row of rows) {
    const g = (row.gender || '').trim()
    const p = (row.personality || '').trim()
    const key = `${g}:${p}`
    if (newCache.has(key)) continue
    newCache.set(key, {
      template: row.system_prompt,
      responseDelay: row.response_delay || 0,
      immediateMatchEnabled: row.immediate_match_enabled || false,
      followUpEnabled: row.follow_up_message_enabled || false,
      followUpPrompt: row.follow_up_message_prompt || undefined,
      followUpDelay: row.follow_up_delay || 86400,
      maxFollowUps: row.max_follow_ups ?? 3,
      activeGreetingEnabled: row.active_greeting_enabled || false,
      activeGreetingPrompt: row.active_greeting_prompt || undefined,
    })
  }
  systemPromptCache = newCache
  lastPromptRefresh = Date.now()
}

async function refreshGlobalConfig() {
  const { data, error } = await supabase.from('digital_human_config').select('key, value')
  if (error) {
    console.error('[dh-followups] Error fetching global config', error)
    return
  }
  const rows = (data ?? []) as unknown as DigitalHumanConfigRow[]
  const configMap: Record<string, string> = {}
  for (const r of rows) configMap[r.key] = r.value
  globalConfig.followUpEnabled = configMap['enable_digital_human_follow_up'] !== 'false'
  lastConfigRefresh = Date.now()
}

async function refreshIfNeeded() {
  const now = Date.now()
  if (now - lastPromptRefresh > PROMPT_REFRESH_INTERVAL_MS) await refreshSystemPrompts()
  if (now - lastConfigRefresh > CONFIG_REFRESH_INTERVAL_MS) await refreshGlobalConfig()
}

// ---- Follow-up logic ----
async function processFollowUps() {
  if (!globalConfig.followUpEnabled) return

  const now = Date.now()
  const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('user_match_ai_state')
    .select(
      `
      match_id,
      last_message_id,
      last_message_at,
      last_message_sender_id,
      ai_follow_up_count,
      ai_locked_until,
      match:user_matches!inner (
        user_a,
        user_b
      )
    `
    )
    .lt('last_message_at', oneHourAgo)
    .is('ai_locked_until', null)
    .not('last_message_id', 'is', null)
    .not('last_message_sender_id', 'is', null)

  if (error) {
    console.error('[dh-followups] Error fetching follow-up candidates', error)
    return
  }

  const candidates = (data ?? []) as unknown as UserMatchAiStateFollowUpCandidateRow[]
  for (const c of candidates) {
    if (!c.last_message_sender_id || !c.last_message_at) continue

    // Follow-ups only happen when the *latest* message was from the digital human.
    const senderIsDh = await getIsDigitalHuman(c.last_message_sender_id)
    if (!senderIsDh) continue

    const botUser = await getUserRow(c.last_message_sender_id)
    if (!botUser || !botUser.is_digital_human) continue

    // Get the human user (the other user in the match)
    const humanUserId = c.match.user_a === c.last_message_sender_id ? c.match.user_b : c.match.user_a
    const humanUser = await getUserRow(humanUserId)
    if (!humanUser) continue

    const promptConfig = getPromptConfigForUser(botUser)
    if (!promptConfig || !promptConfig.followUpEnabled || !promptConfig.followUpPrompt) continue

    const max = promptConfig.maxFollowUps || 3
    if ((c.ai_follow_up_count || 0) >= max) continue

    const delayMs = (promptConfig.followUpDelay || 86400) * 1000
    const lastMsgTime = new Date(c.last_message_at).getTime()
    if (now < lastMsgTime + delayMs) continue

    await sendFollowUp(c, botUser, humanUser, promptConfig)
  }
}

async function sendFollowUp(
  state: UserMatchAiStateFollowUpCandidateRow,
  botUser: UserRow,
  humanUser: UserRow,
  config: CachedPrompt
) {
  const matchId = state.match_id
  const lockTime = new Date(Date.now() + LOCK_DURATION_SECONDS * 1000)

  const { error: lockError } = await supabase
    .from('user_match_ai_state')
    .update({ ai_locked_until: lockTime.toISOString() })
    .eq('match_id', matchId)
    .eq('ai_follow_up_count', state.ai_follow_up_count)

  if (lockError) return

  try {
    const botProfile: BotProfileInput = {
      name: botUser.username ?? 'Digital Human',
      age: botUser.age ?? undefined,
      archetype: botUser.profession ?? undefined,
      bio: botUser.bio ?? undefined,
      background: botUser.bio ?? undefined,
    }

    const { data: messages } = await supabase.rpc('rpc_get_messages', {
      match_id: matchId,
      limit_count: 20,
      start_index: 0,
    })
    const msgRows = [...(messages ?? [])] as unknown as MessageRow[]
    const transcript = buildTranscript(msgRows, botUser.userid, botUser.username ?? 'Bot')

    let systemText = composeSystemPromptFromTemplate(config.template, botProfile)
    
    const userProfile: UserProfileInput = {
      username: humanUser.username,
      age: humanUser.age,
      zipcode: humanUser.zipcode,
      bio: humanUser.bio,
      profession: humanUser.profession,
    }
    systemText = composeSystemPromptWithUserProfile(systemText, userProfile)
    
    const followUpInstruction =
      config.followUpPrompt || 'Send a casual follow-up message to re-engage the conversation.'
    const prompt = `${systemText}\n\nConversation so far:\n${transcript}\n\nThe user hasn't replied in a while.\nInstruction: ${followUpInstruction}\n\nWrite the follow-up as ${botUser.username ?? 'the bot'}. Reply with only the message text.`

    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    const { data: sentMsg, error: sendError } = await supabase.rpc('rpc_send_message', {
      match_id: matchId,
      content: responseText,
      sender_id: botUser.userid,
    })
    if (sendError) throw sendError

    await supabase
      .from('user_match_ai_state')
      .update({
        ai_follow_up_count: (state.ai_follow_up_count || 0) + 1,
        // last_message_* will be updated by the on_message_created_update_ai_state trigger.
        // Still setting last_message_id is fine if the RPC returns it, but not required.
        last_message_id: (sentMsg as { id?: string } | null)?.id ?? state.last_message_id,
        ai_locked_until: null,
      })
      .eq('match_id', matchId)
  } catch (e) {
    console.error('[dh-followups] Error sending follow-up', e)
    await supabase.from('user_match_ai_state').update({ ai_locked_until: null }).eq('match_id', matchId)
  }
}

function buildTranscript(messages: MessageRow[], botUserId: UUID, botName: string) {
  const chronological = [...messages].reverse()
  return chronological
    .map((m) => {
      const speaker = m.sender_id === botUserId ? botName : 'User'
      const text = m.content || (m.media_url ? '[Image Sent]' : '')
      return `${speaker}: ${text}`
    })
    .join('\n')
}

async function main() {
  console.log('[dh-followups] Starting...')
  await refreshSystemPrompts()
  await refreshGlobalConfig()

  while (true) {
    await refreshIfNeeded()
    await processFollowUps()
    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS))
  }
}

main().catch((e) => {
  console.error('[dh-followups] Fatal error', e)
  process.exit(1)
})

