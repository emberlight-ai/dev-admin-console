import { NextRequest, NextResponse } from "next/server"

import { isAdminRequest } from "@/lib/admin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

const BUCKET = "images"

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

/** PATCH /api/admin/shared-images/[id] — edit description, tags, tier, active. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return jsonError("Unauthorized", 401)
  const { id } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }
  const b = body as Record<string, unknown>
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (typeof b.description === "string") patch.description = b.description.trim() || null
  if (typeof b.post_content === "string") patch.post_content = b.post_content.trim() || null
  if (typeof b.active === "boolean") patch.active = b.active
  if (["unspecified", "casual", "tease", "reward"].includes(String(b.tier))) patch.tier = b.tier
  if (b.time_of_day === null || ["morning", "afternoon", "evening"].includes(String(b.time_of_day)))
    patch.time_of_day = b.time_of_day
  if (Array.isArray(b.interests)) {
    const keys = b.interests.filter((k): k is string => typeof k === "string")
    const { data: valid } = await supabaseAdmin.from("interests").select("key").in("key", keys)
    const validKeys = new Set((valid ?? []).map((r) => r.key))
    patch.interests = keys.filter((k) => validKeys.has(k))
  }

  const { data, error } = await supabaseAdmin
    .from("shared_chat_images")
    .update(patch)
    .eq("id", id)
    .select("id, public_url, tier, description, post_content, interests, time_of_day, location_name, active, created_at")
    .maybeSingle()

  if (error) return jsonError(error.message, 500)
  if (!data) return jsonError("Image not found", 404)
  return NextResponse.json({ data })
}

/** DELETE /api/admin/shared-images/[id] — remove the row + its storage object. */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminRequest(req)) return jsonError("Unauthorized", 401)
  const { id } = await params

  const { data: row, error: fetchErr } = await supabaseAdmin
    .from("shared_chat_images")
    .select("storage_path")
    .eq("id", id)
    .maybeSingle()
  if (fetchErr) return jsonError(fetchErr.message, 500)
  if (!row) return jsonError("Image not found", 404)

  // Delete the DB row first (shared_image_sends cascades). If the storage
  // remove fails, the object is orphaned but no dangling row references it.
  const { error: delErr } = await supabaseAdmin.from("shared_chat_images").delete().eq("id", id)
  if (delErr) return jsonError(delErr.message, 500)

  await supabaseAdmin.storage.from(BUCKET).remove([row.storage_path])

  return NextResponse.json({ ok: true })
}
