import { createHash } from 'crypto';
import type { NextRequest } from 'next/server';

function expectedAdminSessionValue() {
  const u = process.env.ADMIN_USERNAME ?? '';
  const p = process.env.ADMIN_PASSWORD ?? '';
  return createHash('sha256').update(`${u}:${p}`).digest('hex');
}

export function isAdminRequest(req: NextRequest) {
  const adminSession = req.cookies.get('admin_session')?.value;
  if (!adminSession) return false;
  return adminSession === expectedAdminSessionValue();
}


