import { NextRequest, NextResponse } from "next/server"

import { isAdminRequest } from "@/lib/admin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

const BUCKET = "images"
const PREFIX = "shared-chat"
const ACCEPTED = new Set(["image/jpeg", "image/png", "image/webp"])
const MAX_BYTES = 8 * 1024 * 1024
const TIERS = new Set(["unspecified", "casual", "tease", "reward"])

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function extFor(mime: string) {
  if (mime === "image/png") return "png"
  if (mime === "image/webp") return "webp"
  return "jpg"
}

/**
 * GET /api/admin/shared-images?tier=casual&cursor=<iso>&limit=30
 *
 * Keyset pagination (created_at DESC): the client passes the last row's
 * created_at as `cursor` to page forward. Keyset (not offset) so newly
 * uploaded rows don't shift the window and cause dupes/skips in the infinite
 * scroll.
 */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError("Unauthorized", 401)

  const url = new URL(req.url)
  const tier = url.searchParams.get("tier") ?? "casual"
  if (!TIERS.has(tier)) return jsonError("Invalid tier", 400)
  const cursor = url.searchParams.get("cursor")
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 30, 1), 60)

  let query = supabaseAdmin
    .from("shared_chat_images")
    .select("id, public_url, tier, description, post_content, interests, time_of_day, location_name, active, created_at")
    .eq("tier", tier)
    .order("created_at", { ascending: false })
    .limit(limit + 1) // fetch one extra to know if there's a next page

  if (cursor) query = query.lt("created_at", cursor)

  const { data, error } = await query
  if (error) return jsonError(error.message, 500)

  const rows = data ?? []
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? page[page.length - 1]?.created_at ?? null : null

  return NextResponse.json({ images: page, nextCursor, hasMore })
}

/**
 * POST /api/admin/shared-images  (multipart/form-data)
 *   files[]        one or more images
 *   descriptions[] parallel array (per-image; optional)
 *   tier           folder (default casual)
 *   post_content   batch caption (optional)
 *   interests      JSON array of interest keys (batch; validated)
 *   location_name / latitude / longitude  (batch; optional)
 *
 * Uploads each file to images/shared-chat/ and inserts one row per image with
 * its own description + the shared batch metadata.
 */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError("Unauthorized", 401)

  const form = await req.formData()
  const files = form.getAll("files").filter((f): f is File => f instanceof File)
  if (files.length === 0) return jsonError("No files provided", 400)

  const descriptions = form.getAll("descriptions").map((d) => (typeof d === "string" ? d : ""))
  const tier = String(form.get("tier") ?? "casual")
  if (!TIERS.has(tier)) return jsonError("Invalid tier", 400)
  const postContent = (form.get("post_content") as string | null)?.trim() || null
  const timeRaw = String(form.get("time_of_day") ?? "")
  const timeOfDay = ["morning", "afternoon", "evening"].includes(timeRaw) ? timeRaw : null
  const locationName = (form.get("location_name") as string | null)?.trim() || null
  const latRaw = form.get("latitude")
  const lonRaw = form.get("longitude")
  const latitude = latRaw != null && latRaw !== "" ? Number(latRaw) : null
  const longitude = lonRaw != null && lonRaw !== "" ? Number(lonRaw) : null

  // Interests: validate against the active catalog (drop unknowns).
  let interests: string[] = []
  try {
    const parsed = JSON.parse(String(form.get("interests") ?? "[]"))
    if (Array.isArray(parsed)) interests = parsed.filter((k): k is string => typeof k === "string")
  } catch {
    interests = []
  }
  if (interests.length > 0) {
    const { data: valid } = await supabaseAdmin
      .from("interests")
      .select("key")
      .in("key", interests)
    const validKeys = new Set((valid ?? []).map((r) => r.key))
    interests = interests.filter((k) => validKeys.has(k))
  }

  const created: unknown[] = []
  const errors: string[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const contentType = file.type || "application/octet-stream"
    if (!ACCEPTED.has(contentType)) {
      errors.push(`${file.name}: unsupported type ${contentType}`)
      continue
    }
    if (file.size > MAX_BYTES) {
      errors.push(`${file.name}: exceeds 8MB`)
      continue
    }

    const filePath = `${PREFIX}/${tier}/${crypto.randomUUID()}.${extFor(contentType)}`
    const { error: uploadErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(filePath, file, { upsert: false, contentType })
    if (uploadErr) {
      errors.push(`${file.name}: ${uploadErr.message}`)
      continue
    }

    const { data: pub } = supabaseAdmin.storage.from(BUCKET).getPublicUrl(filePath)

    const { data: row, error: insErr } = await supabaseAdmin
      .from("shared_chat_images")
      .insert({
        storage_path: filePath,
        public_url: pub.publicUrl,
        tier,
        description: descriptions[i]?.trim() || null,
        post_content: postContent,
        interests,
        time_of_day: timeOfDay,
        location_name: locationName,
        latitude,
        longitude,
      })
      .select("id, public_url, tier, description, post_content, interests, time_of_day, location_name, active, created_at")
      .single()

    if (insErr) {
      // Roll back the orphaned upload so storage doesn't accumulate junk.
      await supabaseAdmin.storage.from(BUCKET).remove([filePath])
      errors.push(`${file.name}: ${insErr.message}`)
      continue
    }
    created.push(row)
  }

  return NextResponse.json({ created, errors, count: created.length })
}
