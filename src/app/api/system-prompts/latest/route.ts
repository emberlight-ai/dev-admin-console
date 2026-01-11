import { NextRequest, NextResponse } from "next/server"

import { supabaseAdmin } from "@/lib/supabase"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const gender = (searchParams.get("gender") ?? "").trim()
  const personality = (searchParams.get("personality") ?? "").trim()

  if (!gender || !personality) {
    return NextResponse.json(
      { error: "Missing required query params: gender, personality" },
      { status: 400 }
    )
  }

  const { data, error } = await supabaseAdmin
    .from("SystemPrompts")
    .select("system_prompt,created_at,response_delay,matching_enabled,immediate_match_enabled,follow_up_message_enabled,follow_up_message_prompt,follow_up_delay,max_follow_ups,active_greeting_enabled,active_greeting_prompt")
    .eq("gender", gender)
    .eq("personality", personality)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Return null if missing, per spec.
  return NextResponse.json({ data: data ?? null })
}


