import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai'
import 'dotenv/config'
import { composeSystemPromptFromTemplate, type BotProfileInput } from '../src/lib/botProfile'

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
}

interface UserMatchRow {
  user_a: UUID
  user_b: UUID
}

interface UserMatchAiStateConversationCandidateRow {
  match_id: UUID
  last_message_id: UUID | null
  last_message_at: string | null
  last_message_sender_id: UUID | null
  ai_last_processed_message_id: UUID | null
  ai_locked_until: string | null
  scheduled_response_at: string | null
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
  follow_up_message_enabled: boolean | null
  follow_up_message_prompt: string | null
  follow_up_delay: number | null
  max_follow_ups: number | null
  active_greeting_enabled: boolean | null
  active_greeting_prompt: string | null
  immediate_match_enabled: boolean | null
  created_at: string
}

interface DigitalHumanConfigRow {
  key: string
  value: string
}

interface CachedPrompt {
  template: string
  responseDelay: number
  followUpEnabled: boolean
  followUpPrompt?: string
  followUpDelay: number
  maxFollowUps: number
  activeGreetingEnabled: boolean
  activeGreetingPrompt?: string
  immediateMatchEnabled: boolean
}

interface GlobalConfig {
  autoReplyEnabled: boolean
}

// ---- Config / cache ----
const POLLING_INTERVAL_MS = 1000
const DEBOUNCE_SECONDS = 2
const LOCK_DURATION_SECONDS = 30
const PROMPT_REFRESH_INTERVAL_MS = 60 * 60 * 1000
const CONFIG_REFRESH_INTERVAL_MS = 5 * 60 * 1000

let systemPromptCache = new Map<string, CachedPrompt>()
let lastPromptRefresh = 0
let globalConfig: GlobalConfig = { autoReplyEnabled: true }
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
    .select('userid, is_digital_human, username, personality, bio, gender, age, profession')
    .eq('userid', userid)
    .single()

  if (error || !data) return null
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
  console.log('[dh-auto-replies] Refreshing system prompts...')
  const { data, error } = await supabase
    .from('SystemPrompts')
    .select(
      'gender, personality, system_prompt, response_delay, immediate_match_enabled, follow_up_message_enabled, follow_up_message_prompt, follow_up_delay, max_follow_ups, active_greeting_enabled, active_greeting_prompt, created_at'
    )
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[dh-auto-replies] Error fetching system prompts:', error)
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
    console.error('[dh-auto-replies] Error fetching global config', error)
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

// ---- Auto replies logic ----
async function processPendingConversations() {
  if (!globalConfig.autoReplyEnabled) return

  const now = new Date()
  const debounceThreshold = new Date(now.getTime() - DEBOUNCE_SECONDS * 1000)

  const { data, error } = await supabase
    .from('user_match_ai_state')
    .select(
      `
      match_id,
      last_message_id,
      last_message_at,
      last_message_sender_id,
      ai_last_processed_message_id,
      ai_locked_until,
      scheduled_response_at,
      match:user_matches!inner (
        user_a,
        user_b
      )
    `
    )
    .lt('last_message_at', debounceThreshold.toISOString())
    .is('ai_locked_until', null)
    .not('last_message_id', 'is', null)

  if (error) {
    console.error('[dh-auto-replies] Error fetching candidates:', error)
    return
  }

  const candidates = (data ?? []) as unknown as UserMatchAiStateConversationCandidateRow[]

  for (const c of candidates) {
    const isNewMessage = c.last_message_id !== c.ai_last_processed_message_id
    const isScheduled = !!c.scheduled_response_at
    if (!isNewMessage && !isScheduled) continue

    if (isScheduled && c.scheduled_response_at) {
      const scheduleTime = new Date(c.scheduled_response_at).getTime()
      if (Date.now() < scheduleTime) continue
    }

    if (!c.last_message_sender_id) continue

    // If the latest message was sent by the bot, we should NOT keep re-processing this match forever.
    // Mark it as processed so we only do work when a real user sends a new message.
    const senderIsDh = await getIsDigitalHuman(c.last_message_sender_id)
    if (senderIsDh == null) continue
    if (senderIsDh) {
      if (c.last_message_id && c.ai_last_processed_message_id !== c.last_message_id) {
        await supabase
          .from('user_match_ai_state')
          .update({ ai_last_processed_message_id: c.last_message_id, scheduled_response_at: null })
          .eq('match_id', c.match_id)
          .eq('last_message_id', c.last_message_id)
      }
      continue
    }

    const otherUserId = c.match.user_a === c.last_message_sender_id ? c.match.user_b : c.match.user_a
    const bot = await getUserRow(otherUserId)
    if (!bot) continue
    if (!bot.is_digital_human) {
      // Human↔human match: mark processed so we don't keep polling this forever.
      if (c.last_message_id && c.ai_last_processed_message_id !== c.last_message_id) {
        await supabase
          .from('user_match_ai_state')
          .update({ ai_last_processed_message_id: c.last_message_id, scheduled_response_at: null })
          .eq('match_id', c.match_id)
          .eq('last_message_id', c.last_message_id)
      }
      continue
    }

    await processConversation(c, bot)
  }
}

function composeSystemInstruction(targetBot: UserRow, promptConfig: CachedPrompt | undefined): string {
  if (promptConfig) {
    const botProfile: BotProfileInput = {
      name: targetBot.username ?? 'Digital Human',
      age: targetBot.age ?? undefined,
      archetype: targetBot.profession ?? undefined,
      bio: targetBot.bio ?? undefined,
      background: targetBot.bio ?? undefined,
    }
    return composeSystemPromptFromTemplate(promptConfig.template, botProfile)
  }

  return `
You are ${targetBot.username ?? 'a digital human'}, a digital human in a simulation.
Your personality: ${targetBot.personality || 'Friendly and curious'}.
Your bio: ${targetBot.bio || 'N/A'}.
Gender: ${targetBot.gender || 'N/A'}.

You are talking to a user.
Reply as this character. Keep it engaging, short, and natural for a chat app.
Do not use emojis excessively.
reply directly with the text content.
`
}

async function processConversation(state: UserMatchAiStateConversationCandidateRow, targetBot: UserRow) {
  const matchId = state.match_id
  const lockTime = new Date(Date.now() + LOCK_DURATION_SECONDS * 1000)

  const { error: lockError } = await supabase
    .from('user_match_ai_state')
    .update({ ai_locked_until: lockTime.toISOString() })
    .eq('match_id', matchId)
    .eq('last_message_id', state.last_message_id)

  if (lockError) return

  try {
    const { data: messages } = await supabase.rpc('rpc_get_messages', {
      match_id: matchId,
      limit_count: 50,
      start_index: 0,
    })
    const msgRows = (messages ?? []) as unknown as MessageRow[]
    if (msgRows.length === 0) throw new Error('No messages found')

    const latestUserMessage = msgRows.find((m) => m.sender_id !== targetBot.userid)
    const checkpointId = latestUserMessage?.id ?? state.last_message_id

    const promptConfig = getPromptConfigForUser(targetBot)
    const finalSystemInstruction = composeSystemInstruction(targetBot, promptConfig)

    if (!state.scheduled_response_at && state.last_message_id !== state.ai_last_processed_message_id) {
      const delaySeconds = promptConfig?.responseDelay || 0
      if (delaySeconds > 0 && state.last_message_at) {
        const messageTime = new Date(state.last_message_at).getTime()
        const targetTime = messageTime + delaySeconds * 1000
        if (targetTime > Date.now()) {
          await supabase
            .from('user_match_ai_state')
            .update({
              scheduled_response_at: new Date(targetTime).toISOString(),
              ai_locked_until: null,
            })
            .eq('match_id', matchId)
          return
        }
      }
    }

    // Gemini chat sessions require history to start with role 'user'. Since our conversation can begin with a bot
    // greeting (role 'model'), we avoid startChat and instead send a single prompt via generateContent.
    const transcript = buildTranscript(msgRows, targetBot.userid, targetBot.username ?? 'Bot')
    const prompt = `${finalSystemInstruction}\n\nConversation so far:\n${transcript}\n\nWrite the next message as ${targetBot.username ?? 'the bot'}. Reply with only the message text.`

    const result = await model.generateContent(prompt)
    const responseText = result.response.text()

    const { error: sendError } = await supabase.rpc('rpc_send_message', {
      match_id: matchId,
      content: responseText,
      sender_id: targetBot.userid,
    })
    if (sendError) throw sendError

    await supabase
      .from('user_match_ai_state')
      .update({
        ai_last_processed_message_id: checkpointId,
        scheduled_response_at: null,
        ai_locked_until: null,
        ai_follow_up_count: 0,
      })
      .eq('match_id', matchId)
  } catch (err) {
    console.error('[dh-auto-replies] Error processing match', matchId, err)
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
  console.log('[dh-auto-replies] Starting...')
  await refreshSystemPrompts()
  await refreshGlobalConfig()

  while (true) {
    await refreshIfNeeded()
    await processPendingConversations()
    await new Promise((resolve) => setTimeout(resolve, POLLING_INTERVAL_MS))
  }
}

main().catch((e) => {
  console.error('[dh-auto-replies] Fatal error', e)
  process.exit(1)
})

