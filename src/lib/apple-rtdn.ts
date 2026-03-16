/**
 * Helpers for Apple RTDN (Real-Time Developer Notifications) webhook.
 * Load Apple root CA certs for JWS verification.
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Load Apple root certificates as DER Buffers for SignedDataVerifier.
 * - If APPLE_ROOT_CA_CERTS_PATH is set: directory containing .cer or .pem files (each file = one cert).
 * - If APPLE_ROOT_CA_PEM is set: single PEM string (one or more -----BEGIN CERTIFICATE----- blocks).
 * - Otherwise returns empty array (verification will be skipped or fail; caller should check).
 */
export function loadAppleRootCerts(): Buffer[] {
  const pemEnv = process.env.APPLE_ROOT_CA_PEM;
  const pathEnv = process.env.APPLE_ROOT_CA_CERTS_PATH;

  if (pathEnv) {
    const bufs: Buffer[] = [];
    const files = readdirSync(pathEnv);
    for (const f of files) {
      if (!f.endsWith('.cer') && !f.endsWith('.pem') && !f.endsWith('.crt')) continue;
      const full = join(pathEnv, f);
      const buf = readFileSync(full);
      if (buf[0] === 0x30) {
        bufs.push(buf);
      } else {
        bufs.push(...pemToDerBuffers(buf.toString('utf8')));
      }
    }
    return bufs;
  }

  if (pemEnv) {
    return pemToDerBuffers(pemEnv);
  }

  return [];
}

function pemToDerBuffers(pem: string): Buffer[] {
  const out: Buffer[] = [];
  const re = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pem)) !== null) {
    const b64 = m[0]
      .replace(/-----BEGIN CERTIFICATE-----/, '')
      .replace(/-----END CERTIFICATE-----/, '')
      .replace(/\s/g, '');
    out.push(Buffer.from(b64, 'base64'));
  }
  return out;
}
