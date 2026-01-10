import { NextRequest, NextResponse } from "next/server"

import { isAdminRequest } from "@/lib/admin-auth"
import { supabaseAdmin } from "@/lib/supabase"

export const runtime = "nodejs"

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
      return { name: x.name, url: pub.publicUrl }
    })
    .sort((a, b) => {
      const an = Number(a.name.match(/^pic_(\d+)/i)?.[1] ?? NaN)
      const bn = Number(b.name.match(/^pic_(\d+)/i)?.[1] ?? NaN)
      if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn
      return a.name.localeCompare(b.name)
    })

  return NextResponse.json({ data: items })
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
  return NextResponse.json({ added: { name: `pic_${idx}.${extFor(contentType)}`, url: pub.publicUrl } })
}

