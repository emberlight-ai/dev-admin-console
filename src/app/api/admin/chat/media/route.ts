import { NextRequest, NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/admin-auth";
import { supabaseAdmin } from "@/lib/supabase";

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function extensionForFile(file: File) {
  const fromName = file.name.split(".").pop()?.toLowerCase();
  if (fromName === "png" || fromName === "webp" || fromName === "gif") return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  return "jpg";
}

export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return jsonError("Unauthorized", 401);

  try {
    const formData = await req.formData();
    const file = formData.get("files");
    const matchId = formData.get("match_id");

    if (!(file instanceof File)) return jsonError("No file uploaded", 400);
    if (typeof matchId !== "string" || !matchId) return jsonError("Missing match_id", 400);
    if (!file.type.startsWith("image/")) return jsonError("Only image uploads are supported", 400);

    const { data: match, error: matchError } = await supabaseAdmin
      .from("user_matches")
      .select("id")
      .eq("id", matchId)
      .maybeSingle();

    if (matchError) return jsonError(matchError.message, 500);
    if (!match) return jsonError("match not found", 404);

    const fileExtension = extensionForFile(file);
    const path = `${matchId}/${crypto.randomUUID()}.${fileExtension}`;
    const fileBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabaseAdmin.storage
      .from("chat_media")
      .upload(path, fileBuffer, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) return jsonError(uploadError.message, 500);

    const { data: publicUrlData } = supabaseAdmin.storage.from("chat_media").getPublicUrl(path);

    return NextResponse.json({
      media_url: publicUrlData.publicUrl,
      path,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal server error during upload";
    return jsonError(message, 500);
  }
}
