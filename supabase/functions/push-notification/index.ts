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
    content: string;
    created_at: string;
  };
  schema: string;
}

Deno.serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();
    const { record } = payload;

    // Only process new messages
    if (payload.type !== 'INSERT' || payload.table !== 'messages') {
      return new Response('Ignored', { status: 200 });
    }

    // 1. Find the RECIPIENT of the message
    // We look up the match to find who the other person is.
    const { data: matchData, error: matchError } = await supabase
      .from('user_matches')
      .select('user_a, user_b')
      .eq('id', record.match_id)
      .single();

    if (matchError || !matchData) {
      console.error('Match not found', matchError);
      return new Response('Match not found', { status: 404 });
    }

    // Identify the recipient (the one who is NOT the sender)
    const recipientId =
      matchData.user_a === record.sender_id
        ? matchData.user_b
        : matchData.user_a;

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

    // 3. Send the Notification via Firebase
    // We send a "Data" message so the client can handle it in background (or "Notification" for auto-display)
    const message = {
      tokens: fcmTokens,
      notification: {
        title: 'New Message',
        body: record.content || 'Sent a photo',
      },
      data: {
        match_id: record.match_id,
        sender_id: record.sender_id,
        message_id: record.id,
        type: 'chat_message', // Helps client know how to route tap
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
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
