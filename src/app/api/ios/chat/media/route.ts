import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withLogging } from "@/lib/with-logging";

const getUserSupabase = (req: NextRequest) => {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw new Error('Missing Authorization header');
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: authHeader } },
    }
  );
};

async function handlePOST(req: NextRequest) {
  try {
    const supabase = getUserSupabase(req);

    const authHeader = req.headers.get("authorization");
    const token = authHeader ? authHeader.split(" ")[1] : null;

    // Verify user exists and token is valid
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token || "");

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // 2. Parse form data
    const formData = await req.formData();
    const file = formData.get("files") as File | null; // Using "files" to match iOS convention shown
    const matchId = formData.get("match_id") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // 3. Prepare for Supabase Storage
    const fileBuffer = await file.arrayBuffer();
    const fileExtension = file.name.split(".").pop() || "jpg";
    const filename = `${crypto.randomUUID()}.${fileExtension}`;
    
    // Save to match_id folder if provided
    const path = matchId ? `${matchId}/${filename}` : `${filename}`;

    // 4. Upload to chat_media bucket
    const { error: uploadError } = await supabase.storage
      .from("chat_media")
      .upload(path, fileBuffer, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });

    if (uploadError) {
      console.error("Supabase Storage Error:", uploadError);
      return NextResponse.json({ error: "Failed to upload image" }, { status: 500 });
    }

    // 5. Get Public URL
    const { data: publicUrlData } = supabase.storage
      .from("chat_media")
      .getPublicUrl(path);

    return NextResponse.json({
      media_url: publicUrlData.publicUrl,
      path: path,
    });
  } catch (error) {
    console.error("Chat Media Upload Error:", error);
    return NextResponse.json(
      { error: "Internal server error during upload" },
      { status: 500 }
    );
  }
}

export const POST = withLogging(handlePOST);
