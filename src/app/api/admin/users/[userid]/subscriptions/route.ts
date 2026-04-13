import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET(req: Request, { params }: { params: Promise<{ userid: string }> }) {
  try {
    const { userid } = await params

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL or Key not configured')
    }

    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: subscriptions, error } = await supabase
      .from('subscription')
      .select(`
        *,
        subscription_catalog (
          name,
          apple_product_id
        )
      `)
      .eq('user_id', userid)
      .order('created_at', { ascending: false })

    if (error) {
      throw error
    }

    return NextResponse.json({ data: subscriptions })
  } catch (err: unknown) {
    console.error('Error fetching user subscriptions:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
