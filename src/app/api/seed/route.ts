import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

/**
 * POST /api/seed
 *
 * DEVELOPMENT ONLY — Wipes and reseeds the database with demo data.
 *
 * Security hardening:
 * 1. Blocked entirely in production (NODE_ENV check).
 * 2. Requires a secret SEED_SECRET token in the Authorization header,
 *    so even in dev/staging it cannot be called without knowing the secret.
 */
export async function POST(req: NextRequest) {
  // ── Guard 1: Block in production ──────────────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'This endpoint is disabled in production.' },
      { status: 403 }
    );
  }

  // ── Guard 2: Require secret token ─────────────────────────────────────────
  const seedSecret = process.env.SEED_SECRET;
  if (!seedSecret) {
    return NextResponse.json(
      { error: 'SEED_SECRET environment variable is not configured.' },
      { status: 500 }
    );
  }
  const authHeader = req.headers.get('authorization');
  const providedToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!providedToken || providedToken !== seedSecret) {
    return NextResponse.json(
      { error: 'Unauthorized. Invalid or missing seed token.' },
      { status: 401 }
    );
  }

  try {
    // ── 1. Wipe existing data ──────────────────────────────────────────────
    // Order matters: activation_keys + handshake_logs before schools (FK cascade)
    await supabaseAdmin.from('handshake_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabaseAdmin.from('activation_keys').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabaseAdmin.from('payments').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    await supabaseAdmin.from('schools').delete().neq('id', '00000000-0000-0000-0000-000000000000');

    console.log('[dev] Supabase tables cleared. Seeding with demo LMS schools...');

    // ── 2. Insert schools ──────────────────────────────────────────────────
    const { data: schoolOakridge, error: e1 } = await supabaseAdmin
      .from('schools')
      .insert({
        school_id: 'SCH-2024-001',
        name: 'Oakridge International',
        board: 'CBSE',
        mediums: ['English', 'Hindi'],
        street: 'Oakridge Campus, Nanakramguda',
        city: 'Hyderabad',
        state: 'Telangana',
        zip_code: '500032',
        country: 'India',
        coordinator_name: 'Rajesh Kumar',
        email: 'rajesh.kumar@oakridge.in',
        phone: '+91 98450 12345',
        classrooms_count: 42,
        has_computer_lab: true,
        internet_access: 'OPTICAL FIBER',
        status: 'Active',
      })
      .select()
      .single();
    if (e1) throw new Error(`Oakridge insert failed: ${e1.message}`);

    const { data: schoolDelhi, error: e2 } = await supabaseAdmin
      .from('schools')
      .insert({
        school_id: 'SCH-2024-042',
        name: 'Delhi Public School',
        board: 'ICSE',
        mediums: ['English'],
        street: 'DPS Sector 4, Dwarka',
        city: 'New Delhi',
        state: 'Delhi',
        zip_code: '110075',
        country: 'India',
        coordinator_name: 'Sanjay Dutt',
        email: 'sanjay.dutt@dpsdwarka.edu.in',
        phone: '+91 99100 98765',
        classrooms_count: 65,
        has_computer_lab: true,
        internet_access: 'BROADBAND',
        status: 'Active',
      })
      .select()
      .single();
    if (e2) throw new Error(`Delhi insert failed: ${e2.message}`);

    const { data: schoolHeritage, error: e3 } = await supabaseAdmin
      .from('schools')
      .insert({
        school_id: 'SCH-2024-109',
        name: 'The Heritage School',
        board: 'IGCSE',
        mediums: ['English'],
        street: 'DPS Sector 62, Gurgaon',
        city: 'Gurugram',
        state: 'Haryana',
        zip_code: '122003',
        country: 'India',
        coordinator_name: 'Anil Kapoor',
        email: 'anil@theheritageschool.in',
        phone: '+91 95400 45678',
        classrooms_count: 30,
        has_computer_lab: false,
        internet_access: 'BASIC',
        status: 'Active',
      })
      .select()
      .single();
    if (e3) throw new Error(`Heritage insert failed: ${e3.message}`);

    const { data: schoolGlobal, error: e4 } = await supabaseAdmin
      .from('schools')
      .insert({
        school_id: 'SCH-2024-312',
        name: 'Global Pathways Academy',
        board: 'State Board',
        mediums: ['English', 'Marathi'],
        street: 'Near St. Xavier Road',
        city: 'Mumbai',
        state: 'Maharashtra',
        zip_code: '400001',
        country: 'India',
        coordinator_name: 'Amit Shah',
        email: 'amit@globalpathways.in',
        phone: '+91 98200 11223',
        classrooms_count: 25,
        has_computer_lab: true,
        internet_access: 'OPTICAL FIBER',
        status: 'Active',
      })
      .select()
      .single();
    if (e4) throw new Error(`Global insert failed: ${e4.message}`);

    // ── 3. Insert activation keys ──────────────────────────────────────────
    const now = new Date();
    const oneYear = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

    await supabaseAdmin.from('activation_keys').insert([
      {
        school_id: schoolOakridge.id,
        key: 'LMS-EDU-CABE-BETA',
        status: 'Active',
        duration_days: 365,
        device_fingerprint: '8f1a2b3c4d5e6f...',
        device_model: 'MacBook Pro M2',
        device_os: 'macOS 14.1',
        activated_at: now.toISOString(),
        expires_at: oneYear.toISOString(),
        last_known_monotonic_time: now.toISOString(),
      },
      {
        school_id: schoolDelhi.id,
        key: 'LMS-Suggested-HFD839D',
        status: 'Active',
        duration_days: 365,
        device_fingerprint: '1a2b3c4d5e6f7g...',
        device_model: 'iPad Air Gen 5',
        device_os: 'iPadOS 17.0',
        activated_at: now.toISOString(),
        expires_at: oneYear.toISOString(),
        last_known_monotonic_time: now.toISOString(),
      },
      {
        school_id: schoolHeritage.id,
        key: 'LMS-Suggested-K3928DJ',
        status: 'Revoked',
        duration_days: 365,
        device_fingerprint: 'z9y8x7w6v5u4t3...',
        device_model: 'Precision Workstation',
        device_os: 'Ubuntu 22.04 LTS',
        activated_at: now.toISOString(),
        expires_at: oneYear.toISOString(),
        last_known_monotonic_time: now.toISOString(),
      },
    ]);

    // ── 4. Insert payments ─────────────────────────────────────────────────
    await supabaseAdmin.from('payments').insert([
      {
        school_id: schoolOakridge.id,
        amount: 425000,
        keys_count: 1500,
        bank_name: 'Axis Bank Ltd.',
        transaction_id: 'AXIS009428113',
        payment_date: new Date('2023-10-24T10:45:00Z').toISOString(),
        status: 'Pending Approval',
      },
      {
        school_id: schoolDelhi.id,
        amount: 84200,
        keys_count: 300,
        bank_name: 'HDFC Bank Ltd.',
        transaction_id: 'HDFC00122934',
        payment_date: new Date('2023-10-24T09:12:00Z').toISOString(),
        status: 'Pending Approval',
      },
      {
        school_id: schoolHeritage.id,
        amount: 112000,
        keys_count: 400,
        bank_name: 'ICICI Bank Ltd.',
        transaction_id: 'ICIC99423851',
        payment_date: new Date('2023-10-23T16:30:00Z').toISOString(),
        status: 'Pending Approval',
      },
      {
        school_id: schoolGlobal.id,
        amount: 55000,
        keys_count: 200,
        bank_name: 'State Bank of India',
        transaction_id: 'SBI88347102',
        payment_date: new Date('2023-10-23T14:15:00Z').toISOString(),
        status: 'Pending Approval',
      },
    ]);

    return NextResponse.json({
      success: true,
      message: 'Supabase database successfully seeded with premium schools, UTR bank slips, and monitor device keys!',
    });
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    // V-04: detail stays in server logs only; client gets a generic message.
    console.error('Seeding Error:', errMsg, err);
    return NextResponse.json(
      { success: false, error: 'Database seeding failed.' },
      { status: 500 }
    );
  }
}
