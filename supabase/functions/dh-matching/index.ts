// @ts-nocheck
// Supabase Edge Function (Deno runtime) — replaces scripts/digital-human-matching-automation.ts
// Triggered by: pg_cron every 5 minutes via pg_net HTTP call
// See setup instructions in walkthrough.md
import { createClient } from 'jsr:@supabase/supabase-js@2';

// ── Client ─────────────────────────────────────────────────────────────────────
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

// ── Config cache ───────────────────────────────────────────────────────────────
interface Config {
  activeStart: number;
  activeEnd: number;
  maxInvitesPerUser: number;
  invitesPerRun: number;
  exp: number;
}

const globalConfig = (globalThis as any).__dhMatchConfig as Config | undefined;
let config: Config = globalConfig ?? {
  activeStart: 5,
  activeEnd: 23,
  maxInvitesPerUser: 5,
  invitesPerRun: 1,
  exp: 0,
};
const CONFIG_TTL_MS = 5 * 60 * 1000;

async function ensureConfig() {
  if (Date.now() < config.exp) return;
  const { data } = await supabase.from('digital_human_config').select('key, value');
  const map: Record<string, string> = {};
  for (const r of data ?? []) map[r.key] = r.value;
  config = {
    activeStart: parseInt(map['active_hour_start'] ?? '5', 10),
    activeEnd: parseInt(map['active_hour_end'] ?? '23', 10),
    maxInvitesPerUser: parseInt(map['max_invites_per_user'] ?? '5', 10),
    invitesPerRun: parseInt(map['invites_per_cron_run'] ?? '1', 10),
    exp: Date.now() + CONFIG_TTL_MS,
  };
  (globalThis as any).__dhMatchConfig = config;
}

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function isActiveHour(): boolean {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric',
    hour12: false,
  });
  const currentHourPst = parseInt(formatter.format(new Date()), 10);
  return currentHourPst >= config.activeStart && currentHourPst <= config.activeEnd;
}

// ── Main handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  // Auth is handled by Supabase Edge Runtime gateway (JWT verification).
  // No custom check needed — if we reach here, the service_role JWT was valid.
  try {
    await ensureConfig();

    if (!isActiveHour()) {
      console.log('[dh-matching] Outside active hours (PST). Skipping.');
      return new Response(JSON.stringify({ ok: true, skipped: 'outside active hours' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Randomize batch size for natural-looking invite cadence
    const batchSize = getRandomInt(1, Math.max(1, config.invitesPerRun));
    console.log(`[dh-matching] Sending up to ${batchSize} invites...`);

    const results: Record<string, unknown> = {};

    // Send invites
    const { data: inviteData, error: inviteErr } = await supabase.rpc('send_digital_human_invites', {
      p_limit: batchSize,
    });
    if (inviteErr) {
      console.error('[dh-matching] Error sending invites:', inviteErr);
      results.invites = { error: inviteErr.message };
    } else {
      console.log(`[dh-matching] Sent ${inviteData} invites.`);
      results.invites = { sent: inviteData };
    }

    // Process pending requests
    const { data: requestData, error: requestErr } = await supabase.rpc('process_digital_human_requests', {
      p_limit: 3,
    });
    if (requestErr) {
      console.error('[dh-matching] Error processing requests:', requestErr);
      results.requests = { error: requestErr.message };
    } else {
      const summary =
        Array.isArray(requestData) && requestData.length > 0
          ? requestData[0]
          : { accepted: 0, rejected: 0 };
      console.log('[dh-matching] Processed requests:', summary);
      results.requests = summary;
    }

    return new Response(JSON.stringify({ ok: true, ...results }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[dh-matching] Fatal error:', err);
    return new Response(String(err), { status: 500 });
  }
});
