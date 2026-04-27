import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { withLogging } from "@/lib/with-logging";

const getUserSupabase = (req: NextRequest) => {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader) {
    throw new Error("Missing Authorization header");
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
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
    if (!authHeader) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const supabase = getUserSupabase(req);
    const token = authHeader.split(" ")[1];

    // Verify user exists and token is valid
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token || "");

    if (userError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { match_id, content, media_url } = body;

    if (!match_id) {
      return NextResponse.json({ error: "Missing match_id" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("rpc_send_message", {
      match_id,
      content: content || null,
      media_url: media_url || null,
    });

    if (error) {
      console.error("Supabase RPC Error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Usually rpc_send_message returns a single message object when executed.
    // If you return the raw `data`, it should be the message.
    return NextResponse.json(data);
  } catch (error: unknown) {
    console.error("Chat Send Error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export const POST = withLogging(handlePOST);
