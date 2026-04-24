import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ userid: string }> },
) {
  try {
    const { userid } = await params;
    const { plan_type } = await req.json(); // 'monthly' or 'yearly'

    if (!plan_type || !['monthly', 'yearly'].includes(plan_type)) {
      return NextResponse.json(
        { error: 'Invalid plan_type. Must be monthly or yearly.' },
        { status: 400 },
      );
    }

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase URL or Key not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Find the correct catalog ID
    const productId =
      plan_type === 'monthly'
        ? 'amber.premium.monthly.0.0'
        : 'amber.premium.yearly.0.0';
    const { data: catalogData, error: catalogError } = await supabase
      .from('subscription_catalog')
      .select('id')
      .eq('apple_product_id', productId)
      .single();

    if (catalogError || !catalogData) {
      throw new Error(
        `Could not find catalog row for ${productId}: ${catalogError?.message}`,
      );
    }

    // Calculate dates
    const now = new Date();
    const endDate = new Date();
    if (plan_type === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }

    // Insert new ACTIVE subscription row
    // We don't have an Apple transaction ID, so we mock one to make it unique and identifiable
    const adminTxId = `ADMIN_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const { data: insertData, error: insertError } = await supabase
      .from('subscription')
      .insert({
        user_id: userid,
        subscription_catalog_id: catalogData.id,
        status: 'ACTIVE',
        environment: 'Sandbox', // Must be Sandbox or Production
        current_period_start: now.toISOString(),
        current_period_end: endDate.toISOString(),
        original_transaction_id: adminTxId,
        auto_renew_status: false, // Obviously false, since it's a manual grant
        status_changed_at: now.toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json({ data: insertData });
  } catch (err: unknown) {
    console.error('Error granting subscription:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
