import { NextRequest, NextResponse } from "next/server"

import { isAdminRequest } from "@/lib/admin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function slugify(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

/** GET /api/admin/interest-categories → categories (incl. hidden) + interest counts. */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError("Unauthorized", 401)

  const { data: categories, error } = await supabaseAdmin
    .from("interest_categories")
    .select("key, name, asset, sort_order, active, admin_only, created_at")
    .order("sort_order")
  if (error) return jsonError(error.message, 500)

  const { data: interests, error: iErr } = await supabaseAdmin
    .from("interests")
    .select("category_key")
  if (iErr) return jsonError(iErr.message, 500)

  const counts: Record<string, number> = {}
  for (const r of interests ?? []) {
    const k = (r as { category_key: string }).category_key
    counts[k] = (counts[k] ?? 0) + 1
  }

  return NextResponse.json({
    data: (categories ?? []).map((c) => ({ ...c, interest_count: counts[c.key] ?? 0 })),
  })
}

/** POST /api/admin/interest-categories { name, key?, asset?, sort_order?, admin_only? } */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError("Unauthorized", 401)

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }
  const b = body as Record<string, unknown>
  const name = typeof b.name === "string" ? b.name.trim() : ""
  if (!name) return jsonError("Name is required", 400)

  const key = typeof b.key === "string" && b.key.trim() ? slugify(b.key) : slugify(name)
  if (!key) return jsonError("Could not derive a key from the name", 400)
  if (key === "unspecified") return jsonError("Reserved key", 400)

  const { data, error } = await supabaseAdmin
    .from("interest_categories")
    .insert({
      key,
      name,
      asset: typeof b.asset === "string" && b.asset.trim() ? b.asset.trim() : "explore_gothic",
      sort_order: typeof b.sort_order === "number" ? b.sort_order : 0,
      admin_only: b.admin_only === true,
    })
    .select("key, name, asset, sort_order, active, admin_only, created_at")
    .single()

  if (error) {
    if (error.code === "23505") return jsonError(`Category "${key}" already exists`, 409)
    return jsonError(error.message, 500)
  }
  return NextResponse.json({ data: { ...data, interest_count: 0 } })
}
