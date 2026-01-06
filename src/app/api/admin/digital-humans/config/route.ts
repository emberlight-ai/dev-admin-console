import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase"

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const { data, error } = await supabaseAdmin
      .from("digital_human_config")
      .select("key, value")

    if (error) throw error

    // Transform to simple key-value object
    const config: Record<string, string> = {}
    data?.forEach((row) => {
      config[row.key] = row.value
    })

    return NextResponse.json({ data: config })
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

    // Whitelist allowed keys to prevent pollution
    const allowedKeys = [
      "max_invites_per_user",
      "invites_per_cron_run",
      "accept_rate_percentage",
      "active_hour_start",
      "active_hour_end",
      "enable_digital_human_auto_response",
      "enable_digital_human_follow_up",
    ]

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

    return NextResponse.json({ success: true, updated: updates.length })
  } catch (err: unknown) {
    console.error("Error saving config:", err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save config" },
      { status: 500 }
    )
  }
}
