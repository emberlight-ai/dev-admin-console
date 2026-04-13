import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function POST(req: Request, { params }: { params: Promise<{ userid: string; subid: string }> }) {
  try {
    const { userid, subid } = await params

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL or Key not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)
    const now = new Date()

    const { data: updateData, error: updateError } = await supabase
      .from('subscription')
      .update({
        status: 'EXPIRED',
        current_period_end: now.toISOString(),
        status_changed_at: now.toISOString()
      })
      .eq('id', subid)
      .eq('user_id', userid)
      .select()
      .single()

    if (updateError) {
      throw new Error(updateError.message)
    }

    return NextResponse.json({ data: updateData })
  } catch (err: unknown) {
    console.error('Error revoking subscription:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
