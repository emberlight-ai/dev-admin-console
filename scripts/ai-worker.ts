
import { createClient } from '@supabase/supabase-js'
import { GoogleGenerativeAI } from '@google/generative-ai'
import 'dotenv/config'
import { composeSystemPromptFromTemplate, BotProfileInput } from '../src/lib/botProfile'



// Allow reading from .env.local if running with support, otherwise assume process.env is set
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
const GEMINI_API_KEY = process.env.AI_INTEGRATIONS_GEMINI_API_KEY
const GEMINI_BASE_URL = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !GEMINI_API_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY, or AI_INTEGRATIONS_GEMINI_API_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
const model = genAI.getGenerativeModel({ 
  model: 'gemini-2.5-flash' // or use env var, falling back to a known good model
}, {
  baseUrl: GEMINI_BASE_URL
})

const POLLING_INTERVAL_MS = 1000
const DEBOUNCE_SECONDS = 2
const LOCK_DURATION_SECONDS = 30
const PROMPT_REFRESH_INTERVAL_MS = 60 * 60 * 1000 // 1 hour (reduced from 24h for easier config updates)
const CONFIG_REFRESH_INTERVAL_MS = 5 * 60 * 1000 // 5 minutes

// Cache: "Gender:Personality" -> { template: string, responseDelay: number, ... }
interface CachedPrompt {
    template: string
    responseDelay: number
    followUpEnabled: boolean
    followUpPrompt?: string
    followUpDelay: number
    maxFollowUps: number
}
let systemPromptCache = new Map<string, CachedPrompt>()
let lastPromptRefresh = 0

// Global Config Cache
interface GlobalConfig {
    autoReplyEnabled: boolean
    followUpEnabled: boolean
}
let globalConfig: GlobalConfig = {
    autoReplyEnabled: true,
    followUpEnabled: true
}
let lastConfigRefresh = 0


async function main() {
  console.log('Starting AI Worker...')
  
  // Initial Loads
  await refreshSystemPrompts()
  await refreshGlobalConfig()

  while (true) {
    try {
      const now = Date.now()
      // Refresh cache if needed
      if (now - lastPromptRefresh > PROMPT_REFRESH_INTERVAL_MS) {
        await refreshSystemPrompts()
      }
      if (now - lastConfigRefresh > CONFIG_REFRESH_INTERVAL_MS) {
        await refreshGlobalConfig()
      }

      await processPendingConversations()
      await processFollowUps()
    } catch (error) {
      console.error('Error in worker loop:', error)
    }
    await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS))
  }
}

async function processPendingConversations() {
  if (!globalConfig.autoReplyEnabled) return

  // 1. Identify candidates
  // We need matches where:
  // - receiver (one of the participants) is a digital human
  // - last message was sent by the REAL USER (not the digital human)
  // - last message was > 2 seconds ago (debouncing)
  // - not currently locked
  // - last_message_id is new (hasn't been processed yet)
  
  const now = new Date()
  const debounceThreshold = new Date(now.getTime() - DEBOUNCE_SECONDS * 1000)
  
  const { data: candidates, error } = await supabase
    .from('user_match_ai_state')
    .select(`
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
    `)
    .lt('last_message_at', debounceThreshold.toISOString())
    .is('ai_locked_until', null)
    .not('last_message_id', 'is', null)
    
  if (error) {
    console.error('Error fetching candidates:', error)
    return
  }

  // Filter in memory 
  const actionable = []
  
  for (const c of candidates || []) {
    
    const isNewMessage = c.last_message_id !== c.ai_last_processed_message_id;
    const isScheduled = !!c.scheduled_response_at;
    
    if (!isNewMessage && !isScheduled) continue; // Nothing to do
    
    // If it IS scheduled, check if it's time
    if (isScheduled) {
        const scheduleTime = new Date(c.scheduled_response_at).getTime();
        if (Date.now() < scheduleTime) continue; // Not time yet
    }
    
    // Check if sender is a digital human 
    // We need to know if last_message_sender_id is digital human.
    const { data: senderUser } = await supabase.from('users').select('is_digital_human').eq('userid', c.last_message_sender_id).single()
    if (!senderUser || senderUser.is_digital_human) continue;
    
    // Check if the OTHER person in the match is a digital human.
    const match: any = c.match
    const otherUserId = match.user_a === c.last_message_sender_id ? match.user_b : match.user_a
    const { data: otherUser } = await supabase.from('users').select('userid, is_digital_human, username, personality, bio, gender, age, profession').eq('userid', otherUserId).single()

    
    if (!otherUser || !otherUser.is_digital_human) continue;
    
    // Found a valid candidate!
    actionable.push({
      state: c,
      targetBot: otherUser,
      userSenderId: c.last_message_sender_id
    })
  }

  // Process one by one (or parallel limit)
  for (const item of actionable) {
    await processConversation(item)
  }
}

async function processConversation({ state, targetBot, userSenderId }: any) {
  const matchId = state.match_id
  const lockTime = new Date(Date.now() + LOCK_DURATION_SECONDS * 1000)
  
  // 1. Lock
  const { error: lockError } = await supabase
    .from('user_match_ai_state')
    .update({ ai_locked_until: lockTime.toISOString() })
    .eq('match_id', matchId)
    // Verify it hasn't changed (optimistic locking)
    .eq('last_message_id', state.last_message_id) 
  
  if (lockError) {
    console.log(`Failed to lock match ${matchId}, skipping`)
    return
  }
  
  console.log(`Processing match ${matchId} for bot ${targetBot.username}...`)
  
  try {
    // 2. Fetch history
    // Get last N messages
    const { data: messages } = await supabase.rpc('rpc_get_messages', {
      match_id: matchId,
      limit_count: 50,
      start_index: 0
    })
    
    if (!messages) throw new Error('No messages found')
    
    // 3. Construct Prompt
    // Determine the actual latest user message we are about to respond to.
    const latestUserMessage = messages.find((m: any) => m.sender_id !== targetBot.userid)
    const checkpointId = latestUserMessage ? latestUserMessage.id : state.last_message_id

    // Resolution Logic for System Prompt
    const g = (targetBot.gender || 'Female').trim()
    const p = (targetBot.personality || 'General').trim()
    const cacheKey = `${g}:${p}`
    
    let promptConfig = systemPromptCache.get(cacheKey)
    if (!promptConfig) {
       console.warn(`No system prompt found for key "${cacheKey}", falling back to default or trying "General"`)
       promptConfig = systemPromptCache.get(`${g}:General`)
    }

    let finalSystemInstruction = ''

    if (promptConfig) {
        // Compose using the shared library
        const botProfile: BotProfileInput = {
            name: targetBot.username,
            age: targetBot.age, // Ensure age is selected in query
            archetype: targetBot.profession, // Map profession to archetype if loosely equivalent, or add profession to query
            bio: targetBot.bio,
            background: targetBot.bio // Using bio as background for now
        }
        
        finalSystemInstruction = composeSystemPromptFromTemplate(promptConfig.template, botProfile)
    } else {
        // Hardcoded Fallback
        finalSystemInstruction = `
You are ${targetBot.username}, a digital human in a simulation.
Your personality: ${targetBot.personality || 'Friendly and curious'}.
Your bio: ${targetBot.bio || 'N/A'}.
Gender: ${targetBot.gender || 'N/A'}.

You are talking to a user.
Reply as this character. Keep it engaging, short, and natural for a chat app.
Do not use emojis excessively.
reply directly with the text content.
`
    }
    
    // --- Scheduling Logic ---
    // If this is a NEW message (not just waking up for a schedule), we need to decide if we delay.
    if (!state.scheduled_response_at && state.last_message_id !== state.ai_last_processed_message_id) {
       const delaySeconds = promptConfig?.responseDelay || 0;
       
       if (delaySeconds > 0) {
           const messageTime = new Date(state.last_message_at).getTime();
           const targetTime = messageTime + (delaySeconds * 1000);
           
           if (targetTime > Date.now()) {
               console.log(`Scheduling delayed response for ${targetBot.username} in ${delaySeconds}s (at ${new Date(targetTime).toISOString()})`)
               
               // Write schedule to DB and exit
               await supabase.from('user_match_ai_state').update({
                   scheduled_response_at: new Date(targetTime).toISOString(),
                   ai_locked_until: null // Unlock immediately so we can pick it up later
               }).eq('match_id', matchId)
               
               return; // STOP Processing
           }
       }
    }

    // Reverse for chronological order for Gemini
    const history = [...messages].reverse()

    const chat = model.startChat({
      history: history.map((m: any) => ({
        role: m.sender_id === targetBot.userid ? 'model' : 'user',
        parts: [{ text: m.content || (m.media_url ? '[Image Sent]' : '') }]
      })),
      systemInstruction: {
        role: 'system',
        parts: [{ text: finalSystemInstruction }]
      }
    })
    
    // 4. Generate
    const result = await chat.sendMessage('[[Responded to user messages]]') 
    const responseText = result.response.text()
    
    // 5. Send Response
    const { data: sentMsg, error: sendError } = await supabase.rpc('rpc_send_message', {
      match_id: matchId,
      content: responseText,
      sender_id: targetBot.userid
    })
    
    if (sendError) throw sendError
    
    console.log(`Sent response from ${targetBot.username}: "${responseText.substring(0, 20)}..."`)
    
    // 6. Update AI State
    await supabase.from('user_match_ai_state').update({
      ai_last_processed_message_id: checkpointId, 
      scheduled_response_at: null, // Clear schedule
      ai_locked_until: null, // Unlock
      ai_follow_up_count: 0 // Reset follow up count since the bot just replied to a user message
    }).eq('match_id', matchId)
    
  } catch (err) {
    console.error(`Error processing match ${matchId}:`, err)
    // Unlock so it can retry later (or maybe backoff)
    await supabase.from('user_match_ai_state').update({
      ai_locked_until: null
    }).eq('match_id', matchId)
  }
}


async function processFollowUps() {
    if (!globalConfig.followUpEnabled) return

    // Find candidates for follow-up
    // Criteria:
    // - Last message sender IS the digital human
    // - Not locked
    // - Count < Max Followups
    // - Time since last message > Delay
    
    const now = Date.now()
    
    // We can't easily filter by "dynamic delay" in SQL since delay is in the Prompt config (app layer).
    // So we fetch candidates that look "idle" and filter in code.
    // Fetch items where last_message_at is older than, say, 1 hour (minimum sanity check) 
    // to avoid fetching everything.
    // Assuming minimum follow-up is not instant.
    
    const oneHourAgo = new Date(now - 60 * 60 * 1000).toISOString()
    
    const { data: candidates, error } = await supabase
      .from('user_match_ai_state')
      .select(`
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
      `)
      .lt('last_message_at', oneHourAgo) 
      .is('ai_locked_until', null)
      
    if (error) {
        console.error('Error fetching follow-up candidates', error)
        return
    }
    
    if (!candidates || candidates.length === 0) return

    // In-memory filter and processing
    for (const c of candidates) {
        // 1. Identify Bot
        let botUserId = c.last_message_sender_id
        const { data: senderUser } = await supabase.from('users').select('is_digital_human, username, gender, personality, age, bio, profession').eq('userid', botUserId).single()
        
        // If last sender wasn't a bot, then the user replied last, so no follow up needed (wait, if user replied last, allow AI response logic to handle it).
        // Follow-ups are only when the USER hasn't replied to the BOT.
        // So last_message_sender_id should be the BOT.
        
        if (!senderUser || !senderUser.is_digital_human) continue;
        
        // 2. Get Config for this Bot
        const g = (senderUser.gender || 'Female').trim()
        const p = (senderUser.personality || 'General').trim()
        const cacheKey = `${g}:${p}`
        
        let promptConfig = systemPromptCache.get(cacheKey)
        if (!promptConfig) promptConfig = systemPromptCache.get(`${g}:General`)
        
        if (!promptConfig || !promptConfig.followUpEnabled || !promptConfig.followUpPrompt) continue
        
        // 3. Check Counts
        const max = promptConfig.maxFollowUps || 3
        if ((c.ai_follow_up_count || 0) >= max) continue
        
        // 4. Check Delay
        const delayMs = (promptConfig.followUpDelay || 86400) * 1000
        const lastMsgTime = new Date(c.last_message_at).getTime()
        
        if (now < lastMsgTime + delayMs) continue
        
        // READY TO SEND FOLLOW UP
        await sendFollowUp(c, senderUser, promptConfig)
    }
}

async function sendFollowUp(state: any, botUser: any, config: CachedPrompt) {
    const matchId = state.match_id
    const lockTime = new Date(Date.now() + LOCK_DURATION_SECONDS * 1000)
    
     // 1. Lock
    const { error: lockError } = await supabase
        .from('user_match_ai_state')
        .update({ ai_locked_until: lockTime.toISOString() })
        .eq('match_id', matchId)
        .eq('ai_follow_up_count', state.ai_follow_up_count) // Optimistic lock
  
    if (lockError) return
    
    console.log(`Sending follow-up named to match ${matchId} from ${botUser.username}`)

    try {
        // Compose Follow Up Prompt
         const botProfile: BotProfileInput = {
            name: botUser.username,
            age: botUser.age,
            archetype: botUser.profession,
            bio: botUser.bio,
            background: botUser.bio 
        }
        
        // We use the followUpPrompt as the system instruction or user instruction?
        // Usually follow up is "Generate a message to check in on the user".
        // Let's treat followUpPrompt as the INSTRUCTION to the model.
        // But we also need the persona.
        
        // Strategy: Use the BASE system prompt + an appended instruction to "Send a follow up message".
        // Or if the follow_up_prompt is a full template, use it.
        // Let's assume follow_up_prompt is the *Instruction* given to the model, e.g. "User hasn't replied in a while. Send a follow up..."
        
        // Ideally we start a chat with history, and ask it to generate a follow up.
        
        // Fetch history
        const { data: messages } = await supabase.rpc('rpc_get_messages', {
            match_id: matchId,
            limit_count: 20,
            start_index: 0
        })
        const history = [...(messages || [])].reverse()

        const systemText = composeSystemPromptFromTemplate(config.template, botProfile)
        
        const chat = model.startChat({
            history: history.map((m: any) => ({
                role: m.sender_id === botUser.userid ? 'model' : 'user',
                parts: [{ text: m.content || '' }]
            })),
            systemInstruction: {
                role: 'system',
                parts: [{ text: systemText }]
            }
        })
        
        // The trigger prompt
        // Use the configured follow-up prompt as the user message that triggers the AI? 
        // No, that puts words in user's mouth.
        // We should send it as a system notification or just "Model, please follow up".
        // Gemini API doesn't support "system" messages in history easily mid-stream in standard chat.
        // We can just send a user part that says `(System: The user hasn't replied. ${config.followUpPrompt})`
        
        const triggerMsg = `[System: The user hasn't replied in a while. ${config.followUpPrompt || 'Send a casual follow-up message to re-engage the conversation.'}]`
        
        const result = await chat.sendMessage(triggerMsg)
        const responseText = result.response.text()
        
        // Send
        const { error: sendError } = await supabase.rpc('rpc_send_message', {
            match_id: matchId,
            content: responseText,
            sender_id: botUser.userid
        })
        
        if (sendError) throw sendError

        // Update State
        await supabase.from('user_match_ai_state').update({
            ai_follow_up_count: (state.ai_follow_up_count || 0) + 1,
            last_message_at: new Date().toISOString(), // Update this so we reset the timer for the NEXT follow up!
             // Wait... if we update last_message_at, then "last_message_sender" becomes the BOT (which it already was).
             // And "ai_follow_up_count" increments.
             // Next loop will see last_message_at is new. It will wait another DELAY period.
             // Then check count < max. 
             // This correctly implements "Follow up 1, wait, Follow up 2, wait..."
            last_message_id: (await supabase.from('messages').select('id').eq('match_id', matchId).order('created_at', {ascending:false}).limit(1).single()).data?.id,
            ai_locked_until: null
        }).eq('match_id', matchId)
        
        console.log(`Sent follow-up: ${responseText.substring(0, 20)}...`)

    } catch (e) {
        console.error('Error sending follow-up', e)
        await supabase.from('user_match_ai_state').update({ ai_locked_until: null }).eq('match_id', matchId)
    }
}


// Run
main().catch(console.error)

async function refreshSystemPrompts() {
  console.log('Refreshing system prompts...')
  try {
    const { data, error } = await supabase
      .from('SystemPrompts')
      .select('gender, personality, system_prompt, response_delay, follow_up_message_enabled, follow_up_message_prompt, follow_up_delay, max_follow_ups, created_at')
      .order('created_at', { ascending: false })
      
    if (error) {
       console.error('Error fetching system prompts:', error)
       return 
    }
    
    const newCache = new Map<string, CachedPrompt>()
    let count = 0
    
    for (const row of data || []) {
        const g = (row.gender || '').trim()
        const p = (row.personality || '').trim()
        const key = `${g}:${p}`
        
        if (!newCache.has(key)) {
            newCache.set(key, { 
                template: row.system_prompt,
                responseDelay: row.response_delay || 0,
                followUpEnabled: row.follow_up_message_enabled || false,
                followUpPrompt: row.follow_up_message_prompt,
                followUpDelay: row.follow_up_delay || 86400,
                maxFollowUps: row.max_follow_ups ?? 3
            })
            count++
        }
    }
    
    systemPromptCache = newCache
    lastPromptRefresh = Date.now()
    console.log(`System prompts refreshed. Loaded ${count} templates.`)
    
  } catch (err) {
      console.error('Failed to refresh system prompts', err)
  }
}

async function refreshGlobalConfig() {
    try {
        const { data, error } = await supabase.from('digital_human_config').select('key, value')
        if (error) {
            console.error('Error fetching global config', error); 
            return
        }
        
        const configMap: any = {}
        data.forEach((r: any) => configMap[r.key] = r.value)
        
        globalConfig.autoReplyEnabled = configMap['enable_digital_human_auto_response'] !== 'false' // Default true
        globalConfig.followUpEnabled = configMap['enable_digital_human_follow_up'] !== 'false' // Default true
        
        lastConfigRefresh = Date.now()
        // console.log('Global config refreshed:', globalConfig)
    } catch (e) {
        console.error('Error refreshing global config', e)
    }
}

