export type ApiParamLocation = 'path' | 'query' | 'header';

export type ApiParam = {
  name: string;
  in: ApiParamLocation;
  required?: boolean;
  description?: string;
  example?: string;
};

export type ApiEndpointDoc = {
  id: string;
  audience: 'admin' | 'ios';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string; // OpenAPI style: /api/foo/{id} or Supabase /rest/v1/... or /storage/v1/...
  summary: string;
  description?: string;
  auth?: { type: 'none' | 'cookie' | 'bearer'; notes?: string };
  params?: ApiParam[];
  /**
   * If set, the Try-It panel will default base URL to this value (e.g. Supabase project URL).
   * Otherwise it defaults to window.location.origin (Next app origin).
   */
  baseUrlOverride?: string;
  /**
   * Default headers (JSON) for Try-It + snippet generation.
   */
  defaultHeaders?: Record<string, string>;
  requestExample?: unknown; // JSON
  responseExample?: unknown; // JSON
  notes?: string[];
};

export const apiCatalog: ApiEndpointDoc[] = [
  {
    id: 'chat.post',
    audience: 'admin',
    method: 'POST',
    path: '/api/chat',
    summary: 'Generate a chat response (Gemini)',
    description:
      'Takes a message and optional system prompt/history. Returns a single response string.',
    auth: {
      type: 'none',
      notes:
        'Currently unauthenticated. If you intend this to be private, add auth before exposing publicly.',
    },
    requestExample: {
      systemPrompt: 'You are a helpful assistant.',
      history: [
        { role: 'user', parts: [{ text: 'Hello' }] },
        { role: 'model', parts: [{ text: 'Hi! How can I help?' }] },
      ],
      message: 'Write a short greeting for a new user.',
      model: 'gemini-2.5-flash',
    },
    responseExample: { response: 'Welcome! Glad you’re here — how can I help today?' },
    notes: [
      'If `message` is missing, returns HTTP 400 with `{ error }`.',
      'If `model` is invalid, it falls back to `gemini-2.5-flash`.',
    ],
  },
  {
    id: 'avatar.get',
    audience: 'admin',
    method: 'GET',
    path: '/api/avatar/{userid}',
    summary: 'Fetch user avatar (proxy + cache-control)',
    description:
      'Looks up `users.avatar` in Supabase; falls back to legacy storage path; returns image bytes. On 404, redirects to `/default-avatar.svg`.',
    auth: { type: 'none' },
    params: [
      {
        name: 'userid',
        in: 'path',
        required: true,
        description: 'User id used to look up avatar.',
        example: 'b94909be-f006-4789-a43a-13e110ab0724',
      },
      {
        name: 'v',
        in: 'query',
        required: false,
        description:
          'Optional version string. When present, response is long-cacheable (immutable).',
        example: '1700000000',
      },
    ],
    responseExample: '(binary image)',
    notes: [
      'Returns bytes with `Content-Type` forwarded from upstream.',
      'Cache-Control is `immutable` only when `v` is provided.',
    ],
  },
  {
    id: 'systemPrompts.post',
    audience: 'admin',
    method: 'POST',
    path: '/api/system-prompts',
    summary: 'Create a system prompt row',
    description: 'Inserts into `SystemPrompts` and returns selected fields.',
    auth: {
      type: 'none',
      notes:
        'This uses `supabaseAdmin` (service role). Consider protecting this endpoint before exposing it publicly.',
    },
    requestExample: {
      gender: 'male',
      personality: 'friendly',
      system_prompt: 'You are a friendly assistant...',
    },
    responseExample: {
      data: {
        id: 123,
        gender: 'male',
        personality: 'friendly',
        created_at: '2025-01-01T00:00:00.000Z',
      },
    },
    notes: ['Missing required fields return HTTP 400 with `{ error }`.'],
  },
  {
    id: 'systemPrompts.latest.get',
    audience: 'admin',
    method: 'GET',
    path: '/api/system-prompts/latest',
    summary: 'Get latest system prompt by gender + personality',
    auth: { type: 'none' },
    params: [
      {
        name: 'gender',
        in: 'query',
        required: true,
        example: 'male',
      },
      {
        name: 'personality',
        in: 'query',
        required: true,
        example: 'friendly',
      },
    ],
    responseExample: {
      data: { system_prompt: '...', created_at: '2025-01-01T00:00:00.000Z' },
    },
    notes: ['If no row exists, returns `{ data: null }` (HTTP 200).'],
  },
  {
    id: 'systemPrompts.keys.get',
    audience: 'admin',
    method: 'GET',
    path: '/api/system-prompts/keys',
    summary: 'List (gender, personality) keys (latest per pair)',
    auth: { type: 'none' },
    params: [
      {
        name: 'gender',
        in: 'query',
        required: false,
        description: 'Use `all` (default) or a specific gender.',
        example: 'all',
      },
    ],
    responseExample: {
      data: [{ gender: 'male', personality: 'friendly', created_at: '2025-01-01T00:00:00.000Z' }],
    },
  },
  {
    id: 'systemPrompts.personalities.get',
    audience: 'admin',
    method: 'GET',
    path: '/api/system-prompts/personalities',
    summary: 'List personalities for a gender',
    auth: { type: 'none' },
    params: [
      { name: 'gender', in: 'query', required: true, example: 'male' },
    ],
    responseExample: { data: ['friendly', 'professional'] },
  },
  {
    id: 'admin.purchases.stats.get',
    audience: 'admin',
    method: 'GET',
    path: '/api/admin/purchases/stats',
    summary: 'Earnings stats from purchases',
    description:
      'Returns aggregated earnings from subscription_purchases: total_earnings_cents (all time) and this_month_earnings_cents (current calendar month). Used by the dashboard.',
    auth: {
      type: 'cookie',
      notes: 'Admin console session required (isAdminRequest).',
    },
    responseExample: {
      data: {
        total_earnings_cents: 15999,
        this_month_earnings_cents: 2999,
      },
    },
  },
  {
    id: 'admin.users.purchases.post',
    audience: 'admin',
    method: 'POST',
    path: '/api/admin/users/{userid}/purchases',
    summary: 'Record a purchase',
    description:
      'Inserts one row into subscription_purchases for the given user. The table is for recording each purchase so data can be listed/collected later. Does not grant premium; use iOS purchase flow or grant separately if needed.',
    auth: {
      type: 'cookie',
      notes: 'Admin console session required (isAdminRequest).',
    },
    params: [
      {
        name: 'userid',
        in: 'path',
        required: true,
        description: 'User UUID to record the purchase for.',
        example: 'b94909be-f006-4789-a43a-13e110ab0724',
      },
    ],
    requestExample: {
      plan_id: 'monthly',
      amount_cents: 2999,
    },
    responseExample: {
      data: {
        id: '<purchase_uuid>',
        userid: '<user_uuid>',
        plan_id: 'monthly',
        amount_cents: 2999,
        created_at: '2026-03-05T12:00:00.000Z',
      },
    },
  },
  {
    id: 'admin.users.purchases.get',
    audience: 'admin',
    method: 'GET',
    path: '/api/admin/users/{userid}/purchases',
    summary: 'List purchase records for a user',
    description:
      'Returns all subscription_purchases rows for the given user (for admin UI or reporting).',
    auth: {
      type: 'cookie',
      notes: 'Admin console session required (isAdminRequest).',
    },
    params: [
      {
        name: 'userid',
        in: 'path',
        required: true,
        description: 'User UUID to list purchases for.',
        example: 'b94909be-f006-4789-a43a-13e110ab0724',
      },
    ],
    responseExample: {
      data: [
        {
          id: '<purchase_uuid>',
          userid: '<user_uuid>',
          plan_id: 'monthly',
          amount_cents: 2999,
          created_at: '2026-03-05T12:00:00.000Z',
        },
      ],
    },
  },
];


