import { NextRequest, NextResponse } from "next/server"

import { supabaseAdmin } from "@/lib/supabase"

type RenameResult = {
  gender: string
  old: string
  new: string
  prompts_updated: number
  digital_humans_updated: number
  config_overrides_updated: number
}

// Rename a personality everywhere it's used (prompt versions, live digital
// humans, shared config overrides) in one transaction via rpc_rename_personality.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const gender = typeof body?.gender === "string" ? body.gender.trim() : ""
    const oldPersonality =
      typeof body?.old_personality === "string" ? body.old_personality.trim() : ""
    const newPersonality =
      typeof body?.new_personality === "string" ? body.new_personality.trim() : ""

    if (!gender) {
      return NextResponse.json({ error: "Missing required field: gender" }, { status: 400 })
    }
    if (!oldPersonality) {
      return NextResponse.json({ error: "Missing required field: old_personality" }, { status: 400 })
    }
    if (!newPersonality) {
      return NextResponse.json({ error: "Missing required field: new_personality" }, { status: 400 })
    }
    if (oldPersonality.toLowerCase() === newPersonality.toLowerCase()) {
      return NextResponse.json({ error: "New name matches the current name" }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin.rpc("rpc_rename_personality", {
      p_gender: gender,
      p_old: oldPersonality,
      p_new: newPersonality,
    })

    if (error) {
      // 23505 (unique_violation) — new name already used by another personality of this gender.
      if (error.code === "23505" || /PERSONALITY_NAME_TAKEN/.test(error.message)) {
        return NextResponse.json(
          { error: `"${newPersonality}" is already used by another ${gender} personality.` },
          { status: 409 }
        )
      }
      // P0002 (no_data_found) — the personality to rename doesn't exist.
      if (error.code === "P0002") {
        return NextResponse.json(
          { error: `No prompt found for ${gender} / ${oldPersonality}.` },
          { status: 404 }
        )
      }
      // 23514 (check_violation) — bad input caught by the function's guards.
      if (error.code === "23514") {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ data: data as RenameResult })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
