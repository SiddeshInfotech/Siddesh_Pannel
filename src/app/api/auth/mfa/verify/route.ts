import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/auth';
import { verifyTOTP } from '@/lib/crypto';
import { supabaseAdmin } from '@/lib/supabase';

export async function POST(req: NextRequest) {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized: Admin session required.' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const bodyRecord = body as Record<string, unknown>;
    const code = bodyRecord.code;

    if (!code || typeof code !== 'string' || code.length !== 6) {
      return NextResponse.json({ error: 'Verification code must be 6 digits.' }, { status: 400 });
    }

    // Retrieve secret from DB
    const { data: user, error } = await supabaseAdmin
      .from('admin_users')
      .select('totp_secret')
      .eq('email', session.email)
      .maybeSingle();

    if (error || !user || !user.totp_secret) {
      console.error('MFA verify fetch error:', error?.message);
      return NextResponse.json({ error: 'Failed to retrieve TOTP secret.' }, { status: 500 });
    }

    // Verify TOTP code (allow 2-minute tolerance for clock drift)
    const isValid = verifyTOTP(user.totp_secret, code, 4);
    if (!isValid) {
      return NextResponse.json({ error: 'Invalid verification code. Please try again.' }, { status: 400 });
    }

    // Update DB to enable MFA
    const { error: updateError } = await supabaseAdmin
      .from('admin_users')
      .update({ mfa_enabled: true })
      .eq('email', session.email);

    if (updateError) {
      console.error('Failed to enable MFA in DB:', updateError.message);
      return NextResponse.json({ error: 'Failed to update MFA status.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Multi-Factor Authentication enabled successfully.' });
  } catch (err: unknown) {
    console.error('MFA Verify API Error:', err);
    return NextResponse.json({ error: 'Internal verification error.' }, { status: 500 });
  }
}
