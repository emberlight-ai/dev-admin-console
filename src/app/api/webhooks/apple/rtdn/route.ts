import { NextRequest, NextResponse } from 'next/server';
import {
  SignedDataVerifier,
  Environment,
  VerificationException,
} from '@apple/app-store-server-library';
import { loadAppleRootCerts } from '@/lib/apple-rtdn';
import { supabaseAdmin } from '@/lib/supabase';
import {
  getPlanIdFromAppleProductId,
  getPlanPriceCents,
} from '@/lib/subscription-plans';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BUNDLE_ID = process.env.APPLE_APP_BUNDLE_ID ?? '';
const APP_APPLE_ID = process.env.APPLE_APP_STORE_APP_APPLE_ID
  ? parseInt(process.env.APPLE_APP_STORE_APP_APPLE_ID, 10)
  : undefined;

function getVerifier(env: Environment): SignedDataVerifier | null {
  const rootCerts = loadAppleRootCerts();
  if (rootCerts.length === 0) return null;
  if (!BUNDLE_ID) return null;
  try {
    return new SignedDataVerifier(
      rootCerts,
      true,
      env,
      BUNDLE_ID,
      env === Environment.PRODUCTION ? APP_APPLE_ID : undefined
    );
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let signedPayload: string;
  try {
    signedPayload = await req.text();
  } catch {
    return NextResponse.json(
      { error: 'Invalid body' },
      { status: 400 }
    );
  }

  if (!signedPayload?.trim()) {
    return NextResponse.json(
      { error: 'Missing signed payload' },
      { status: 400 }
    );
  }

  const verifierSandbox = getVerifier(Environment.SANDBOX);
  const verifierProduction = getVerifier(Environment.PRODUCTION);
  if (!verifierSandbox && !verifierProduction) {
    return NextResponse.json(
      { error: 'Apple root certs or bundle ID not configured' },
      { status: 503 }
    );
  }

  let decoded: Awaited<ReturnType<SignedDataVerifier['verifyAndDecodeNotification']>>;
  try {
    try {
      decoded = await (verifierSandbox ?? verifierProduction)!.verifyAndDecodeNotification(signedPayload);
    } catch (e) {
      if (verifierSandbox && verifierProduction && e instanceof VerificationException) {
        const other = verifierSandbox ? verifierProduction : verifierSandbox;
        decoded = await other!.verifyAndDecodeNotification(signedPayload);
      } else {
        throw e;
      }
    }
  } catch (e) {
    console.error('RTDN verification failed:', e);
    return NextResponse.json(
      { error: 'Verification failed' },
      { status: 400 }
    );
  }

  const notificationUUID = decoded.notificationUUID;
  const notificationType = decoded.notificationType ?? '';
  const subtype = decoded.subtype ?? '';
  const data = decoded.data;
  const environment = data?.environment ?? '';

  if (!notificationUUID) {
    return NextResponse.json(
      { error: 'Missing notificationUUID' },
      { status: 400 }
    );
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('apple_rtdn_events')
    .insert({
      notification_uuid: notificationUUID,
      notification_type: notificationType,
      subtype,
      environment: environment || null,
      bundle_id: data?.bundleId ?? null,
      decoded_original_transaction_id: null,
      decoded_transaction_id: null,
      decoded_product_id: null,
      decoded_expires_date_ms: null,
      decoded_auto_renew_status: null,
    })
    .select('id')
    .maybeSingle();

  if (insertError) {
    if (insertError.code === '23505') {
      return new NextResponse(null, { status: 200 });
    }
    console.error('RTDN event insert error:', insertError);
    return NextResponse.json(
      { error: 'Database error' },
      { status: 500 }
    );
  }

  if (!inserted) {
    return new NextResponse(null, { status: 200 });
  }

  const signedTransactionInfo = data?.signedTransactionInfo;
  const signedRenewalInfo = data?.signedRenewalInfo;
  let originalTransactionId: string | null = null;
  let transactionId: string | null = null;
  let productId: string | null = null;
  let expiresDateMs: number | null = null;
  let autoRenewStatus: number | null = null;

  const verifier = verifierProduction ?? verifierSandbox!;
  if (signedTransactionInfo) {
    try {
      const tx = await verifier.verifyAndDecodeTransaction(signedTransactionInfo);
      originalTransactionId = tx.originalTransactionId ?? null;
      transactionId = tx.transactionId ?? null;
      productId = tx.productId ?? null;
      expiresDateMs = tx.expiresDate ?? null;
    } catch (e) {
      console.error('Decode transaction failed:', e);
    }
  }
  if (signedRenewalInfo) {
    try {
      const renewal = await verifier.verifyAndDecodeRenewalInfo(signedRenewalInfo);
      if (autoRenewStatus === null) autoRenewStatus = renewal.autoRenewStatus ?? null;
    } catch (e) {
      console.error('Decode renewal failed:', e);
    }
  }

  await supabaseAdmin
    .from('apple_rtdn_events')
    .update({
      decoded_original_transaction_id: originalTransactionId,
      decoded_transaction_id: transactionId,
      decoded_product_id: productId,
      decoded_expires_date_ms: expiresDateMs,
      decoded_auto_renew_status: autoRenewStatus,
    })
    .eq('notification_uuid', notificationUUID);

  let userId: string | null = null;
  if (originalTransactionId) {
    const { data: row } = await supabaseAdmin
      .from('apple_subscription_identifiers')
      .select('userid')
      .eq('original_transaction_id', originalTransactionId)
      .maybeSingle();
    userId = row?.userid ?? null;
  }

  const envColumn = environment === 'Production' ? 'Production' : environment === 'Sandbox' ? 'Sandbox' : null;
  const expiresAt = expiresDateMs != null ? new Date(expiresDateMs).toISOString().replace('Z', '') : null;
  const planId = productId ? getPlanIdFromAppleProductId(productId) : null;

  if (userId) {
    if (
      notificationType === 'SUBSCRIBED' &&
      (subtype === 'INITIAL_BUY' || subtype === 'DID_RENEW' || subtype === 'RESUBSCRIBE')
    ) {
      await supabaseAdmin.from('user_subscription').upsert(
        {
          userid: userId,
          is_premium: true,
          plan_id: planId ?? undefined,
          expires_at: expiresAt,
          auto_renewal: autoRenewStatus === 1,
          original_transaction_id: originalTransactionId,
          environment: envColumn,
          product_id_apple: productId ?? undefined,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'userid' }
      );

      const amountCents = planId ? getPlanPriceCents(planId) : null;
      if (
        (subtype === 'INITIAL_BUY' || subtype === 'DID_RENEW' || subtype === 'RESUBSCRIBE') &&
        transactionId &&
        amountCents != null
      ) {
        await supabaseAdmin.from('subscription_purchases').insert({
          userid: userId,
          plan_id: planId ?? productId ?? 'unknown',
          amount_cents: amountCents,
          source: 'apple_iap',
          original_transaction_id: originalTransactionId,
          transaction_id: transactionId,
          environment: envColumn,
          product_id_apple: productId ?? undefined,
        }).then((r) => {
          if (r.error && r.error.code !== '23505') console.error('Purchase insert error:', r.error);
        });
      }
    } else if (notificationType === 'DID_CHANGE_RENEWAL_STATUS' && subtype === 'AUTO_RENEW_DISABLED') {
      await supabaseAdmin
        .from('user_subscription')
        .update({ auto_renewal: false, updated_at: new Date().toISOString() })
        .eq('userid', userId);
    } else if (
      notificationType === 'EXPIRED' ||
      notificationType === 'DID_FAIL_TO_RENEW' ||
      notificationType === 'REVOKE'
    ) {
      await supabaseAdmin
        .from('user_subscription')
        .update({ is_premium: false, updated_at: new Date().toISOString() })
        .eq('userid', userId);
    }
  }

  await supabaseAdmin
    .from('apple_rtdn_events')
    .update({
      userid: userId,
      processed_at: new Date().toISOString(),
    })
    .eq('notification_uuid', notificationUUID);

  return new NextResponse(null, { status: 200 });
}
