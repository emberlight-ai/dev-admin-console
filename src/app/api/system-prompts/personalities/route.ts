import { NextRequest, NextResponse } from "next/server"

import { supabaseAdmin } from "@/lib/supabase"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const gender = (searchParams.get("gender") ?? "").trim()
  if (!gender) {
    return NextResponse.json({ error: "Missing required query param: gender" }, { status: 400 })
  }

  // Get distinct personalities for this gender.
  // PostgREST supports distinct via `select=...` with `order` but not a direct DISTINCT in supabase-js,
  // so we fetch rows and de-dupe in memory.
  const { data, error } = await supabaseAdmin
    .from("SystemPrompts")
    .select("personality,created_at")
    .eq("gender", gender)
    .order("created_at", { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const seen = new Set<string>()
  const personalities: string[] = []
  for (const row of data ?? []) {
    const p = (row as { personality?: string | null }).personality
    if (!p) continue
    if (seen.has(p)) continue
    seen.add(p)
    personalities.push(p)
  }

  return NextResponse.json({ data: personalities })
}


