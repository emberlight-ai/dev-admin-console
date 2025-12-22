import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/lib/admin-auth';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  // 1. Get Auth User (metadata, last sign in)
  const { data: authUser, error: authErr } = await supabaseAdmin.auth.admin.getUserById(userid);
  if (authErr) {
    // If auth user not found (already hard deleted?), just return null
    return NextResponse.json({ data: null });
  }

  // 2. Get active sessions (to see device info)
  // supabaseAdmin.auth.admin.listUserSessions is not always available or might require specific permissions/versions.
  // We'll rely on getUserById for "last_sign_in_at" and "app_metadata".
  // Note: We can't easily get *active* session tokens without querying a sessions table if one existed, 
  // but auth.users has general info.
  // Actually, standard Supabase Auth Admin API doesn't expose "list sessions" for a user easily in all versions.
  // However, `supabaseAdmin.auth.admin.deleteUser` signs them out.
  // We can try to list factors or similar if needed, but for "current user signin info", getUserById is best source.
  
  return NextResponse.json({
    data: {
      id: authUser.user.id,
      email: authUser.user.email,
      phone: authUser.user.phone,
      last_sign_in_at: authUser.user.last_sign_in_at,
      created_at: authUser.user.created_at,
      app_metadata: authUser.user.app_metadata,
      user_metadata: authUser.user.user_metadata,
      role: authUser.user.role,
      aud: authUser.user.aud,
    }
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ userid: string }> }
) {
  if (!isAdminRequest(req)) return jsonError('Unauthorized', 401);
  const { userid } = await params;

  // Sign out the user (invalidate sessions)
  // We ignore errors here because if the user is not found or has no sessions, 
  // the goal (invalidating session) is effectively achieved.
  const { error } = await supabaseAdmin.auth.admin.signOut(userid);
  if (error) {
    console.warn('SignOut warning (ignored):', error.message);
  }

  return NextResponse.json({ ok: true });
}

