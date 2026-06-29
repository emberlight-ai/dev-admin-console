import { NextRequest, NextResponse } from "next/server"

import { supabaseAdmin } from "@/lib/supabase"

// Every save of a personality writes a NEW SystemPrompts row (versioning), so the
// previous versions for a (gender, personality) are simply the older rows. This
// returns them newest-first with just the prompt fields needed for the per-section
// rollback UI on the manage page.
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
    .select("id,created_at,system_prompt,active_greeting_prompt,follow_up_message_prompt")
    .eq("gender", gender)
    .eq("personality", personality)
    .order("created_at", { ascending: false })
    .limit(100)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [] })
}
