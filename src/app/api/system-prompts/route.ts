import { NextRequest, NextResponse } from "next/server"

import { supabaseAdmin } from "@/lib/supabase"

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const gender = typeof body?.gender === "string" ? body.gender.trim() : ""
    const personality = typeof body?.personality === "string" ? body.personality.trim() : ""
    const system_prompt = typeof body?.system_prompt === "string" ? body.system_prompt : ""
    const matching_enabled =
      typeof body?.matching_enabled === "boolean" ? body.matching_enabled : true
    const immediate_match_enabled =
      typeof body?.immediate_match_enabled === "boolean" ? body.immediate_match_enabled : false
    const follow_up_message_enabled = typeof body?.follow_up_message_enabled === "boolean" ? body.follow_up_message_enabled : false
    const follow_up_message_prompt = typeof body?.follow_up_message_prompt === "string" ? body.follow_up_message_prompt : ""
    const follow_up_delay = typeof body?.follow_up_delay === "number" ? body.follow_up_delay : 86400
    const max_follow_ups = typeof body?.max_follow_ups === "number" ? body.max_follow_ups : 3
    const active_greeting_enabled =
      typeof body?.active_greeting_enabled === "boolean" ? body.active_greeting_enabled : false
    const active_greeting_prompt =
      typeof body?.active_greeting_prompt === "string" ? body.active_greeting_prompt : ""

    // Reply pacing + human-like silence (read by the dh-auto-reply edge function).
    const numOr = (v: unknown, fallback: number) =>
      typeof v === "number" && Number.isFinite(v) ? v : fallback
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

    const reply_min_delay_seconds = clamp(Math.round(numOr(body?.reply_min_delay_seconds, 2)), 0, 60)
    const reply_max_delay_seconds = clamp(
      Math.round(numOr(body?.reply_max_delay_seconds, 18)),
      reply_min_delay_seconds,
      60
    )
    const reply_chars_per_second = clamp(numOr(body?.reply_chars_per_second, 15), 1, 100)
    const skip_reply_enabled =
      typeof body?.skip_reply_enabled === "boolean" ? body.skip_reply_enabled : false
    const skip_reply_base_chance = clamp(numOr(body?.skip_reply_base_chance, 0.1), 0, 1)
    const skip_reply_intimacy_drop_chance = clamp(numOr(body?.skip_reply_intimacy_drop_chance, 0.5), 0, 1)
    const skip_reply_intimacy_drop_delta = clamp(numOr(body?.skip_reply_intimacy_drop_delta, 5), 0, 100)
    const skip_reply_max_consecutive = clamp(Math.round(numOr(body?.skip_reply_max_consecutive, 1)), 0, 10)

    if (!gender) return jsonError("Missing required field: gender", 400)
    if (!personality) return jsonError("Missing required field: personality", 400)
    if (!system_prompt.trim()) return jsonError("Missing required field: system_prompt", 400)
    if (follow_up_delay < 0) return jsonError("follow_up_delay must be positive", 400)
    if (max_follow_ups < 0 || max_follow_ups > 10) return jsonError("max_follow_ups should be reasonable (0-10)", 400)

    if (active_greeting_enabled && !active_greeting_prompt.trim()) {
      return jsonError("active_greeting_prompt is required when active_greeting_enabled is true", 400)
    }

    const { data, error } = await supabaseAdmin
      .from("SystemPrompts")
      .insert({ 
        gender, 
        personality, 
        system_prompt,
        matching_enabled,
        immediate_match_enabled,
        follow_up_message_enabled,
        follow_up_message_prompt,
        follow_up_delay,
        max_follow_ups,
        active_greeting_enabled,
        active_greeting_prompt: active_greeting_prompt.trim() || null,
        reply_min_delay_seconds,
        reply_max_delay_seconds,
        reply_chars_per_second,
        skip_reply_enabled,
        skip_reply_base_chance,
        skip_reply_intimacy_drop_chance,
        skip_reply_intimacy_drop_delta,
        skip_reply_max_consecutive
      })
      .select("id,gender,personality,created_at,matching_enabled")
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ data })
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}


