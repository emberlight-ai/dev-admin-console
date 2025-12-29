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
    user_a: string;
    user_b: string;
    created_at: string;
  };
  schema: string;
}

Deno.serve(async (req) => {
  try {
    const payload: WebhookPayload = await req.json();
    const { record } = payload;

    // Only process new matches
    if (payload.type !== 'INSERT' || payload.table !== 'user_matches') {
      return new Response('Ignored', { status: 200 });
    }

    // 1. Get user details to check if they are digital humans
    const { data: users, error: usersError } = await supabase
      .from('users')
      .select('userid, username, is_digital_human')
      .in('userid', [record.user_a, record.user_b]);

    if (usersError || !users || users.length !== 2) {
      console.error('Error fetching users or users not found', usersError);
      return new Response('Error fetching users', { status: 400 });
    }

    const userA = users.find((u) => u.userid === record.user_a);
    const userB = users.find((u) => u.userid === record.user_b);

    if (!userA || !userB) {
      return new Response('Users not found', { status: 400 });
    }

    // 2. Determine which users are real humans (not digital)
    const realHumanIds: string[] = [];
    const realHumanUsernames: string[] = [];

    if (!userA.is_digital_human) {
      realHumanIds.push(userA.userid);
      realHumanUsernames.push(userA.username || 'Someone');
    }

    if (!userB.is_digital_human) {
      realHumanIds.push(userB.userid);
      realHumanUsernames.push(userB.username || 'Someone');
    }

    // 3. If no real humans, don't send notifications
    if (realHumanIds.length === 0) {
      console.log('Both users are digital humans, skipping notification');
      return new Response('No real humans to notify', { status: 200 });
    }

    // 4. Determine notification message
    const notificationTitle = 'New Match!';
    
    // For each real human, create a personalized message
    const getNotificationBody = (userId: string): string => {
      // Find the other user in the match
      const otherUser = userId === record.user_a ? userB : userA;
      const otherUsername = otherUser.username || 'someone';
      
      if (otherUser.is_digital_human) {
        return `You matched with ${otherUsername}!`;
      } else {
        // Both are real humans
        return `You and ${otherUsername} matched!`;
      }
    };

    // 5. Get FCM tokens for all real humans
    const { data: tokens, error: tokenError } = await supabase
      .from('user_push_tokens')
      .select('user_id, token')
      .in('user_id', realHumanIds);

    if (tokenError || !tokens || tokens.length === 0) {
      console.log('No tokens found for real humans', realHumanIds);
      return new Response('No devices to notify', { status: 200 });
    }

    // 6. Group tokens by user for personalized messages
    const tokensByUser = new Map<string, string[]>();
    for (const token of tokens) {
      if (!tokensByUser.has(token.user_id)) {
        tokensByUser.set(token.user_id, []);
      }
      tokensByUser.get(token.user_id)!.push(token.token);
    }

    // 7. Send notifications to each real human
    const allResponses = [];
    for (const [userId, userTokens] of tokensByUser) {
      const message = {
        tokens: userTokens,
        notification: {
          title: notificationTitle,
          body: getNotificationBody(userId),
        },
        data: {
          match_id: record.id,
          user_a: record.user_a,
          user_b: record.user_b,
          type: 'new_match', // Helps client know how to route tap
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
        allResponses.push(response);
        console.log(`Successfully sent match notification to user ${userId}:`, response);

        // Cleanup invalid tokens
        if (response.failureCount > 0) {
          const failedTokens: string[] = [];
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              failedTokens.push(userTokens[idx]);
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
      } catch (err) {
        console.error(`Error sending notification to user ${userId}:`, err);
      }
    }

    return new Response(JSON.stringify({ success: true, responses: allResponses }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Error in match-notification function:', err);
    return new Response(String(err), { status: 500 });
  }
});

