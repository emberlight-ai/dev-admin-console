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

    if (!gender) return jsonError("Missing required field: gender", 400)
    if (!personality) return jsonError("Missing required field: personality", 400)
    if (!system_prompt.trim()) return jsonError("Missing required field: system_prompt", 400)
    if (response_delay < 0 || response_delay > 86400) return jsonError("response_delay must be between 0 and 86400", 400)

    const { data, error } = await supabaseAdmin
      .from("SystemPrompts")
      .insert({ gender, personality, system_prompt, response_delay })
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


