// @ts-nocheck
// This file is a Supabase Edge Function (Deno runtime). Next.js/TypeScript tooling should not typecheck it.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import admin from 'npm:firebase-admin@12.0.0';

// 1. Initialize Firebase Admin
// Store your entire service-account.json content as a secret named FIREBASE_SERVICE_ACCOUNT
const serviceAccount = JSON.parse(
  Deno.env.get('FIREBASE_SERVICE_ACCOUNT') || '{}'
);

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// 2. Initialize Supabase Admin Client
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

interface WebhookPayload {
  type: 'INSERT';
  table: string;
  record: {
    id: string;
    match_id: string;
    sender_id: string;
    receiver_id?: string;
    content: string;
    created_at: string;
    /** 'text' | 'image' | 'gift' | 'component'. Present on the webhook body
     *  since the gifts migration; it was simply untyped here. */
    type?: string;
  };
  schema: string;
}

// ── Notification copy for non-text messages ─────────────────────────────────
// `content` on gift and component rows is a JSON envelope, so using it raw
// pushed things like {"component":"nutrition_result","props":{…}} to the
// lock screen. Each kind gets a line written in the coach's voice instead.
const COMPONENT_COPY: Record<string, string> = {
  lux_meter:
    "Step outside and get some sunlight — it keeps your melatonin on schedule.",
  nutrition_scan: "It's time to eat. Can you log what you're eating?",
  caffeine_window:
    "Great time for coffee — based on your sleep, this lands you at your mental peak.",
  nutrition_result: "I logged your meal — here's how it breaks down.",
  coach_plan: "Your starter plan is ready.",
  match_cards: "I found a few people you should meet.",
};

/** Human-readable body for a message whose content is a JSON payload. */
function bodyForPayload(type: string | undefined, content: string): string | undefined {
  if (!content?.trimStart().startsWith('{')) return undefined;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Malformed JSON must never reach the lock screen verbatim.
    return type === 'component' || type === 'gift' ? 'Sent you something' : undefined;
  }

  if (type === 'gift' || typeof parsed.gift === 'string') {
    const giftName = nonEmptyString(parsed.name);
    return giftName ? `🎁 Sent you ${giftName}` : '🎁 Sent you a gift';
  }

  if (type === 'component' || typeof parsed.component === 'string') {
    const name = typeof parsed.component === 'string' ? parsed.component : '';
    // The payload's own `text` is authored as a chat-list preview, so it is a
    // good fallback for components added after this map was written.
    return COMPONENT_COPY[name] ?? nonEmptyString(parsed.text) ?? 'Sent you a card';
  }

  return undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

Deno.serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();
    const { record } = payload;

    // Only process new messages
    if (payload.type !== 'INSERT' || payload.table !== 'messages') {
      return new Response('Ignored', { status: 200 });
    }

    // 1. Identify the recipient directly from messages.receiver_id
    // (receiver_id is now stored on the messages table, so we don't need to query user_matches here.)
    const recipientId = record.receiver_id;
    if (!recipientId) {
      console.error('Missing receiver_id on message record', record.id);
      return new Response('Missing receiver_id', { status: 400 });
    }

    // 2. Get the recipient's FCM tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('user_push_tokens')
      .select('token')
      .eq('user_id', recipientId);

    if (tokenError || !tokens || tokens.length === 0) {
      console.log('No tokens found for user', recipientId);
      return new Response('No devices to notify', { status: 200 });
    }

    const fcmTokens = tokens.map((t) => t.token);

    // 3. Get sender profile details for the notification title/avatar.
    const { data: sender, error: senderError } = await supabase
      .from('users')
      .select('username, avatar')
      .eq('userid', record.sender_id)
      .maybeSingle();

    if (senderError) {
      console.error('Failed to fetch sender profile', {
        senderId: record.sender_id,
        error: senderError,
      });
    }

    const senderName = nonEmptyString(sender?.username) ?? 'Someone';
    const senderAvatarUrl = nonEmptyString(sender?.avatar);
    const messageBody =
      bodyForPayload(record.type, record.content) ??
      nonEmptyString(record.content) ??
      'Sent a photo';

    // 4. Send the Notification via Firebase
    // We send a "Data" message so the client can handle it in background (or "Notification" for auto-display)
    const message = {
      tokens: fcmTokens,
      notification: {
        title: senderName,
        body: messageBody,
        ...(senderAvatarUrl ? { imageUrl: senderAvatarUrl } : {}),
      },
      data: {
        match_id: record.match_id,
        sender_id: record.sender_id,
        message_id: record.id,
        sender_name: senderName,
        ...(senderAvatarUrl ? { sender_avatar_url: senderAvatarUrl } : {}),
        type: 'chat_message', // Helps client know how to route tap
      },
      apns: {
        ...(senderAvatarUrl ? { fcmOptions: { imageUrl: senderAvatarUrl } } : {}),
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
            mutableContent: Boolean(senderAvatarUrl),
          },
        },
      },
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log('Successfully sent message:', response);

    // Optional: Cleanup invalid tokens
    if (response.failureCount > 0) {
      const failedTokens: string[] = [];
      response.responses.forEach((resp, idx) => {
        if (!resp.success) {
          failedTokens.push(fcmTokens[idx]);
        }
      });
      // Delete invalid tokens from DB to keep it clean
      if (failedTokens.length > 0) {
        await supabase
          .from('user_push_tokens')
          .delete()
          .in('token', failedTokens);
      }
    }

    return new Response(JSON.stringify(response), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);
    return new Response(String(err), { status: 500 });
  }
});
