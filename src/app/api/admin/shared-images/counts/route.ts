import { NextRequest, NextResponse } from "next/server"

import { isAdminRequest } from "@/lib/admin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

/** GET /api/admin/shared-images/counts → { counts: { casual: n, ... } } */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tiers = ["casual", "tease", "reward"]
  const entries = await Promise.all(
    tiers.map(async (tier) => {
      const { count } = await supabaseAdmin
        .from("shared_chat_images")
        .select("id", { count: "exact", head: true })
        .eq("tier", tier)
      return [tier, count ?? 0] as const
    })
  )
  return NextResponse.json({ counts: Object.fromEntries(entries) })
}
