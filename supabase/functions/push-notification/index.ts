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
  };
  schema: string;
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
    const messageBody = nonEmptyString(record.content) ?? 'Sent a photo';

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
