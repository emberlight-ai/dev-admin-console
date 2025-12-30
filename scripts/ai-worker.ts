
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
  model: 'gemini-2.0-flash-exp' // or use env var, falling back to a known good model
}, {
  baseUrl: GEMINI_BASE_URL
})

const POLLING_INTERVAL_MS = 1000
const DEBOUNCE_SECONDS = 2
const LOCK_DURATION_SECONDS = 30
const PROMPT_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000 // 24 hours

// Cache: "Gender:Personality" -> { template: string, responseDelay: number }
interface CachedPrompt {
    template: string
    responseDelay: number
}
let systemPromptCache = new Map<string, CachedPrompt>()
let lastPromptRefresh = 0


async function main() {
  console.log('Starting AI Worker...')
  
  // Initial Prompt Load
  await refreshSystemPrompts()

  while (true) {
    try {
      // Refresh cache if needed
      if (Date.now() - lastPromptRefresh > PROMPT_REFRESH_INTERVAL_MS) {
        await refreshSystemPrompts()
      }

      await processPendingConversations()
    } catch (error) {
      console.error('Error in worker loop:', error)
    }
    await new Promise(resolve => setTimeout(resolve, POLLING_INTERVAL_MS))
  }
}

async function processPendingConversations() {
  // 1. Identify candidates
  // We need matches where:
  // - receiver (one of the participants) is a digital human
  // - last message was sent by the REAL USER (not the digital human)
  // - last message was > 2 seconds ago (debouncing)
  // - not currently locked
  // - last_message_id is new (hasn't been processed yet)
  
  // To do this efficiently, we query user_match_ai_state joined with users.
  // Note: Since `user_match_ai_state` only has match_id, we need to verify the participants.
  // However, `last_message_sender_id` tells us who sent the last message. 
  // We should check if `last_message_sender_id` is NOT a digital human.
  
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
    .is('ai_locked_until', null) // or passed time, but null is easier if we clear it. Or we check < now
    .not('last_message_id', 'is', null) // Should exist
    
    // We want to process if:
    // 1. New message (last_message_id != ai_last_processed_message_id)
    // 2. OR Scheduled time has passed (scheduled_response_at < now)
    
    // Since OR queries are complex in Supabase JS client without a raw query or joining everything, 
    // we'll fetch a wider net and filter in memory.
    // The current filters are:
    // - last_message_at < debounce (means it's not brand new typing)
    // - not locked
    // - has a last message
    
    // This is generally fine. We will check `scheduled_response_at` inside the loop.

    
    // We want where last_message_sender_id is NOT a digital human. 
    // And one of the participants IS a digital human.
    // This defines "User sent a message to a bot".
    // Checking "is_digital_human" requires joining users.
    // For MVP efficiency, let's fetch a batch and filter in code, or do a deeper join.
    // Let's do a deeper join if possible.
    
  if (error) {
    console.error('Error fetching candidates:', error)
    return
  }

  // Filter in memory for complex logic if join is hard
  const actionable = []
  
  for (const c of candidates || []) {
    // Check lock expiration manually if we didn't filter strictly by time in SQL (we filtered is null above)
    // Actually, let's just respect the NULL check for simplicity. If it crashes, it stays locked? 
    // We should probably check `or ai_locked_until < now()` in SQL, but supabase JS syntax for OR is tricky with other filters.
    // Let's handle "stuck" locks later or assume we clear them.
    
    // Logic:
    // If ai_last_processed_message_id is different -> New Message Event.
    // If same, check if we are just waiting for scheduled time.
    
    const isNewMessage = c.last_message_id !== c.ai_last_processed_message_id;
    const isScheduled = !!c.scheduled_response_at;
    
    if (!isNewMessage && !isScheduled) continue; // Nothing to do
    
    // If it IS scheduled, check if it's time
    if (isScheduled) {
        const scheduleTime = new Date(c.scheduled_response_at).getTime();
        if (Date.now() < scheduleTime) continue; // Not time yet
    }
    
    // Check if sender is a digital human (we don't want bot talking to bot loop, or bot replying to itself)
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
    
    let template = systemPromptCache.get(cacheKey)
    if (!template) {
       console.warn(`No system prompt found for key "${cacheKey}", falling back to default or trying "General"`)
       template = systemPromptCache.get(`${g}:General`)
    }

    let finalSystemInstruction = ''

    if (template) {
        // Compose using the shared library
        const botProfile: BotProfileInput = {
            name: targetBot.username,
            age: targetBot.age, // Ensure age is selected in query
            archetype: targetBot.profession, // Map profession to archetype if loosely equivalent, or add profession to query
            bio: targetBot.bio,
            background: targetBot.bio // Using bio as background for now
        }
        
        finalSystemInstruction = composeSystemPromptFromTemplate(template.template, botProfile)
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
       const delaySeconds = template?.responseDelay || 0;
       
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
    // We just ask for the next response.
    // The history is already loaded.
    const result = await chat.sendMessage('[[Responded to user messages]]') 
    const responseText = result.response.text()
    
    // 5. Send Response
    // We use rpc_send_message or insert directly.
    // rpc_send_message handles receiver logic nicely.
    const { data: sentMsg, error: sendError } = await supabase.rpc('rpc_send_message', {
      match_id: matchId,
      content: responseText,
      sender_id: targetBot.userid
    })
    
    if (sendError) throw sendError
    
    console.log(`Sent response from ${targetBot.username}: "${responseText.substring(0, 20)}..."`)
    
    // 6. Update AI State
    // Mark as processed up to the message we actually included in the context (checkpointId)
    await supabase.from('user_match_ai_state').update({
      ai_last_processed_message_id: checkpointId, 
      scheduled_response_at: null, // Clear schedule
      ai_locked_until: null // Unlock
    }).eq('match_id', matchId)
    
  } catch (err) {
    console.error(`Error processing match ${matchId}:`, err)
    // Unlock so it can retry later (or maybe backoff)
    await supabase.from('user_match_ai_state').update({
      ai_locked_until: null
    }).eq('match_id', matchId)
  }
}

// Run
main().catch(console.error)

async function refreshSystemPrompts() {
  console.log('Refreshing system prompts...')
  try {
    // We want the LATEST system prompt for each (gender, personality) tuple.
    // "SystemPrompts" table has: id, gender, personality, system_prompt, created_at
    // We can just fetch all and process in JS if list is small, or use distinct on.
    // Given the scale, fetching a few hundred rows is fine.
    
    const { data, error } = await supabase
      .from('SystemPrompts')
      .select('gender, personality, system_prompt, response_delay, created_at')
      .order('created_at', { ascending: false })
      
    if (error) {
       console.error('Error fetching system prompts:', error)
       return 
    }
    
    // Process: store only the FIRST occurrence (which is latest due to sort) for each key
    const newCache = new Map<string, CachedPrompt>()
    let count = 0
    
    for (const row of data || []) {
        const g = (row.gender || '').trim()
        const p = (row.personality || '').trim()
        const key = `${g}:${p}`
        
        if (!newCache.has(key)) {
            newCache.set(key, { 
                template: row.system_prompt,
                responseDelay: row.response_delay || 0
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

