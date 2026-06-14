import { NextRequest, NextResponse } from "next/server"

import { isAdminRequest } from "@/lib/admin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

const IMAGE_TIERS = ["unspecified", "casual", "tease", "reward"] as const

type ImageTier = (typeof IMAGE_TIERS)[number]

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

function extFor(contentType: string) {
  if (contentType === "image/png") return "png"
  return "jpg"
}

function nextPicIndex(existingNames: string[]) {
  const nums = existingNames
    .map((n) => {
      const m = n.match(/^pic_(\d+)\.(jpg|jpeg|png)$/i)
      return m ? Number(m[1]) : null
    })
    .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
  return (nums.length ? Math.max(...nums) : 0) + 1
}

function ordinalForName(name: string) {
  return Number(name.match(/^pic_(\d+)/i)?.[1] ?? 0) || 0
}

function isImageTier(value: unknown): value is ImageTier {
  return typeof value === "string" && IMAGE_TIERS.includes(value as ImageTier)
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError("Unauthorized", 401)
  const { userid } = await params

  const folder = `${userid}/chat_images`
  const { data, error } = await supabaseAdmin.storage.from("images").list(folder, {
    limit: 1000,
    offset: 0,
    sortBy: { column: "name", order: "asc" },
  })
  if (error) return jsonError(error.message, 500)

  const items = (data ?? [])
    .filter((x) => !!x.name && !x.name.endsWith("/"))
    .map((x) => {
      const path = `${folder}/${x.name}`
      const { data: pub } = supabaseAdmin.storage.from("images").getPublicUrl(path)
      return { name: x.name, path, url: pub.publicUrl }
    })
    .sort((a, b) => {
      const an = Number(a.name.match(/^pic_(\d+)/i)?.[1] ?? NaN)
      const bn = Number(b.name.match(/^pic_(\d+)/i)?.[1] ?? NaN)
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
      return a.name.localeCompare(b.name)
    })

  const paths = items.map((x) => x.path)
  const tierByPath = new Map<string, ImageTier>()
  if (paths.length) {
    const { data: rows, error: tierErr } = await supabaseAdmin
      .from("dh_chat_images")
      .select("storage_path,image_tier")
      .in("storage_path", paths)
    if (tierErr) return jsonError(tierErr.message, 500)

    for (const row of rows ?? []) {
      const r = row as { storage_path?: string | null; image_tier?: string | null }
      if (r.storage_path && isImageTier(r.image_tier)) {
        tierByPath.set(r.storage_path, r.image_tier)
      }
    }
  }

  return NextResponse.json({
    data: items.map((x) => ({
      name: x.name,
      url: x.url,
      image_tier: tierByPath.get(x.path) ?? "unspecified",
    })),
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError("Unauthorized", 401)
  const { userid } = await params

  const form = await req.formData()
  const file = form.get("file")
  if (!(file instanceof File)) return jsonError("Missing file", 400)

  const contentType = file.type || "application/octet-stream"
  if (contentType !== "image/jpeg" && contentType !== "image/png") {
    return jsonError("Only image/jpeg or image/png supported", 400)
  }

  const folder = `${userid}/chat_images`
  const { data: existing, error: listErr } = await supabaseAdmin.storage.from("images").list(folder, {
    limit: 1000,
    offset: 0,
  })
  if (listErr) return jsonError(listErr.message, 500)

  const idx = nextPicIndex((existing ?? []).map((x) => x.name))
  const filePath = `${folder}/pic_${idx}.${extFor(contentType)}`

  const { error: uploadError } = await supabaseAdmin.storage
    .from("images")
    .upload(filePath, file, { upsert: false, contentType })
  if (uploadError) return jsonError(uploadError.message, 500)

  const { data: pub } = supabaseAdmin.storage.from("images").getPublicUrl(filePath)
  const imageTier: ImageTier = "unspecified"

  const { error: metaErr } = await supabaseAdmin.from("dh_chat_images").upsert(
    {
      dh_user_id: userid,
      storage_path: filePath,
      public_url: pub.publicUrl,
      ordinal: idx,
      image_tier: imageTier,
      active: true,
    },
    { onConflict: "storage_path" }
  )
  if (metaErr) return jsonError(metaErr.message, 500)

  return NextResponse.json({
    added: { name: `pic_${idx}.${extFor(contentType)}`, url: pub.publicUrl, image_tier: imageTier },
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError("Unauthorized", 401)
  const { userid } = await params

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return jsonError("Invalid JSON body", 400)
  }
  if (!body || typeof body !== "object") return jsonError("Invalid JSON body", 400)

  const b = body as Record<string, unknown>
  const name = typeof b.name === "string" ? b.name.trim() : ""
  if (!name || name.includes("/") || name.endsWith("/")) return jsonError("Invalid image name", 400)
  if (!isImageTier(b.image_tier)) return jsonError("Invalid image_tier", 400)
  const imageTier = b.image_tier

  const storagePath = `${userid}/chat_images/${name}`
  const { data: pub } = supabaseAdmin.storage.from("images").getPublicUrl(storagePath)

  const { data, error } = await supabaseAdmin
    .from("dh_chat_images")
    .upsert(
      {
        dh_user_id: userid,
        storage_path: storagePath,
        public_url: pub.publicUrl,
        ordinal: ordinalForName(name),
        image_tier: imageTier,
        active: true,
      },
      { onConflict: "storage_path" }
    )
    .select("storage_path,image_tier")
    .maybeSingle()

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ data })
}
