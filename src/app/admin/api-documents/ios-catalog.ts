import type { ApiEndpointDoc } from './api-catalog';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? '';

// Default headers iOS will send to Supabase REST/RPC.
// - apikey: your anon key
// - Authorization: Bearer <access_token> (user session)
const supabaseAuthHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: 'Bearer <AUTH_TOKEN>',
  'Content-Type': 'application/json',
};

// Headers for Next.js API Routes (no apikey needed, same origin)
const nextApiHeaders = {
  Authorization: 'Bearer <AUTH_TOKEN>',
  'Content-Type': 'application/json',
};

export const iosApiCatalog: ApiEndpointDoc[] = [
  {
    id: 'ios.users.get',
    audience: 'ios',
    method: 'GET',
    path: '/api/ios/users/<userid>',
    summary: 'Get user profile',
    description:
      'Fetch a user profile by their UUID. Standard REST endpoint (proxies to Supabase).',
    auth: {
      type: 'bearer',
      notes: 'Send the Supabase Access Token in Authorization header.',
    },
    baseUrlOverride: APP_URL,
    defaultHeaders: nextApiHeaders,
    responseExample: {
      userid: '<user_uuid>',
      username: 'Alice',
      age: 28,
      gender: 'Female',
      personality: 'Funny',
      zipcode: '90210',
      phone: '+15555555555',
      bio: 'Hello world',
      education: 'College',
      profession: 'Engineer',
      avatar: 'https://example.com/avatar.jpg',
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
      is_digital_human: false,
    },
  },
  {
    id: 'ios.users.update.patch',
    audience: 'ios',
    method: 'PATCH',
    path: '/api/ios/users/<userid>',
    summary: 'Update my profile',
    description:
      'Update fields for the authenticated user. <userid> must match the token subject.',
    auth: { type: 'bearer' },
    baseUrlOverride: APP_URL,
    defaultHeaders: nextApiHeaders,
    requestExample: {
      username: 'Alice',
      profession: 'iOS Engineer',
      zipcode: '90210',
      avatar: 'https://example.com/my-new-avatar.jpg',
    },
    responseExample: {
      userid: '<user_uuid>',
      username: 'Alice',
      // ... other fields
    },
  },
  {
    id: 'ios.users.delete.soft',
    audience: 'ios',
    method: 'POST',
    path: '/api/ios/me/delete',
    summary: 'Soft delete my account',
    description: 'Marks the authenticated user account as deleted.',
    auth: { type: 'bearer' },
    baseUrlOverride: APP_URL,
    defaultHeaders: nextApiHeaders,
    requestExample: {},
    responseExample: { success: true },
  },
  {
    id: 'ios.posts.create',
    audience: 'ios',
    method: 'POST',
    path: '/api/ios/posts',
    summary: 'Create a post',
    description:
      'Create a new post. User ID is inferred from the token or can be passed.',
    auth: { type: 'bearer' },
    baseUrlOverride: APP_URL,
    defaultHeaders: nextApiHeaders,
    requestExample: {
      description: 'Visited Kyoto',
      location_name: 'Kyoto, Japan',
      longitude: 135.7681,
      latitude: 35.0116,
      occurred_at: '2025-01-01T00:00:00.000Z',
      photos: [],
    },
    responseExample: {
      id: '<post_uuid>',
      userid: '<user_uuid>',
      description: 'Visited Kyoto',
      location_name: 'Kyoto, Japan',
      occurred_at: '2025-01-01T00:00:00.000Z',
      photos: [],
      // ...
    },
  },
  {
    id: 'ios.posts.photos.upload',
    audience: 'ios',
    method: 'POST',
    path: '/api/ios/posts/<postid>/photos',
    summary: 'Upload photos to post',
    description:
      'Upload images to an existing post. Use multipart/form-data with key `files`. Appends to existing photos. Standard flow: Create Post -> Get ID -> Upload Photos.',
    auth: { type: 'bearer' },
    baseUrlOverride: APP_URL,
    defaultHeaders: {
      Authorization: 'Bearer <AUTH_TOKEN>',
      // Content-Type is multipart/form-data, usually set automatically by client networking libs
    },
    requestExample: {
      _type: 'multipart/form-data',
      files: ['<file_bytes_1>', '<file_bytes_2>'],
    },
    responseExample: {
      success: true,
      photos: ['https://.../1.jpg', 'https://.../2.jpg'],
      added: ['https://.../2.jpg'],
    },
  },
  {
    id: 'ios.posts.list',
    audience: 'ios',
    method: 'GET',
    path: '/api/ios/users/<userid>/posts?startIndex=0&limit=5&hasLocation=false',
    summary: 'List user posts',
    description: 'Fetch posts for a user with pagination.',
    auth: { type: 'bearer' },
    baseUrlOverride: APP_URL,
    defaultHeaders: nextApiHeaders,
    params: [
      {
        name: 'startIndex',
        in: 'query',
        required: false,
        example: '0',
      },
      {
        name: 'limit',
        in: 'query',
        required: false,
        example: '5',
      },
      {
        name: 'hasLocation',
        in: 'query',
        required: false,
        example: 'false',
      },
    ],
    responseExample: [
      {
        id: '<post_uuid>',
        userid: '<user_uuid>',
        description: 'Post description',
        photos: ['url1', 'url2'],
        location_name: 'City',
        longitude: 100.0,
        latitude: 20.0,
        altitude: 10.0,
        occurred_at: '2025-01-01T00:00:00Z',
        created_at: '2025-01-01T00:00:00Z',
      },
    ],
  },
  {
    id: 'ios.earth.locations',
    audience: 'ios',
    method: 'POST',
    path: '/api/ios/locations',
    summary: 'Get Earth points',
    description: 'Fetch lightweight location data for 3D Earth view for multiple users.',
    auth: { type: 'bearer' },
    baseUrlOverride: APP_URL,
    defaultHeaders: nextApiHeaders,
    requestExample: {
      userIds: ['<user_uuid_1>', '<user_uuid_2>'],
      startIndex: 0,
      limit: 200,
    },
    responseExample: [
      {
        post_id: '<post_uuid>',
        userid: '<user_uuid>',
        occurred_at: '2025-01-01T00:00:00Z',
        longitude: 100.0,
        latitude: 20.0,
        altitude: 10.0,
        location_name: 'City',
      },
    ],
  },
  // RPCs for matching still use direct Supabase RPCs for now as they are "actions"
  // but we can wrap them if requested. For now, user complained about GET filters.
  {
    id: 'ios.match.send',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/rpc/rpc_send_match_request',
    summary: 'Send match request',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: { target_user_id: '<other_user_uuid>' },
    responseExample: '<request_uuid_or_match_uuid>',
  },
  {
    id: 'ios.match.requests.list',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/rpc/rpc_list_match_requests',
    summary: 'List match requests (inbound/outbound)',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: { direction: 'inbound', start_index: 0, limit_count: 20 },
    responseExample: [
      {
        request_id: '<request_uuid>',
        from_user_id: '<sender_uuid>',
        to_user_id: '<receiver_uuid>',
        created_at: '2025-01-01T00:00:00Z',
        other_user_id: '<other_uuid>',
        other_username: 'Bob',
        other_avatar: 'https://example.com/bob.jpg',
      },
    ],
  },
  {
    id: 'ios.match.accept',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/rpc/rpc_accept_match_request',
    summary: 'Accept match request',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: { request_id: '<request_uuid>' },
    responseExample: null, // void
  },
  {
    id: 'ios.match.decline',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/rpc/rpc_decline_match_request',
    summary: 'Decline match request',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: { request_id: '<request_uuid>' },
    responseExample: null, // void
  },
  {
    id: 'ios.match.cancel',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/rpc/rpc_cancel_match_request',
    summary: 'Cancel match request',
    description:
      'Sender cancels an outbound match request (deletes the request row).',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: { request_id: '<request_uuid>' },
    responseExample: null, // void
  },
  {
    id: 'ios.connections.list',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/rpc/rpc_list_connections',
    summary: 'List connections',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: { start_index: 0, limit_count: 50 },
    notes: [
      'Returns only the other participant profile fields (connection_*) plus `is_new_connection` which is true when there are no messages yet for the match_id.',
    ],
    responseExample: [
      {
        id: '<match_uuid>',
        connection_username: 'Bob',
        connection_user_id: '<bob_uuid>',
        connection_avatar: 'https://example.com/bob.jpg',
        created_at: '2025-01-01T00:00:00Z',
        is_new_connection: true,
      },
    ],
  },
  {
    id: 'ios.match.unmatch',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/rpc/rpc_unmatch',
    summary: 'Unmatch',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: { match_id: '<match_uuid>' },
    responseExample: null, // void
  },
  {
    id: 'ios.reports.user',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/rpc/rpc_report_user',
    summary: 'Report a user',
    description:
      'Creates a report row with target_user_id set and target_post_id = null.',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: { target_user_id: '<other_user_uuid>', reason: 'Spam' },
    responseExample: '<report_uuid>',
  },
  {
    id: 'ios.reports.post',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/rpc/rpc_report_post',
    summary: 'Report a post',
    description:
      'Creates a report row with both target_user_id and target_post_id set.',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: {
      target_user_id: '<post_owner_user_uuid>',
      target_post_id: '<post_uuid>',
      reason: 'Inappropriate content',
    },
    responseExample: '<report_uuid>',
  },
  {
    id: 'ios.matchings.feed',
    audience: 'ios',
    method: 'POST',
    path: '/api/ios/getMatchings',
    summary: 'Get matchings feed (swipe cards)',
    description:
      'Returns a swipe-card-ready list of candidate users for the authenticated user (userid derived from JWT). Avatar is used as the first image; postImages are taken from the user_posts photos arrays in order until imageCount is reached.',
    auth: { type: 'bearer' },
    baseUrlOverride: APP_URL,
    defaultHeaders: nextApiHeaders,
    requestExample: {
      visitedUserIds: [],
      count: 20,
      imageCount: 7,
    },
    responseExample: [
      {
        userId: '<candidate_uuid>',
        avatar: 'https://example.com/avatar.jpg',
        username: 'Alice',
        age: 28,
        gender: 'Female',
        bio: 'Hello',
        profession: 'Designer',
        postImages: [
          'https://example.com/p1.jpg',
          'https://example.com/p2.jpg',
        ],
      },
    ],
  },
  {
    id: 'ios.storage.avatar.note',
    audience: 'ios',
    method: 'POST',
    path: '/storage/v1/object/images/<auth_uid>/avatar_<random>.jpg',
    summary: 'Upload avatar (Storage path convention)',
    description:
      'Upload to Storage under your folder (<auth_uid>/...). Then PATCH /api/ios/users/<userid> to set `avatar` = public URL.',
    auth: {
      type: 'bearer',
      notes:
        'For Storage uploads, include apikey + Authorization, and send the file bytes.',
    },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: 'Bearer <AUTH_TOKEN>',
      'Content-Type': 'image/jpeg',
    },
    notes: [
      'Bucket is public for MVP: anyone with the URL can view the image.',
      'Write policy restricts uploads to paths starting with <auth_uid>/.',
    ],
    responseExample: {
      Key: 'images/<user_id>/avatar_xyz.jpg',
      // ... storage metadata
    },
  },
  {
    id: 'ios.chat.messages.list',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/rpc/rpc_get_messages',
    summary: 'Get Chat History',
    description: 'Fetch previous messages for a specific match.',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: {
      match_id: '<match_uuid>',
      start_index: 0,
      limit_count: 50,
    },
    responseExample: [
      {
        id: '<message_uuid>',
        match_id: '<match_uuid>',
        sender_id: '<sender_uuid>',
        receiver_id: '<receiver_uuid>',
        content: 'Hello world',
        media_url: null,
        created_at: '2025-01-01T12:00:00Z',
      },
    ],
  },
  {
    id: 'ios.chat.messages.send',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/rpc/rpc_send_message',
    summary: 'Send Message',
    description:
      'Send a message to a match. Validates participation before inserting.',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: {
      match_id: '<match_uuid>',
      content: 'Hello world',
      media_url: null,
    },
    responseExample: {
      id: '<message_uuid>',
      match_id: '<match_uuid>',
      sender_id: '<sender_uuid>',
      receiver_id: '<receiver_uuid>',
      content: 'Hello world',
      media_url: null,
      created_at: '2025-01-01T12:00:00Z',
    },
  },
  {
    id: 'ios.chat.connections.metas',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/rpc/rpc_fetch_connections_chat_metas',
    summary: 'Fetch chat metadata (last msg + unread count)',
    description:
      'Fetch the most recent message and unread count for a list of matches. `unread_count` logic: if `last_read_time` is provided, counts messages after it. If not, counts messages after the last message sent by the current user.',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: {
      params: [
        { match_id: '<match_uuid_1>' },
        { match_id: '<match_uuid_2>', last_read_time: '2025-01-01T12:00:00Z' },
      ],
    },
    responseExample: [
      {
        match_id: '<match_uuid>',
        message: 'Last message content',
        created_at: '2025-01-01T12:05:00Z',
        sender_id: '<sender_uuid>',
        receiver_id: '<receiver_uuid>',
        unread_count: 3,
        media_url: null,
        message_id: '<message_uuid>',
      },
    ],
  },
  {
    id: 'ios.push.tokens.register',
    audience: 'ios',
    method: 'POST',
    path: '/rest/v1/user_push_tokens',
    summary: 'Register FCM/APNs Token',
    description: 'Register device token for push notifications.',
    auth: { type: 'bearer' },
    baseUrlOverride: SUPABASE_URL,
    defaultHeaders: supabaseAuthHeaders,
    requestExample: {
      user_id: '<auth_uid>',
      token: '<fcm_token>',
      platform: 'ios',
    },
    responseExample: null, // void or row
  },
];
