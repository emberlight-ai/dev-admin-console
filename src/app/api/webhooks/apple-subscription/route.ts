import { decodeJwt } from 'jose';
import { NextRequest, NextResponse } from 'next/server';

const NESTED_JWS_KEYS = [
  'signedTransactionInfo',
  'signedRenewalInfo',
  'signedAppTransactionInfo',
] as const;

const LOG_PREFIX = '[apple-subscription]';

function logStep(step: string, details?: unknown) {
  if (details === undefined) {
    console.log(`${LOG_PREFIX} ${step}`);
    return;
  }
  console.log(`${LOG_PREFIX} ${step}`, details);
}

function tryDecodeJws(jws: string, key: string): Record<string, unknown> | string {
  logStep(`nested-decode:start (${key})`, {
    segmentCount: jws.split('.').length,
    tokenLength: jws.length,
  });
  try {
    const decoded = decodeJwt(jws) as Record<string, unknown>;
    logStep(`nested-decode:success (${key})`, {
      decodedKeys: Object.keys(decoded),
    });
    return decoded;
  } catch (err) {
    logStep(`nested-decode:failed (${key})`, err);
    return jws;
  }
}

function decodeNestedJwsFields(
  obj: Record<string, unknown>,
  parentKey: 'data' | 'appData',
): Record<string, unknown> {
  logStep(`decode-nested-fields:start (${parentKey})`, {
    availableKeys: Object.keys(obj),
  });
  const next = { ...obj };
  for (const key of NESTED_JWS_KEYS) {
    const v = next[key];
    logStep(`decode-nested-fields:inspect (${parentKey}.${key})`, {
      exists: v !== undefined,
      type: typeof v,
    });
    if (typeof v === 'string' && v.split('.').length === 3) {
      next[key] = tryDecodeJws(v, `${parentKey}.${key}`);
    } else if (v !== undefined) {
      logStep(`decode-nested-fields:skip (${parentKey}.${key})`, {
        reason: 'value is not compact JWS string',
      });
    }
  }
  logStep(`decode-nested-fields:done (${parentKey})`);
  return next;
}

function decodeAppleNotificationClaims(payload: Record<string, unknown>): Record<string, unknown> {
  logStep('claims-decode:start', { payloadKeys: Object.keys(payload) });
  const out: Record<string, unknown> = { ...payload };
  if (out.data && typeof out.data === 'object' && out.data !== null && !Array.isArray(out.data)) {
    logStep('claims-decode:data-present');
    out.data = decodeNestedJwsFields(out.data as Record<string, unknown>, 'data');
  } else {
    logStep('claims-decode:data-missing-or-not-object');
  }
  if (
    out.appData &&
    typeof out.appData === 'object' &&
    out.appData !== null &&
    !Array.isArray(out.appData)
  ) {
    logStep('claims-decode:appData-present');
    out.appData = decodeNestedJwsFields(out.appData as Record<string, unknown>, 'appData');
  } else {
    logStep('claims-decode:appData-missing-or-not-object');
  }
  logStep('claims-decode:done');
  return out;
}

/**
 * App Store Server Notifications V2: decodes `signedPayload` (and nested JWS blobs) with jose for logging.
 * Signature is not verified here — use Apple's library + certs when you persist or act on events.
 */
export async function POST(req: NextRequest) {
  logStep('request:start', {
    method: req.method,
    path: req.nextUrl.pathname,
    contentType: req.headers.get('content-type'),
    userAgent: req.headers.get('user-agent'),
  });

  let body: unknown;
  try {
    logStep('request:parse-json:start');
    body = await req.json();
    logStep('request:parse-json:success', {
      bodyType: typeof body,
      isArray: Array.isArray(body),
      keys: body && typeof body === 'object' ? Object.keys(body) : null,
    });
  } catch {
    logStep('request:parse-json:failed');
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!body || typeof body !== 'object' || !('signedPayload' in body)) {
    logStep('request:validation:missing-signedPayload');
    return NextResponse.json({ error: 'Missing signedPayload' }, { status: 400 });
  }

  const signedPayload = (body as { signedPayload?: unknown }).signedPayload;
  logStep('request:validation:signedPayload-found', {
    type: typeof signedPayload,
    length: typeof signedPayload === 'string' ? signedPayload.length : null,
  });
  if (typeof signedPayload !== 'string' || !signedPayload) {
    logStep('request:validation:invalid-signedPayload');
    return NextResponse.json({ error: 'signedPayload must be a non-empty string' }, { status: 400 });
  }

  let decoded: Record<string, unknown>;
  try {
    logStep('top-level-decode:start', {
      segmentCount: signedPayload.split('.').length,
    });
    decoded = decodeJwt(signedPayload) as Record<string, unknown>;
    logStep('top-level-decode:success', {
      decodedKeys: Object.keys(decoded),
      notificationType: decoded.notificationType ?? null,
      subtype: decoded.subtype ?? null,
      notificationUUID: decoded.notificationUUID ?? null,
    });
  } catch (err) {
    logStep('top-level-decode:failed', err);
    return NextResponse.json({ error: 'Invalid signedPayload JWT' }, { status: 400 });
  }

  logStep('claims-decode:begin');
  const decodedForLog = decodeAppleNotificationClaims(decoded);
  logStep('final-payload', decodedForLog);
  logStep('response:ok');

  return NextResponse.json({ ok: true });
}
