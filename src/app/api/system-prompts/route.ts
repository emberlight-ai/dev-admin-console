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
    const response_delay = typeof body?.response_delay === "number" ? body.response_delay : 0
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

    if (!gender) return jsonError("Missing required field: gender", 400)
    if (!personality) return jsonError("Missing required field: personality", 400)
    if (!system_prompt.trim()) return jsonError("Missing required field: system_prompt", 400)
    if (response_delay < 0 || response_delay > 86400) return jsonError("response_delay must be between 0 and 86400", 400)
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
        response_delay,
        immediate_match_enabled,
        follow_up_message_enabled,
        follow_up_message_prompt,
        follow_up_delay,
        max_follow_ups,
        active_greeting_enabled,
        active_greeting_prompt: active_greeting_prompt.trim() || null
      })
      .select("id,gender,personality,created_at,response_delay")
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


