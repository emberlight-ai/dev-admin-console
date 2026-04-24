import type { SupabaseClient } from '@supabase/supabase-js';
import { decodeJwt } from 'jose';

/** Decoded App Store Server Notification V2 (payload only; verify JWS before trusting in production). */
export type AppleNotificationPayload = {
  notificationType?: string;
  subtype?: string;
  notificationUUID?: string;
  version?: string;
  signedDate?: number;
  data?: AppleNotificationData;
  summary?: unknown;
  appData?: unknown;
};

type AppleNotificationData = {
  appAppleId?: number;
  bundleId?: string;
  bundleVersion?: string;
  environment?: string;
  signedTransactionInfo?: string | Record<string, unknown>;
  signedRenewalInfo?: string | Record<string, unknown>;
  status?: number;
};

function msToIso(ms: unknown): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizeEnvironment(raw: unknown): 'Sandbox' | 'Production' | null {
  if (raw === 'Sandbox' || raw === 'Production') return raw;
  return null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function decodeJwsField(field: string | Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!field) return null;
  if (typeof field === 'object') return field as Record<string, unknown>;
  if (typeof field === 'string' && field.split('.').length === 3) {
    try {
      return decodeJwt(field) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function getTransactionAndRenewal(data: unknown): {
  tx: Record<string, unknown> | null;
  renewal: Record<string, unknown> | null;
  dataEnv: 'Sandbox' | 'Production' | null;
} {
  const d = asRecord(data);
  if (!d) return { tx: null, renewal: null, dataEnv: null };
  const tx = decodeJwsField(d.signedTransactionInfo as string | Record<string, unknown> | undefined);
  const renewal = decodeJwsField(d.signedRenewalInfo as string | Record<string, unknown> | undefined);
  const dataEnv = normalizeEnvironment(d.environment ?? tx?.environment ?? renewal?.environment);
  return { tx, renewal, dataEnv };
}

function boolFromAutoRenew(v: unknown): boolean | null {
  if (v === 1 || v === true) return true;
  if (v === 0 || v === false) return false;
  return null;
}

async function resolveSubscriptionRow(
  admin: SupabaseClient,
  env: 'Sandbox' | 'Production',
  originalTransactionId: string,
  appAccountToken: string | undefined,
): Promise<{ id: string; user_id: string } | null> {
  const { data: byOt } = await admin
    .from('subscription')
    .select('id, user_id')
    .eq('original_transaction_id', originalTransactionId)
    .or(`environment.eq.${env},environment.is.null`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (byOt?.id && byOt.user_id) return { id: byOt.id, user_id: byOt.user_id };

  if (appAccountToken) {
    const { data: byToken } = await admin
      .from('subscription')
      .select('id, user_id')
      .eq('user_id', appAccountToken)
      .in('status', ['CREATED', 'PURCHASING'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (byToken?.id && byToken.user_id) return { id: byToken.id, user_id: byToken.user_id };
  }

  return null;
}

async function insertApplePurchase(
  admin: SupabaseClient,
  args: {
    userId: string;
    subscriptionId: string;
    tx: Record<string, unknown>;
    env: 'Sandbox' | 'Production';
    rawPayload: Record<string, unknown>;
  },
): Promise<{ skipped: boolean; error?: string }> {
  const transactionId = args.tx.transactionId;
  if (typeof transactionId !== 'string' || !transactionId) {
    return { skipped: true, error: 'missing transactionId' };
  }
  const purchaseDate = msToIso(args.tx.purchaseDate) ?? new Date().toISOString();
  const expiresDate = msToIso(args.tx.expiresDate);
  const originalTransactionId =
    typeof args.tx.originalTransactionId === 'string' ? args.tx.originalTransactionId : null;
  const productId = typeof args.tx.productId === 'string' ? args.tx.productId : '';
  if (!productId) return { skipped: true, error: 'missing productId' };

  const row = {
    user_id: args.userId,
    subscription_id: args.subscriptionId,
    transaction_id: transactionId,
    original_transaction_id: originalTransactionId,
    product_id: productId,
    environment: args.env,
    purchase_date: purchaseDate,
    expires_date: expiresDate,
    quantity: typeof args.tx.quantity === 'number' ? args.tx.quantity : 1,
    type: 'auto_renewable',
    raw_payload: args.rawPayload as unknown as Record<string, unknown>,
  };

  const { error } = await admin.from('apple_purchase').upsert(row, {
    onConflict: 'environment,transaction_id',
    ignoreDuplicates: true,
  });
  if (error) return { skipped: false, error: error.message };
  return { skipped: false };
}

async function updateSubscriptionActive(
  admin: SupabaseClient,
  subscriptionId: string,
  args: {
    env: 'Sandbox' | 'Production';
    originalTransactionId: string;
    periodStart: string | null;
    periodEnd: string | null;
    autoRenew: boolean | null;
    catalogId?: string;
  },
): Promise<{ error?: string }> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    status: 'ACTIVE',
    environment: args.env,
    original_transaction_id: args.originalTransactionId,
    current_period_start: args.periodStart,
    current_period_end: args.periodEnd,
    status_changed_at: now,
  };
  if (args.autoRenew !== null) patch.auto_renew_status = args.autoRenew;
  if (args.catalogId) patch.subscription_catalog_id = args.catalogId;

  const { error } = await admin.from('subscription').update(patch).eq('id', subscriptionId);
  if (error) return { error: error.message };
  return {};
}

async function updateSubscriptionRenewalOnly(
  admin: SupabaseClient,
  subscriptionId: string,
  autoRenew: boolean | null,
  periodEnd: string | null,
): Promise<{ error?: string }> {
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status_changed_at: now };
  if (autoRenew !== null) patch.auto_renew_status = autoRenew;
  if (periodEnd) patch.current_period_end = periodEnd;

  const { error } = await admin.from('subscription').update(patch).eq('id', subscriptionId);
  if (error) return { error: error.message };
  return {};
}

async function updateSubscriptionExpired(admin: SupabaseClient, subscriptionId: string): Promise<{ error?: string }> {
  const now = new Date().toISOString();
  const { error } = await admin
    .from('subscription')
    .update({
      status: 'EXPIRED',
      auto_renew_status: false,
      status_changed_at: now,
    })
    .eq('id', subscriptionId);
  if (error) return { error: error.message };
  return {};
}

async function resolveSubscriptionByOriginalTxOnly(
  admin: SupabaseClient,
  env: 'Sandbox' | 'Production',
  originalTransactionId: string,
): Promise<{ id: string; user_id: string } | null> {
  const { data } = await admin
    .from('subscription')
    .select('id, user_id')
    .eq('original_transaction_id', originalTransactionId)
    .or(`environment.eq.${env},environment.is.null`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data?.id && data.user_id) return { id: data.id, user_id: data.user_id };
  return null;
}

async function applyActiveFromTransaction(
  admin: SupabaseClient,
  payload: AppleNotificationPayload,
  tx: Record<string, unknown>,
  renewal: Record<string, unknown> | null,
  dataEnv: 'Sandbox' | 'Production' | null,
): Promise<void> {
  const env = dataEnv ?? normalizeEnvironment(tx.environment);
  if (!env) {
    console.warn('[apple-subscription] skip activate: unknown environment');
    return;
  }
  const originalTransactionId = tx.originalTransactionId;
  const productId = tx.productId;
  if (typeof originalTransactionId !== 'string' || typeof productId !== 'string') {
    console.warn('[apple-subscription] skip activate: missing originalTransactionId or productId');
    return;
  }
  const appAccountToken = typeof tx.appAccountToken === 'string' ? tx.appAccountToken : undefined;

  const sub = await resolveSubscriptionRow(admin, env, originalTransactionId, appAccountToken);
  if (!sub) {
    console.warn('[apple-subscription] no subscription row for transaction', {
      originalTransactionId,
      productId,
      notificationUUID: payload.notificationUUID,
    });
    return;
  }

  let catalogId: string | undefined;
  const renewProductId =
    typeof renewal?.autoRenewProductId === 'string'
      ? renewal.autoRenewProductId
      : typeof renewal?.productId === 'string'
        ? renewal.productId
        : undefined;
  if (renewProductId && renewProductId !== productId) {
    const { data: cat } = await admin
      .from('subscription_catalog')
      .select('id')
      .eq('apple_product_id', renewProductId)
      .maybeSingle();
    if (cat?.id) catalogId = cat.id;
  }

  const autoRenew = renewal ? boolFromAutoRenew(renewal.autoRenewStatus) : null;
  const periodStart = msToIso(tx.purchaseDate);
  const periodEnd = msToIso(tx.expiresDate ?? renewal?.renewalDate);

  const up = await updateSubscriptionActive(admin, sub.id, {
    env,
    originalTransactionId,
    periodStart,
    periodEnd,
    autoRenew,
    catalogId,
  });
  if (up.error) {
    console.warn('[apple-subscription] update ACTIVE failed', up.error);
    return;
  }

  const ins = await insertApplePurchase(admin, {
    userId: sub.user_id,
    subscriptionId: sub.id,
    tx,
    env,
    rawPayload: {
      notificationType: payload.notificationType,
      subtype: payload.subtype,
      notificationUUID: payload.notificationUUID,
      signedTransactionInfo: tx,
      signedRenewalInfo: renewal,
    },
  });
  if (ins.error) console.warn('[apple-subscription] apple_purchase upsert failed', ins.error);
}

async function applyRenewalPrefChange(
  admin: SupabaseClient,
  env: 'Sandbox' | 'Production',
  originalTransactionId: string,
  renewal: Record<string, unknown>,
): Promise<void> {
  const sub = await resolveSubscriptionByOriginalTxOnly(admin, env, originalTransactionId);
  if (!sub) {
    console.warn('[apple-subscription] DID_CHANGE_RENEWAL_PREF: subscription not found', originalTransactionId);
    return;
  }
  const renewProductId =
    typeof renewal.autoRenewProductId === 'string'
      ? renewal.autoRenewProductId
      : typeof renewal.productId === 'string'
        ? renewal.productId
        : null;
  if (!renewProductId) return;

  const { data: cat } = await admin
    .from('subscription_catalog')
    .select('id')
    .eq('apple_product_id', renewProductId)
    .maybeSingle();
  if (!cat?.id) {
    console.warn('[apple-subscription] DID_CHANGE_RENEWAL_PREF: unknown product', renewProductId);
    return;
  }

  const autoRenew = boolFromAutoRenew(renewal.autoRenewStatus);
  const periodEnd = msToIso(renewal.renewalDate);
  const { error } = await admin
    .from('subscription')
    .update({
      subscription_catalog_id: cat.id,
      ...(autoRenew !== null ? { auto_renew_status: autoRenew } : {}),
      ...(periodEnd ? { current_period_end: periodEnd } : {}),
      status_changed_at: new Date().toISOString(),
    })
    .eq('id', sub.id);
  if (error) console.warn('[apple-subscription] renewal pref update failed', error.message);
}

/**
 * Route notification to DB updates per docs/subscription-design.md §2.C.
 */
export async function dispatchAppleSubscriptionNotification(
  admin: SupabaseClient,
  signedPayloadJwt: string,
): Promise<void> {
  let outer: Record<string, unknown>;
  try {
    outer = decodeJwt(signedPayloadJwt) as Record<string, unknown>;
  } catch {
    throw new Error('Invalid signedPayload JWT');
  }

  const payload = outer as unknown as AppleNotificationPayload;
  const notificationType = payload.notificationType ?? '';
  const subtype = payload.subtype ?? '';

  console.log('[apple-subscription]', {
    notificationType,
    subtype,
    notificationUUID: payload.notificationUUID,
  });

  const { tx, renewal, dataEnv } = getTransactionAndRenewal(payload.data);

  if (payload.summary && !payload.data) {
    console.warn('[apple-subscription] summary-only notification; not implemented', {
      notificationType,
      subtype,
      notificationUUID: payload.notificationUUID,
    });
    return;
  }

  switch (notificationType) {
    case 'SUBSCRIBED':
    case 'OFFER_REDEEMED':
      if (tx) await applyActiveFromTransaction(admin, payload, tx, renewal, dataEnv);
      else console.warn('[apple-subscription] missing transaction JWS for', notificationType);
      break;

    case 'DID_RENEW':
      if (tx) await applyActiveFromTransaction(admin, payload, tx, renewal, dataEnv);
      else console.warn('[apple-subscription] DID_RENEW missing transaction');
      break;

    case 'DID_CHANGE_RENEWAL_STATUS': {
      const env = dataEnv ?? normalizeEnvironment(renewal?.environment ?? tx?.environment);
      const originalTransactionId =
        (typeof renewal?.originalTransactionId === 'string' && renewal.originalTransactionId) ||
        (typeof tx?.originalTransactionId === 'string' && tx.originalTransactionId);
      console.log('[apple-subscription] DID_CHANGE_RENEWAL_STATUS payload', {
        notificationUUID: payload.notificationUUID,
        subtype,
        data: payload.data ?? null,
        renewal,
        transaction: tx,
        derivedEnv: env,
        derivedOriginalTransactionId: originalTransactionId ?? null,
      });
      // Test-only behavior: in Sandbox, route AUTO_RENEW_ENABLED through the same
      // activation path as SUBSCRIBED/DID_RENEW instead of originalTransactionId-only lookup.
      if (env === 'Sandbox' && subtype === 'AUTO_RENEW_ENABLED') {
        if (tx) {
          await applyActiveFromTransaction(admin, payload, tx, renewal, dataEnv);
          console.log('[apple-subscription] sandbox AUTO_RENEW_ENABLED routed to applyActiveFromTransaction', {
            notificationUUID: payload.notificationUUID,
          });
        } else {
          console.log('[apple-subscription] sandbox AUTO_RENEW_ENABLED missing transaction JWS');
        }
        break;
      }
      if (!env || !originalTransactionId) {
        console.log('[apple-subscription] DID_CHANGE_RENEWAL_STATUS: missing env or originalTransactionId');
        break;
      }
      const sub = await resolveSubscriptionByOriginalTxOnly(admin, env, originalTransactionId);
      if (!sub) {
        console.log('[apple-subscription] DID_CHANGE_RENEWAL_STATUS: subscription not found');
        break;
      }
      // Default production-safe path: update renewal metadata only.
      const autoRenew = renewal ? boolFromAutoRenew(renewal.autoRenewStatus) : null;
      const periodEnd = msToIso(renewal?.renewalDate ?? tx?.expiresDate);
      const r = await updateSubscriptionRenewalOnly(admin, sub.id, autoRenew, periodEnd);
      if (r.error) console.warn('[apple-subscription] renewal status update failed', r.error);
      break;
    }

    case 'DID_CHANGE_RENEWAL_PREF': {
      const env = dataEnv ?? normalizeEnvironment(renewal?.environment);
      const originalTransactionId =
        typeof renewal?.originalTransactionId === 'string' ? renewal.originalTransactionId : null;
      if (!env || !originalTransactionId || !renewal) {
        console.warn('[apple-subscription] DID_CHANGE_RENEWAL_PREF: missing renewal/env');
        break;
      }
      await applyRenewalPrefChange(admin, env, originalTransactionId, renewal);
      break;
    }

    case 'EXPIRED':
    case 'GRACE_PERIOD_EXPIRED': {
      const env = dataEnv ?? normalizeEnvironment(tx?.environment ?? renewal?.environment);
      const originalTransactionId =
        (typeof tx?.originalTransactionId === 'string' && tx.originalTransactionId) ||
        (typeof renewal?.originalTransactionId === 'string' && renewal.originalTransactionId);
      if (!env || !originalTransactionId) {
        console.warn('[apple-subscription] EXPIRED: missing env or originalTransactionId');
        break;
      }
      const sub = await resolveSubscriptionByOriginalTxOnly(admin, env, originalTransactionId);
      if (!sub) {
        console.warn('[apple-subscription] EXPIRED: subscription not found');
        break;
      }
      const r = await updateSubscriptionExpired(admin, sub.id);
      if (r.error) console.warn('[apple-subscription] EXPIRED update failed', r.error);
      break;
    }

    case 'DID_FAIL_TO_RENEW': {
      const env = dataEnv ?? normalizeEnvironment(renewal?.environment ?? tx?.environment);
      const originalTransactionId =
        (typeof renewal?.originalTransactionId === 'string' && renewal.originalTransactionId) ||
        (typeof tx?.originalTransactionId === 'string' && tx.originalTransactionId);
      if (!env || !originalTransactionId) break;
      const sub = await resolveSubscriptionByOriginalTxOnly(admin, env, originalTransactionId);
      if (!sub) break;
      const autoRenew = renewal ? boolFromAutoRenew(renewal.autoRenewStatus) : false;
      const r = await updateSubscriptionRenewalOnly(admin, sub.id, autoRenew ?? false, null);
      if (r.error) console.warn('[apple-subscription] DID_FAIL_TO_RENEW update failed', r.error);
      break;
    }

    case 'REFUND':
    case 'REVOKE': {
      const env = dataEnv ?? normalizeEnvironment(tx?.environment);
      const originalTransactionId = typeof tx?.originalTransactionId === 'string' ? tx.originalTransactionId : null;
      if (!env || !originalTransactionId || !tx) {
        console.warn('[apple-subscription] REFUND/REVOKE: missing data');
        break;
      }
      const sub = await resolveSubscriptionByOriginalTxOnly(admin, env, originalTransactionId);
      if (sub) {
        const r = await updateSubscriptionExpired(admin, sub.id);
        if (r.error) console.warn('[apple-subscription] REFUND/REVOKE expire failed', r.error);
      }
      if (sub) {
        const ins = await insertApplePurchase(admin, {
          userId: sub.user_id,
          subscriptionId: sub.id,
          tx,
          env,
          rawPayload: {
            notificationType,
            subtype,
            notificationUUID: payload.notificationUUID,
            signedTransactionInfo: tx,
          },
        });
        if (ins.error) console.warn('[apple-subscription] apple_purchase (refund) failed', ins.error);
      }
      break;
    }

    case 'REFUND_REVERSED':
      if (tx) await applyActiveFromTransaction(admin, payload, tx, renewal, dataEnv);
      else console.warn('[apple-subscription] REFUND_REVERSED missing transaction');
      break;

    case 'RENEWAL_EXTENDED':
    case 'RENEWAL_EXTENSION': {
      const env = dataEnv ?? normalizeEnvironment(tx?.environment ?? renewal?.environment);
      const originalTransactionId =
        (typeof renewal?.originalTransactionId === 'string' && renewal.originalTransactionId) ||
        (typeof tx?.originalTransactionId === 'string' && tx.originalTransactionId);
      if (!env || !originalTransactionId) break;
      const sub = await resolveSubscriptionByOriginalTxOnly(admin, env, originalTransactionId);
      if (!sub) break;
      const periodEnd = msToIso(renewal?.renewalDate ?? tx?.expiresDate);
      const r = await updateSubscriptionRenewalOnly(admin, sub.id, null, periodEnd);
      if (r.error) console.warn('[apple-subscription] renewal extension update failed', r.error);
      break;
    }

    case 'PRICE_INCREASE':
      break;

    case 'TEST':
      break;

    case 'CONSUMPTION_REQUEST':
      console.warn('[apple-subscription] CONSUMPTION_REQUEST received; handle via App Store Server API if required', {
        notificationUUID: payload.notificationUUID,
      });
      break;

    default:
      console.warn('[apple-subscription] unhandled notificationType', notificationType, {
        subtype,
        notificationUUID: payload.notificationUUID,
      });
  }
}
