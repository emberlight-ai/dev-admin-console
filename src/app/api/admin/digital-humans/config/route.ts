import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export const dynamic = 'force-dynamic'

const allowedKeys = [
  // Nearby invitations (DHs the user saw on the map reach out)
  "enable_nearby_invites",
  "avg_invites_per_nearby_call",
  "max_invites_per_nearby_call",
  "max_invites_per_day",
  "nearby_invite_cooldown_seconds",
  "nearby_invite_window_min_seconds",
  "nearby_invite_window_max_seconds",
  "accept_rate_percentage",
  "whitelisted_deck_ratio",
  "active_hour_start",
  "active_hour_end",
  "enable_digital_human_matching",
  "enable_digital_human_greeting",
  "enable_digital_human_auto_response",
  "enable_digital_human_follow_up",
  "enable_find_nearby_people",
  "min_user_age_minutes_for_invites",
  "enable_digital_human_selfies",
  "selfie_intimacy_threshold",
  "selfie_cooldown_hours",
  "selfie_cooldown_minutes",
  "enable_selfie_reciprocation",
  "selfie_reciprocate_gap_minutes",
  "selfie_tease_intimacy_threshold",
  "selfie_reward_intimacy_threshold",
  "selfie_early_casual_after_messages",
  "selfie_early_casual_max_intimacy",
  "intimacy_warmup_rate",
  "enable_proactive_double_text",
  "proactive_intimacy_drive_threshold",
  "proactive_delay_minutes",
  "proactive_extra_followups",
]

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("digital_human_config")
      .select("key, value")

    if (error) throw error

    const { data: overrideData, error: overrideError } = await supabaseAdmin
      .from("digital_human_personality_config")
      .select("personality, key, value")
      .in("key", allowedKeys)
      .order("personality", { ascending: true })
      .order("key", { ascending: true })

    if (overrideError) throw overrideError

    // Transform to simple key-value object
    const config: Record<string, string> = {}
    data?.forEach((row) => {
      config[row.key] = row.value
    })

    return NextResponse.json({ data: config, personality_overrides: overrideData ?? [] })
  } catch (err: unknown) {
    console.error("Error fetching config:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch config" },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const updates: { key: string; value: string }[] = []

    for (const key of allowedKeys) {
      if (typeof body[key] !== "undefined") {
        updates.push({ key, value: String(body[key]) })
      }
    }

    if (updates.length > 0) {
      const { error } = await supabaseAdmin
        .from("digital_human_config")
        .upsert(updates, { onConflict: "key" })

      if (error) throw error
    }

    let overrideUpdates = 0
    let overrideDeletes = 0
    const rawOverrides = body.personality_overrides
    if (rawOverrides && typeof rawOverrides === "object" && !Array.isArray(rawOverrides)) {
      const upserts: { personality: string; key: string; value: string }[] = []
      const deletes: { personality: string; key: string }[] = []

      for (const [personalityRaw, valuesRaw] of Object.entries(rawOverrides)) {
        const personality = personalityRaw.trim()
        if (!personality || !valuesRaw || typeof valuesRaw !== "object" || Array.isArray(valuesRaw)) continue

        for (const key of allowedKeys) {
          const value = (valuesRaw as Record<string, unknown>)[key]
          if (typeof value === "undefined") continue

          if (value === null || String(value).trim() === "") {
            deletes.push({ personality, key })
          } else {
            upserts.push({ personality, key, value: String(value) })
          }
        }
      }

      if (upserts.length > 0) {
        const { error } = await supabaseAdmin
          .from("digital_human_personality_config")
          .upsert(upserts, { onConflict: "personality,key" })

        if (error) throw error
        overrideUpdates = upserts.length
      }

      for (const item of deletes) {
        const { error } = await supabaseAdmin
          .from("digital_human_personality_config")
          .delete()
          .eq("personality", item.personality)
          .eq("key", item.key)

        if (error) throw error
      }
      overrideDeletes = deletes.length
    }

    return NextResponse.json({
      success: true,
      updated: updates.length,
      override_updated: overrideUpdates,
      override_deleted: overrideDeletes,
    })
  } catch (err: unknown) {
    console.error("Error saving config:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save config" },
      { status: 500 }
    )
  }
}
