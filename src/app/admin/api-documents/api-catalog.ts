export type ApiParamLocation = 'path' | 'query' | 'header' | 'body';

export type ApiParam = {
  name: string;
  in: ApiParamLocation;
  required?: boolean;
  description?: string;
  example?: unknown;
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
    id: 'webhooks.appleSubscription.post',
    audience: 'admin',
    method: 'POST',
    path: '/api/webhooks/apple-subscription',
    summary: 'Apple subscription / RTDN processor callback',
    description:
      'Server-to-server endpoint: upserts `apple_purchase` (idempotent on `environment` + `transaction_id`) and updates the linked `subscription` row (status, period, `original_transaction_id`, etc.). Your RTDN or App Store Server Notifications handler should verify Apple’s JWS, then POST a normalized JSON body here. Requires env `APPLE_SUBSCRIPTION_WEBHOOK_SECRET` matching `x-subscription-webhook-secret` or `Authorization: Bearer …`.',
    auth: {
      type: 'none',
      notes:
        'Not a user JWT. Use the shared secret header or Bearer token equal to `APPLE_SUBSCRIPTION_WEBHOOK_SECRET`.',
    },
    params: [
      {
        name: 'x-subscription-webhook-secret',
        in: 'header',
        required: true,
        description: 'Must match server env `APPLE_SUBSCRIPTION_WEBHOOK_SECRET` (alternative: Authorization Bearer same value).',
        example: '<shared_secret>',
      },
    ],
    defaultHeaders: {
      'Content-Type': 'application/json',
      'x-subscription-webhook-secret': '<APPLE_SUBSCRIPTION_WEBHOOK_SECRET>',
    },
    requestExample: {
      user_id: '<user_uuid>',
      subscription_id: '<subscription_uuid>',
      transaction_id: '<apple_transaction_id>',
      original_transaction_id: '<apple_original_transaction_id>',
      product_id: 'amber.premium.monthly.0.0',
      environment: 'Production',
      purchase_date: '2026-04-04T12:00:00.000Z',
      expires_date: '2026-05-04T12:00:00.000Z',
      quantity: 1,
      type: 'auto_renewable',
      auto_renew_status: true,
      event_type: 'DID_RENEW',
      raw_payload: { note: 'optional copy of Apple payload for audit' },
    },
    responseExample: {
      ok: true,
      subscription_id: '<subscription_uuid>',
      status: 'ACTIVE',
    },
    notes: [
      'Required body fields: `transaction_id`, `product_id`, `environment` (`Sandbox` | `Production`), `purchase_date`.',
      'Resolve target subscription via `subscription_id` (optional `user_id` filled from row), or `original_transaction_id` + `environment`, or pending `CREATED`/`PURCHASING` row for `user_id` + `product_id`.',
      'Returns 401 if secret is missing or wrong, or if `APPLE_SUBSCRIPTION_WEBHOOK_SECRET` is unset on the server.',
    ],
  },
];


