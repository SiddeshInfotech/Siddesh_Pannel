import { NextRequest, NextResponse } from 'next/server';
import { getAdminSession, logSecurityEvent } from '@/lib/auth';
import { verifyPassword, verifyTOTP, decryptAES } from '@/lib/crypto';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(req: NextRequest) {
  try {
    const ip =
      req.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      req.headers.get('x-real-ip') ||
      '127.0.0.1';

    // 1. Authenticate session
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
    }

    let body: any /* eslint-disable-line @typescript-eslint/no-explicit-any */;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
    }

    const { password, code } = body;
    if (typeof password !== 'string' || typeof code !== 'string') {
      return NextResponse.json({ error: 'Invalid input types.' }, { status: 400 });
    }

    if (!password || !code) {
      return NextResponse.json({ error: 'Password and authenticator code are required.' }, { status: 400 });
    }

    // 2. Fetch admin user
    const { data: adminUsers, error: queryError } = await supabaseAdmin
      .from('admin_users')
      .select('*')
      .eq('email', session.email)
      .order('created_at', { ascending: true })
      .limit(1);

    const matchedUser = adminUsers?.[0];

    if (queryError || !matchedUser) {
      return NextResponse.json({ error: 'Admin user not found.' }, { status: 404 });
    }

    // 3. Verify password
    const isPasswordValid = await verifyPassword(password, matchedUser.password_hash, matchedUser.salt);
    if (!isPasswordValid) {
      await logSecurityEvent(session.email, 'FAILED_MFA_RESET_PASSWORD_INVALID', ip, req.headers.get('user-agent'));
      return NextResponse.json({ error: 'Invalid credentials.' }, { status: 401 });
    }

    // 4. Verify OTP code
    if (!matchedUser.mfa_enabled || !matchedUser.totp_secret) {
      return NextResponse.json({ error: 'MFA is not enabled.' }, { status: 400 });
    }

    let decryptedSecret: string;
    try {
      decryptedSecret = decryptAES(matchedUser.totp_secret);
    } catch (err) {
      console.error('Failed to decrypt TOTP secret during reset:', err);
      return NextResponse.json({ error: 'Server key decryption error.' }, { status: 500 });
    }

    const matchedCounter = verifyTOTP(decryptedSecret, code, 1); // strict ±30s window
    if (matchedCounter === null) {
      await logSecurityEvent(session.email, 'FAILED_MFA_RESET_OTP_INVALID', ip, req.headers.get('user-agent'));
      return NextResponse.json({ error: 'Invalid authenticator code.' }, { status: 401 });
    }

    // Check for replay
    if (matchedUser.totp_last_counter !== null && BigInt(matchedCounter) <= BigInt(matchedUser.totp_last_counter)) {
      return NextResponse.json({ error: 'Authenticator code already used. Please wait for the next code.' }, { status: 401 });
    }

    // 5. Update user to disable MFA
    const { error: updateError } = await supabaseAdmin
      .from('admin_users')
      .update({
        mfa_enabled: false,
        totp_secret: null,
        recovery_code_hashes: [],
        mfa_challenge_nonce: null,
        mfa_failures: 0,
        mfa_locked_until: null,
        totp_last_counter: matchedCounter,
      })
      .eq('id', matchedUser.id);

    if (updateError) {
      console.error('Failed to update MFA settings in database:', updateError.message);
      return NextResponse.json({ error: 'Database update failed.' }, { status: 500 });
    }

    await logSecurityEvent(session.email, 'MFA_DISABLED', ip, req.headers.get('user-agent'));

    return NextResponse.json({
      success: true,
      message: 'MFA disabled successfully.',
    });
  } catch (err: unknown) {
    console.error('MFA Reset API Error:', err);
    return NextResponse.json({ error: 'Internal server error.' }, { status: 500 });
  }
}
