# Like Notification Function

This Edge Function sends push notifications to real users when a digital human sends them a match request (likes them).

## Setup Instructions

### 1. Deploy the Function

Deploy this function to Supabase using the Supabase CLI:

```bash
supabase functions deploy like-notification
```

Or use the Supabase Dashboard to deploy it.

### 2. Configure Database Webhook

The function is triggered by a database webhook on the `match_requests` table. Configure it in the Supabase Dashboard:

1. Go to **Database > Webhooks**
2. Click **Create a new webhook**
3. Configure the webhook:
   - **Name**: `like-notification-webhook`
   - **Table**: `match_requests`
   - **Events**: Select **INSERT**
   - **HTTP Request URL**: `https://<your-project-ref>.supabase.co/functions/v1/like-notification`
   - **HTTP Method**: `POST`
   - **HTTP Headers**: 
     - `Content-Type: application/json`
4. Click **Save**

### 3. Environment Variables

Make sure the following environment variables are set in your Supabase project:

- `FIREBASE_SERVICE_ACCOUNT`: JSON string of your Firebase service account credentials
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Your Supabase service role key

## How It Works

1. When a new row is inserted into `match_requests` table, the webhook triggers this function
2. The function checks if:
   - `from_user_id` is a digital human (`is_digital_human = true`)
   - `to_user_id` is a real user (`is_digital_human = false`)
3. If both conditions are met, it:
   - Fetches the digital human's username and avatar
   - Fetches the real user's FCM push tokens
   - Sends a push notification: "{{username}} liked you"
4. The notification includes metadata (request_id, user IDs, etc.) for the client to handle navigation

## Notification Payload

The notification includes the following data:

```json
{
  "request_id": "uuid",
  "from_user_id": "uuid",
  "to_user_id": "uuid",
  "from_username": "string",
  "from_avatar": "string",
  "type": "like_notification"
}
```

The client can use this data to navigate to the appropriate screen when the user taps the notification.

