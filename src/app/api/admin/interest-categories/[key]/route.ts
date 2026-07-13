import { NextRequest, NextResponse } from "next/server"

import { isAdminRequest } from "@/lib/admin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** PATCH /api/admin/interest-categories/[key] — edit name, asset, order, hide, admin_only. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError("Unauthorized", 401)
  const { key } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }
  const b = body as Record<string, unknown>
  const patch: Record<string, unknown> = {}
  if (typeof b.name === "string") patch.name = b.name.trim()
  if (typeof b.asset === "string" && b.asset.trim()) patch.asset = b.asset.trim()
  if (typeof b.sort_order === "number") patch.sort_order = b.sort_order
  if (typeof b.active === "boolean") patch.active = b.active
  if (typeof b.admin_only === "boolean") patch.admin_only = b.admin_only

  if (Object.keys(patch).length === 0) return jsonError("Nothing to update", 400)

  const { data, error } = await supabaseAdmin
    .from("interest_categories")
    .update(patch)
    .eq("key", key)
    .select("key, name, asset, sort_order, active, admin_only")
    .maybeSingle()

  if (error) return jsonError(error.message, 500)
  if (!data) return jsonError("Category not found", 404)
  return NextResponse.json({ data })
}

/**
 * DELETE /api/admin/interest-categories/[key]
 *
 * The interests underneath are reparented to 'unspecified' automatically by the
 * FK (interests.category_key ON DELETE SET DEFAULT) — no manual reassignment.
 * 'unspecified' itself is protected by a DB trigger.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> }
) {
  if (!isAdminRequest(req)) return jsonError("Unauthorized", 401)
  const { key } = await params

  if (key === "unspecified") return jsonError("The unspecified category cannot be deleted", 400)
  // Featured and Whitelist are internal-control categories the app + matching
  // depend on (Whitelist deletion would sever the users.whitelisted bridge).
  if (key === "featured" || key === "whitelist") {
    return jsonError("This is an internal category and cannot be deleted", 400)
  }

  const { error } = await supabaseAdmin.from("interest_categories").delete().eq("key", key)
  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ ok: true })
}
