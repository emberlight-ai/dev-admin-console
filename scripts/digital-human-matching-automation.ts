import { createClient } from '@supabase/supabase-js'
import 'dotenv/config'

// ---- Env / clients ----
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables: SUPABASE_URL, SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

// ---- Config ----
// Base interval is 13 minutes
const BASE_INTERVAL_MINUTES = 13
// Jitter is up to 5 minutes
const JITTER_MAX_MINUTES = 5

// Default active hours (PST) if not in DB
const DEFAULT_ACTIVE_START = 5
const DEFAULT_ACTIVE_END = 23
const DEFAULT_INVITES_PER_RUN = 5

interface DigitalHumanConfigRow {
  key: string
  value: string
}

let config = {
  activeStart: DEFAULT_ACTIVE_START,
  activeEnd: DEFAULT_ACTIVE_END,
  maxInvitesPerUser: 5,
  invitesPerRun: DEFAULT_INVITES_PER_RUN,
}

// ---- Helpers ----
async function refreshConfig() {
  const { data, error } = await supabase.from('digital_human_config').select('key, value')
  if (error) {
    console.error('[dh-matches] Error fetching config:', error)
    return
  }
  const rows = (data ?? []) as unknown as DigitalHumanConfigRow[]
  const map: Record<string, string> = {}
  for (const r of rows) map[r.key] = r.value

  config.activeStart = parseInt(map['active_hour_start'] ?? String(DEFAULT_ACTIVE_START), 10)
  config.activeEnd = parseInt(map['active_hour_end'] ?? String(DEFAULT_ACTIVE_END), 10)
  config.maxInvitesPerUser = parseInt(map['max_invites_per_user'] ?? '5', 10)
  config.invitesPerRun = parseInt(map['invites_per_cron_run'] ?? String(DEFAULT_INVITES_PER_RUN), 10)
}

function getRandomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function isActiveHour(): boolean {
  // Get current hour in PST (America/Los_Angeles)
  // We can use Intl.DateTimeFormat for robust timezone handling
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  })
  const currentHourPst = parseInt(formatter.format(new Date()), 10)
  return currentHourPst >= config.activeStart && currentHourPst <= config.activeEnd
}

// ---- Core Logic ----
async function sendInvites() {
  // Randomize batch size: between 1 and config.invitesPerRun
  // This adds "small batch more randomness" as requested
  const batchSize = getRandomInt(1, Math.max(1, config.invitesPerRun))
  
  console.log(`[dh-matches] Sending up to ${batchSize} invites...`)
  const { data, error } = await supabase.rpc('send_digital_human_invites', { p_limit: batchSize })
  
  if (error) {
    console.error('[dh-matches] Error sending invites:', error)
  } else {
    console.log(`[dh-matches] Sent ${data} invites.`)
  }
}

async function processRequests() {
  // We can process a small batch of requests as well.
  // The SQL function has a default limit of 3, but we can parameterize it if we want.
  // Let's stick to the default or a small random number.
  const limit = 3
  console.log(`[dh-matches] Processing requests (limit ${limit})...`)
  
  // The SQL function returns a table (accepted, rejected), so use rpc
  const { data, error } = await supabase.rpc('process_digital_human_requests', { p_limit: limit })
  
  if (error) {
    console.error('[dh-matches] Error processing requests:', error)
  } else {
    // data is an array of rows, e.g. [{ accepted: 1, rejected: 0 }]
    if (Array.isArray(data) && data.length > 0) {
        console.log(`[dh-matches] Processed requests: Accepted ${data[0].accepted}, Rejected ${data[0].rejected}`)
    } else {
        console.log(`[dh-matches] Processed requests (no data returned)`)
    }
  }
}

async function runCycle() {
    await refreshConfig()

    if (!isActiveHour()) {
        console.log('[dh-matches] Outside active hours (PST). Skipping work.')
        return
    }

    try {
        await sendInvites()
    } catch (e) {
        console.error('[dh-matches] unexpected error in sendInvites', e)
    }

    try {
        await processRequests()
    } catch (e) {
        console.error('[dh-matches] unexpected error in processRequests', e)
    }
}

async function main() {
  console.log('[dh-matches] Starting automation service...')
  
  // Initial run
  await runCycle()

  // Loop
  while (true) {
    // Calculate sleep time
    // 13 minutes + random(0..5) minutes
    const baseMs = BASE_INTERVAL_MINUTES * 60 * 1000
    const jitterMs = getRandomInt(0, JITTER_MAX_MINUTES * 60 * 1000)
    const sleepMs = baseMs + jitterMs
    const sleepMinutes = (sleepMs / 60000).toFixed(2)

    console.log(`[dh-matches] Sleeping for ${sleepMinutes} minutes...`)
    
    await new Promise((resolve) => setTimeout(resolve, sleepMs))
    
    await runCycle()
  }
}

main().catch((e) => {
  console.error('[dh-matches] Fatal error:', e)
  process.exit(1)
})
