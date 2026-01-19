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

interface UserMatchAiStateGreetingCandidateRow {
  match_id: UUID
  ai_greeting_sent: boolean
  ai_locked_until: string | null
  match: UserMatchRow
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
  autoReplyEnabled: boolean
}

// ---- Config / cache ----
const POLLING_INTERVAL_MS = 1000
const LOCK_DURATION_SECONDS = 30
const PROMPT_REFRESH_INTERVAL_MS = 60 * 60 * 1000
const CONFIG_REFRESH_INTERVAL_MS = 5 * 60 * 1000

let systemPromptCache = new Map<string, CachedPrompt>()
let lastPromptRefresh = 0
let globalConfig: GlobalConfig = { autoReplyEnabled: true }
let lastConfigRefresh = 0

function getPromptConfigForUser(user: Pick<UserRow, 'gender' | 'personality'>): CachedPrompt | undefined {
  const g = (user.gender || 'Female').trim()
  const p = (user.personality || 'General').trim()
  const cacheKey = `${g}:${p}`
  return systemPromptCache.get(cacheKey) ?? systemPromptCache.get(`${g}:General`)
}

async function refreshSystemPrompts() {
  console.log('[dh-greetings] Refreshing system prompts...')
  const { data, error } = await supabase
    .from('SystemPrompts')
    .select(
      'gender, personality, system_prompt, response_delay, immediate_match_enabled, follow_up_message_enabled, follow_up_message_prompt, follow_up_delay, max_follow_ups, active_greeting_enabled, active_greeting_prompt, created_at'
    )
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[dh-greetings] Error fetching system prompts:', error)
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
    console.error('[dh-greetings] Error fetching global config', error)
    return
  }
  const rows = (data ?? []) as unknown as DigitalHumanConfigRow[]
  const configMap: Record<string, string> = {}
  for (const r of rows) configMap[r.key] = r.value
  globalConfig.autoReplyEnabled = configMap['enable_digital_human_auto_response'] !== 'false'
  lastConfigRefresh = Date.now()
}

async function refreshIfNeeded() {
  const now = Date.now()
  if (now - lastPromptRefresh > PROMPT_REFRESH_INTERVAL_MS) await refreshSystemPrompts()
  if (now - lastConfigRefresh > CONFIG_REFRESH_INTERVAL_MS) await refreshGlobalConfig()
}

// ---- Greeting logic ----
async function processGreetings() {
  if (!globalConfig.autoReplyEnabled) return

  const { data, error } = await supabase
    .from('user_match_ai_state')
    .select(
      `
      match_id,
      ai_greeting_sent,
      ai_locked_until,
      match:user_matches!inner (
        user_a,
        user_b
      )
    `
    )
    .is('last_message_id', null)
    .eq('ai_greeting_sent', false)
    .is('ai_locked_until', null)
    .limit(50)

  if (error) {
    console.error('[dh-greetings] Error fetching greeting candidates:', error)
    return
  }

  const candidates = (data ?? []) as unknown as UserMatchAiStateGreetingCandidateRow[]
  for (const c of candidates) {
    const { user_a, user_b } = c.match
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('userid, is_digital_human, username, gender, personality, age, bio, profession, zipcode')
      .in('userid', [user_a, user_b])

    if (usersErr || !users || users.length < 2) continue

    const userRows = users as unknown as UserRow[]
    const botUser = userRows.find((u) => u.is_digital_human)
    const realUser = userRows.find((u) => !u.is_digital_human)
    if (!botUser || !realUser) continue

    const promptConfig = getPromptConfigForUser(botUser)
    if (!promptConfig || !promptConfig.activeGreetingEnabled) continue

    await sendGreeting(c.match_id, botUser, realUser, promptConfig)
  }
}

async function sendGreeting(matchId: UUID, botUser: UserRow, realUser: UserRow, config: CachedPrompt) {
  const lockTime = new Date(Date.now() + LOCK_DURATION_SECONDS * 1000)

  const { error: lockError } = await supabase
    .from('user_match_ai_state')
    .update({ ai_locked_until: lockTime.toISOString() })
    .eq('match_id', matchId)
    .eq('ai_greeting_sent', false)
    .is('last_message_id', null)

  if (lockError) return

  try {
    const botProfile: BotProfileInput = {
      name: botUser.username ?? 'Digital Human',
      age: botUser.age ?? undefined,
      archetype: botUser.profession ?? undefined,
      bio: botUser.bio ?? undefined,
      background: botUser.bio ?? undefined,
    }

    let systemText = composeSystemPromptFromTemplate(config.template, botProfile)
    
    const userProfile: UserProfileInput = {
      username: realUser.username,
      age: realUser.age,
      zipcode: realUser.zipcode,
      bio: realUser.bio,
      profession: realUser.profession,
    }
    systemText = composeSystemPromptWithUserProfile(systemText, userProfile)
    const greetingPrompt =
      (config.activeGreetingPrompt || '').trim() ||
      'Send a short friendly greeting to start the conversation. Keep it natural and concise.'

    const chat = model.startChat({
      history: [],
      systemInstruction: {
        role: 'system',
        parts: [{ text: systemText }],
      },
    })

    const triggerMsg = `[System: ${greetingPrompt}]`
    const result = await chat.sendMessage(triggerMsg)
    const responseText = result.response.text()

    const { error: sendError } = await supabase.rpc('rpc_send_message', {
      match_id: matchId,
      content: responseText,
      sender_id: botUser.userid,
    })
    if (sendError) throw sendError

    await supabase
      .from('user_match_ai_state')
      .update({
        ai_greeting_sent: true,
        ai_greeting_sent_at: new Date().toISOString(),
        ai_locked_until: null,
      })
      .eq('match_id', matchId)
  } catch (e) {
    console.error('[dh-greetings] Error sending greeting', e)
    await supabase.from('user_match_ai_state').update({ ai_locked_until: null }).eq('match_id', matchId)
  }
}

async function main() {
  console.log('[dh-greetings] Starting...')
  await refreshSystemPrompts()
  await refreshGlobalConfig()

  while (true) {
    await refreshIfNeeded()
    await processGreetings()
    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS))
  }
}

main().catch((e) => {
  console.error('[dh-greetings] Fatal error', e)
  process.exit(1)
})

