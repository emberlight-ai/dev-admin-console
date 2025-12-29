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
    from_user_id: string;
    to_user_id: string;
    created_at: string;
  };
  schema: string;
}

Deno.serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();
    const { record } = payload;

    // Only process new match requests
    if (payload.type !== 'INSERT' || payload.table !== 'match_requests') {
      return new Response('Ignored', { status: 200 });
    }

    // 1. Get user details to check if from_user_id is a digital human and to_user_id is a real user
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('userid, username, avatar, is_digital_human')
      .in('userid', [record.from_user_id, record.to_user_id]);

    if (usersError || !users || users.length !== 2) {
      console.error('Error fetching users or users not found', usersError);
      return new Response('Error fetching users', { status: 400 });
    }

    const fromUser = users.find((u) => u.userid === record.from_user_id);
    const toUser = users.find((u) => u.userid === record.to_user_id);

    if (!fromUser || !toUser) {
      return new Response('Users not found', { status: 400 });
    }

    // 2. Only send notification if:
    //    - from_user_id is a digital human (the one who sent the invite)
    //    - to_user_id is a real user (the one receiving the notification)
    if (!fromUser.is_digital_human || toUser.is_digital_human) {
      console.log(
        'Skipping notification: from_user must be digital human and to_user must be real user',
        {
          from_is_dh: fromUser.is_digital_human,
          to_is_dh: toUser.is_digital_human,
        }
      );
      return new Response('Not a digital human to real user invite', { status: 200 });
    }

    // 3. Get the recipient's (real user's) FCM tokens
    const { data: tokens, error: tokenError } = await supabase
      .from('user_push_tokens')
      .select('token')
      .eq('user_id', record.to_user_id);

    if (tokenError || !tokens || tokens.length === 0) {
      console.log('No tokens found for user', record.to_user_id);
      return new Response('No devices to notify', { status: 200 });
    }

    const fcmTokens = tokens.map((t) => t.token);

    // 4. Create notification message
    const digitalHumanName = fromUser.username || 'Someone';
    const notificationTitle = 'New Like!';
    const notificationBody = `${digitalHumanName} liked you`;

    // 5. Send the notification via Firebase
    const message = {
      tokens: fcmTokens,
      notification: {
        title: notificationTitle,
        body: notificationBody,
      },
      data: {
        request_id: record.id,
        from_user_id: record.from_user_id,
        to_user_id: record.to_user_id,
        from_username: digitalHumanName,
        from_avatar: fromUser.avatar || '',
        type: 'like_notification', // Helps client know how to route tap
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

    try {
      const response = await admin.messaging().sendEachForMulticast(message);
      console.log(
        `Successfully sent like notification to user ${record.to_user_id}:`,
        response
      );

      // Cleanup invalid tokens
      if (response.failureCount > 0) {
        const failedTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            failedTokens.push(fcmTokens[idx]);
          }
        });
        // Delete invalid tokens from DB
        if (failedTokens.length > 0) {
          await supabase
            .from('user_push_tokens')
            .delete()
            .in('token', failedTokens);
        }
      }

      return new Response(
        JSON.stringify({ success: true, response }),
        {
          headers: { 'Content-Type': 'application/json' },
        }
      );
    } catch (err) {
      console.error(`Error sending notification to user ${record.to_user_id}:`, err);
      return new Response(String(err), { status: 500 });
    }
  } catch (err) {
    console.error('Error in like-notification function:', err);
    return new Response(String(err), { status: 500 });
  }
});

