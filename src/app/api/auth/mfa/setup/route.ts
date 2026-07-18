import { NextResponse } from 'next/server';
import { getAdminSession } from '@/lib/auth';
import { generateTOTPSecret } from '@/lib/crypto';
import { supabaseAdmin } from '@/lib/supabase';
import QRCode from 'qrcode';

export async function POST() {
  try {
    const session = await getAdminSession();
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized: Admin session required.' }, { status: 401 });
    }

    const secret = generateTOTPSecret();
    const email = session.email;
    const issuer = 'Siddesh Tech LMS';
    const otpAuthUri = `otpauth://totp/${issuer}:${email}?secret=${secret}&issuer=${issuer}`;
    
    // Generate QR code data URL
    const qrCode = await QRCode.toDataURL(otpAuthUri);

    // Save temporary TOTP secret in DB (mfa_enabled stays false until verified)
    const { error } = await supabaseAdmin
      .from('admin_users')
      .update({ totp_secret: secret, mfa_enabled: false })
      .eq('email', email);

    if (error) {
      if (error.code === '42P01' || error.code === 'PGRST205') {
        return NextResponse.json({
          error: 'MFA setup is unavailable: admin_users table does not exist in your database. Please run the SQL schema script first.'
        }, { status: 403 });
      }
      console.error('MFA setup DB error:', error.message);
      return NextResponse.json({ error: 'Failed to initialize MFA in database.' }, { status: 500 });
    }

    return NextResponse.json({ success: true, secret, qrCode });
  } catch (err: unknown) {
    console.error('MFA Setup API Error:', err);
    return NextResponse.json({ error: 'Internal setup error.' }, { status: 500 });
  }
}
