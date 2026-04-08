import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { Environment, SignedDataVerifier } from '@apple/app-store-server-library';
import { X509Certificate } from 'crypto';

export const runtime = 'nodejs';

/**
 * Apple subscription webhook.
 *
 * Accepts either:
 * - Apple App Store Server Notifications (`{ signedPayload: "..." }`), or
 * - Internal normalized payload (legacy mode) protected by shared secret.
 *
 * Apple ASN requests are verified using Apple certificate chain + signature before data is trusted.
 */
type WebhookBody = {
  user_id?: unknown;
  subscription_id?: unknown;
  transaction_id?: unknown;
  original_transaction_id?: unknown;
  product_id?: unknown;
  environment?: unknown;
  purchase_date?: unknown;
  expires_date?: unknown;
  quantity?: unknown;
  type?: unknown;
  auto_renew_status?: unknown;
  event_type?: unknown;
  raw_payload?: unknown;
  signedPayload?: unknown;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Shared-secret auth only. Set `APPLE_SUBSCRIPTION_WEBHOOK_SECRET` in the Next.js environment.
 * Your upstream notifier must send the same value in either:
 * - Header `x-subscription-webhook-secret`, or
 * - `Authorization: Bearer <secret>`
 *
 * Returns false if env is unset — so misconfigured deploys reject all calls instead of accepting them.
 */
function verifySecret(req: NextRequest): boolean {
  const secret = process.env.APPLE_SUBSCRIPTION_WEBHOOK_SECRET;
  if (!secret) return false;
  const header = req.headers.get('x-subscription-webhook-secret');
  if (header && header === secret) return true;
  const auth = req.headers.get('Authorization');
  if (auth?.startsWith('Bearer ') && auth.slice(7) === secret) return true;
  return false;
}

/**
 * Maps a coarse `event_type` string (from your notifier) to subscription status hints.
 * Apple’s real notification types are richer; normalize them in the caller before POSTing.
 * Returns null when the string doesn’t clearly imply ACTIVE or EXPIRED — caller then falls back to expiry date.
 */
function terminalEvent(t: string): 'EXPIRED' | 'ACTIVE' | null {
  const u = t.toUpperCase();
  if (
    u.includes('EXPIRED') ||
    u.includes('REFUND') ||
    u.includes('REVOKE') ||
    u === 'DID_FAIL_TO_RENEW'
  ) {
    return 'EXPIRED';
  }
  if (
    u.includes('SUBSCRIBE') ||
    u.includes('RENEW') ||
    u.includes('INITIAL_BUY') ||
    u === 'DID_RENEW' ||
    u === 'INTERACTIVE_RENEWAL'
  ) {
    return 'ACTIVE';
  }
  return null;
}

type DecodedAppleNotification = {
  notificationType?: string;
  subtype?: string;
  data?: {
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
    environment?: string;
  };
};

type DecodedAppleTransaction = {
  transactionId?: string | number;
  originalTransactionId?: string | number;
  appAccountToken?: string;
  productId?: string;
  purchaseDate?: string | number;
  expiresDate?: string | number;
  quantity?: string | number;
  type?: string;
  environment?: string;
};

type DecodedAppleRenewal = {
  autoRenewStatus?: number | string;
};

let verifierCache: SignedDataVerifier | null = null;
let verifierCacheKey = '';

function toIsoFromAppleDate(v: string | number | undefined): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return new Date(v).toISOString();
  }
  if (typeof v === 'string') {
    const t = v.trim();
    if (!t) return null;
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (Number.isFinite(n)) return new Date(n).toISOString();
    }
    const d = new Date(t);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

function normalizeEnvironment(v: unknown): 'Sandbox' | 'Production' | null {
  if (v === 'Sandbox' || v === 'Production') return v;
  if (typeof v === 'string') {
    const u = v.trim().toUpperCase();
    if (u === 'SANDBOX') return 'Sandbox';
    if (u === 'PRODUCTION') return 'Production';
  }
  return null;
}

function parseAppleEnvironment(raw: string | undefined): Environment {
  const t = raw?.trim().toUpperCase();
  if (t === 'PRODUCTION') return Environment.PRODUCTION;
  return Environment.SANDBOX;
}

function parseRootCertificatesFromEnv(raw: string): Buffer[] {
  let arr: unknown;
  try {
    arr = JSON.parse(raw);
  } catch {
    throw new Error('APPLE_ROOT_CERTIFICATES must be a JSON array of PEM/base64 certificate strings');
  }
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error('APPLE_ROOT_CERTIFICATES must include at least one certificate');
  }
  return arr.map((entry) => {
    if (typeof entry !== 'string' || !entry.trim()) {
      throw new Error('APPLE_ROOT_CERTIFICATES entries must be non-empty strings');
    }
    const t = entry.trim();
    const cert = t.includes('BEGIN CERTIFICATE')
      ? new X509Certificate(t)
      : new X509Certificate(Buffer.from(t, 'base64'));
    return cert.raw;
  });
}

function getVerifier(): SignedDataVerifier {
  const bundleId = process.env.APPLE_BUNDLE_ID?.trim();
  if (!bundleId) throw new Error('APPLE_BUNDLE_ID is required');
  const appEnv = parseAppleEnvironment(process.env.APPLE_IAP_ENV);
  const appAppleIdRaw = process.env.APPLE_APP_ID?.trim();
  const appAppleId = appAppleIdRaw ? Number(appAppleIdRaw) : undefined;
  const certsRaw = process.env.APPLE_ROOT_CERTIFICATES?.trim();
  if (!certsRaw) throw new Error('APPLE_ROOT_CERTIFICATES is required');

  const cacheKey = `${bundleId}|${appEnv}|${appAppleId ?? ''}|${certsRaw}`;
  if (verifierCache && verifierCacheKey === cacheKey) return verifierCache;

  const roots = parseRootCertificatesFromEnv(certsRaw);
  verifierCache = new SignedDataVerifier(roots, true, appEnv, bundleId, appAppleId);
  verifierCacheKey = cacheKey;
  return verifierCache;
}

async function normalizeApplePayload(parsed: WebhookBody): Promise<WebhookBody | null> {
  if (typeof parsed.signedPayload !== 'string' || !parsed.signedPayload.trim()) return null;
  const signedPayload = parsed.signedPayload.trim();
  const verifier = getVerifier();
  const verifiedNotification = (await verifier.verifyAndDecodeNotification(
    signedPayload
  )) as unknown as DecodedAppleNotification;

  const signedTx = verifiedNotification.data?.signedTransactionInfo;
  const signedRenewal = verifiedNotification.data?.signedRenewalInfo;
  const tx = signedTx
    ? ((await verifier.verifyAndDecodeTransaction(signedTx)) as unknown as DecodedAppleTransaction)
    : null;
  const renewal = signedRenewal
    ? ((await verifier.verifyAndDecodeRenewalInfo(signedRenewal)) as unknown as DecodedAppleRenewal)
    : null;

  const transactionId =
    tx?.transactionId !== undefined && tx?.transactionId !== null ? String(tx.transactionId) : '';
  const originalTransactionId =
    tx?.originalTransactionId !== undefined && tx?.originalTransactionId !== null
      ? String(tx.originalTransactionId)
      : '';
  const productId = typeof tx?.productId === 'string' ? tx.productId : '';
  const userId = typeof tx?.appAccountToken === 'string' ? tx.appAccountToken.trim() : '';
  const purchaseDate = toIsoFromAppleDate(tx?.purchaseDate) ?? '';
  const expiresDate = toIsoFromAppleDate(tx?.expiresDate);
  const environment =
    normalizeEnvironment(tx?.environment) ??
    normalizeEnvironment(verifiedNotification.data?.environment) ??
    null;
  const quantityNum =
    tx?.quantity !== undefined && tx?.quantity !== null ? Number(tx.quantity) : undefined;
  const quantity =
    typeof quantityNum === 'number' && Number.isFinite(quantityNum)
      ? Math.max(1, Math.trunc(quantityNum))
      : undefined;

  const autoRenewRaw = renewal?.autoRenewStatus;
  const autoRenewNum = autoRenewRaw !== undefined && autoRenewRaw !== null ? Number(autoRenewRaw) : NaN;
  const autoRenewStatus =
    Number.isFinite(autoRenewNum) ? autoRenewNum === 1 : undefined;

  const eventType = [verifiedNotification.notificationType, verifiedNotification.subtype]
    .filter(Boolean)
    .join('.');

  return {
    user_id: userId || undefined,
    transaction_id: transactionId,
    original_transaction_id: originalTransactionId,
    product_id: productId,
    environment,
    purchase_date: purchaseDate,
    expires_date: expiresDate,
    quantity,
    type: tx?.type ?? 'auto_renewable',
    auto_renew_status: autoRenewStatus,
    event_type: eventType || verifiedNotification.notificationType || 'APPLE_ASN',
    raw_payload: {
      apple_notification: verifiedNotification,
      apple_transaction: tx,
      apple_renewal: renewal,
    },
  };
}

/**
 * POST — Apple ASN or internal callback: upsert `apple_purchase` and advance `subscription`.
 * - Apple ASN mode: pass `{ signedPayload }` (verified against Apple cert chain/signature).
 * - Internal mode: pass normalized payload + shared secret (`APPLE_SUBSCRIPTION_WEBHOOK_SECRET`).
 */
export async function POST(req: NextRequest) {
  const rawText = await req.text();
  console.log('[apple-subscription webhook] raw request body:', rawText);

  let parsed: WebhookBody;
  try {
    if (!rawText.trim()) {
      return jsonError('Invalid JSON body', 400);
    }
    parsed = JSON.parse(rawText) as WebhookBody;
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  let appleNormalized: WebhookBody | null = null;
  if (typeof parsed.signedPayload === 'string') {
    try {
      appleNormalized = await normalizeApplePayload(parsed);
    } catch (err) {
      console.log('[apple-subscription webhook] rejected: Apple signedPayload verification failed', err);
      return jsonError('Invalid Apple signedPayload', 401);
    }
  }
  const isAppleSignedPayload = appleNormalized !== null;

  // Shared-secret auth is only required for non-Apple normalized callers.
  if (!isAppleSignedPayload && !verifySecret(req)) {
    console.log('[apple-subscription webhook] rejected: invalid or missing shared secret (body logged above)');
    return jsonError('Unauthorized', 401);
  }

  const body = appleNormalized ?? parsed;
  console.log('[apple-subscription webhook] parsed body:', JSON.stringify(body, null, 2));

  // --- Required fields: minimum needed to idempotently record a purchase line and set period bounds ---
  const transactionId =
    typeof body.transaction_id === 'string' ? body.transaction_id.trim() : '';
  const originalTransactionId =
    typeof body.original_transaction_id === 'string'
      ? body.original_transaction_id.trim()
      : '';
  const productId = typeof body.product_id === 'string' ? body.product_id.trim() : '';
  const environment =
    body.environment === 'Sandbox' || body.environment === 'Production'
      ? body.environment
      : null;
  const purchaseDate =
    typeof body.purchase_date === 'string' ? body.purchase_date.trim() : '';
  const userIdFromBody = typeof body.user_id === 'string' ? body.user_id.trim() : '';
  const subscriptionIdFromBody =
    typeof body.subscription_id === 'string' ? body.subscription_id.trim() : '';

  if (!transactionId || !productId || !environment || !purchaseDate) {
    return jsonError(
      'transaction_id, product_id, environment (Sandbox|Production), and purchase_date are required',
      400
    );
  }

  // --- Optional fields (defaults chosen so upsert is still valid) ---
  const expiresDate =
    typeof body.expires_date === 'string' && body.expires_date.length > 0
      ? body.expires_date.trim()
      : null;
  const quantity =
    typeof body.quantity === 'number' && Number.isFinite(body.quantity)
      ? Math.max(1, Math.trunc(body.quantity))
      : 1;
  const purchaseType =
    typeof body.type === 'string' && body.type.length > 0 ? body.type : 'auto_renewable';
  const eventType = typeof body.event_type === 'string' ? body.event_type : '';
  const autoRenew =
    typeof body.auto_renew_status === 'boolean' ? body.auto_renew_status : null;
  const rawPayload =
    body.raw_payload && typeof body.raw_payload === 'object' ? body.raw_payload : {};

  // --- Infer ACTIVE vs EXPIRED: explicit event_type wins; else use expires_date vs "now" ---
  const nowIso = new Date().toISOString();
  const expiresMs = expiresDate ? new Date(expiresDate).getTime() : null;
  const expiredByDate = expiresMs !== null && !Number.isNaN(expiresMs) && expiresMs <= Date.now();

  let inferredStatus: 'ACTIVE' | 'EXPIRED' = 'ACTIVE';
  const term = terminalEvent(eventType);
  if (term === 'EXPIRED' || expiredByDate) inferredStatus = 'EXPIRED';
  else if (term === 'ACTIVE') inferredStatus = 'ACTIVE';

  const admin = supabaseAdmin;

  let subscriptionId = subscriptionIdFromBody;
  let userId = userIdFromBody;

  // --- Resolve subscription + user (see file-level doc): fill user_id from row if only subscription_id sent ---
  if (subscriptionId && !userId) {
    const { data: owner } = await admin
      .from('subscription')
      .select('user_id')
      .eq('id', subscriptionId)
      .maybeSingle();
    if (owner?.user_id) userId = owner.user_id;
  }

  // Renewals / server-driven updates often know original_transaction_id + environment but not our internal UUID ---
  if (!subscriptionId && originalTransactionId) {
    const { data: byOrig } = await admin
      .from('subscription')
      .select('id, user_id')
      .eq('environment', environment)
      .eq('original_transaction_id', originalTransactionId)
      .maybeSingle();
    if (byOrig) {
      subscriptionId = byOrig.id;
      userId = userId || byOrig.user_id;
    }
  }

  // First purchase: app created CREATED/PURCHASING + purchase-intent; link by user + StoreKit product id ---
  if (!subscriptionId && userId && productId) {
    const { data: cat } = await admin
      .from('subscription_catalog')
      .select('id')
      .eq('apple_product_id', productId)
      .maybeSingle();
    if (cat?.id) {
      const { data: pending } = await admin
        .from('subscription')
        .select('id, user_id')
        .eq('user_id', userId)
        .eq('subscription_catalog_id', cat.id)
        .in('status', ['CREATED', 'PURCHASING'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (pending) {
        subscriptionId = pending.id;
        userId = pending.user_id;
      }
    }
  }

  if (!subscriptionId || !userId) {
    return jsonError(
      'Could not resolve subscription: pass subscription_id and user_id, or original_transaction_id, or user_id + product_id for a pending purchase',
      400
    );
  }

  // --- Ensure subscription_id belongs to user_id (prevents cross-user updates if IDs are wrong) ---
  const { data: subRow, error: subFetchErr } = await admin
    .from('subscription')
    .select('id, user_id')
    .eq('id', subscriptionId)
    .maybeSingle();

  if (subFetchErr) return jsonError(subFetchErr.message, 500);
  if (!subRow || subRow.user_id !== userId) {
    return jsonError('subscription_id does not match user_id', 400);
  }

  // --- Append-only logical ledger: same Apple transaction → same row (upsert on unique env+transaction_id) ---
  const { error: purchaseErr } = await admin.from('apple_purchase').upsert(
    {
      user_id: userId,
      subscription_id: subscriptionId,
      transaction_id: transactionId,
      original_transaction_id: originalTransactionId || null,
      product_id: productId,
      environment,
      purchase_date: purchaseDate,
      expires_date: expiresDate,
      quantity,
      type: purchaseType,
      raw_payload: rawPayload as Record<string, unknown>,
    },
    { onConflict: 'environment,transaction_id' }
  );

  if (purchaseErr) return jsonError(purchaseErr.message, 500);

  // --- Patch subscription lifecycle fields; do not clear original_transaction_id / current_period_end when omitted ---
  const subPatch: Record<string, unknown> = {
    status: inferredStatus,
    environment,
    current_period_start: purchaseDate,
    status_changed_at: nowIso,
  };
  if (originalTransactionId) subPatch.original_transaction_id = originalTransactionId;
  if (expiresDate !== null) subPatch.current_period_end = expiresDate;
  if (autoRenew !== null) subPatch.auto_renew_status = autoRenew;

  const { error: subUpdErr } = await admin
    .from('subscription')
    .update(subPatch)
    .eq('id', subscriptionId)
    .eq('user_id', userId);

  if (subUpdErr) return jsonError(subUpdErr.message, 500);

  return NextResponse.json({
    ok: true,
    subscription_id: subscriptionId,
    status: inferredStatus,
  });
}
