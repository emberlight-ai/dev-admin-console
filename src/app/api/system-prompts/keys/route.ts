import { NextRequest, NextResponse } from "next/server"

import { supabaseAdmin } from "@/lib/supabase"

type KeyRow = { gender: string; personality: string; created_at: string }

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const gender = (searchParams.get("gender") ?? "all").trim()

  let q = supabaseAdmin
    .from("SystemPrompts")
    .select("gender,personality,created_at")
    .order("created_at", { ascending: false })
    .limit(1000)

  if (gender !== "all") {
    q = q.eq("gender", gender)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Latest row per (gender, personality) since query is ordered newest-first.
  const seen = new Set<string>()
  const keys: KeyRow[] = []
  for (const r of (data ?? []) as KeyRow[]) {
    const g = r.gender
    const p = r.personality
    if (!g || !p) continue
    const k = `${g}::${p}`
    if (seen.has(k)) continue
    seen.add(k)
    keys.push({ gender: g, personality: p, created_at: r.created_at })
  }

  return NextResponse.json({ data: keys })
}


