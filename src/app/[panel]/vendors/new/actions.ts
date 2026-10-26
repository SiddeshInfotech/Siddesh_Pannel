'use server';

import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { sanitize } from '@/lib/sanitize';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { ActionResult, fail, ok } from '@/lib/actionResult';
import { adminDb } from '@/lib/panelTables';
import { invalidateEntityLists } from '@/lib/entityLists';

// Define Zod validation schema for vendor fields
const CreateVendorSchema = z.object({
  vendorName: z.string().trim().min(1, 'Vendor Name is required.').max(150, 'Vendor Name is too long.'),
  vendorType: z.string().trim().min(1, 'Vendor Type is required.'),
  businessCategory: z.string().trim().min(1, 'Business Category is required.'),
  status: z.enum(['Active', 'Inactive'], { message: 'Status must be Active or Inactive.' }),
  description: z.string().trim().max(500, 'Description is too long.').optional(),
  
  contactPersonName: z.string().trim().min(1, 'Contact Person Name is required.').max(100, 'Contact Person Name is too long.'),
  designation: z.string().trim().max(100, 'Designation is too long.').optional(),
  mobileNumber: z.string().trim().regex(/^[0-9]{10}$/, 'Mobile Number must be exactly 10 digits.'),
  alternateMobile: z.string().trim().regex(/^[0-9]{10}$/, 'Alternate Mobile must be exactly 10 digits.').or(z.literal('')).optional(),
  emailAddress: z.string().trim().regex(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/, 'Enter a valid Email Address.'),
  website: z.string().trim().regex(/^(https?:\/\/)?([\w\d\-]+\.)+\w{2,}(\/.*)?$/, 'Enter a valid Website URL.').or(z.literal('')).optional(),
  
  addressLine1: z.string().trim().min(1, 'Address Line 1 is required.').max(200, 'Address Line 1 is too long.'),
  addressLine2: z.string().trim().max(200, 'Address Line 2 is too long.').optional(),
  city: z.string().trim().min(1, 'City is required.').max(100, 'City is too long.'),
  district: z.string().trim().max(100, 'District is too long.').optional(),
  state: z.string().trim().min(1, 'State is required.').max(100, 'State is too long.'),
  country: z.string().trim().min(1, 'Country is required.').max(100, 'Country is too long.'),
  pincode: z.string().trim().regex(/^[0-9]{5,10}$/, 'Enter a valid PIN / Zip code.'),
  
  gstNumber: z.string().trim().max(20, 'GST Number is too long.').optional(),
  panNumber: z.string().trim().max(20, 'PAN Number is too long.').optional(),
  businessRegistrationNumber: z.string().trim().max(50, 'Registration Number is too long.').optional(),
  msmeRegistration: z.string().trim().max(50, 'MSME Number is too long.').optional(),
  
  gstCertificateName: z.string().optional(),
  gstCertificateData: z.string().optional(), // Base64 representation of file
  panCardName: z.string().optional(),
  panCardData: z.string().optional() // Base64 representation of file
});

function generateVendorCode(): string {
  const random = Math.floor(100 + Math.random() * 900);
  return `VND-CODE-${random}`;
}

export async function createVendor(formData: any /* eslint-disable-line @typescript-eslint/no-explicit-any */): Promise<ActionResult<string>> {
  const session = await getAdminSession();
  if (!session) return fail('Unauthorized. Please sign in again.');

  const parsed = CreateVendorSchema.safeParse(formData);
  if (!parsed.success) {
    logger.warn({ event: 'CREATE_VENDOR_VALIDATION_FAILED', errors: parsed.error.flatten() });
    return fail(parsed.error.issues[0]?.message ?? 'Please check the form and try again.');
  }
  
  const validData = parsed.data;

  // Additional phone number sanitization and validation
  const cleanPhone = validData.mobileNumber.replace(/[\s\-()]/g, '');
  if (!/^[0-9]{10}$/.test(cleanPhone)) {
    return fail('Enter a valid Mobile Number (exactly 10 digits).');
  }

  // vendor_id (VND-YYYY-NNNN) is assigned by the database (standard-ids.sql) — never here.
  const vendorCode = generateVendorCode();
  const dateAdded = new Date().toISOString();

  // Create structured payload
  const vendorPayload = {
    vendor_code: vendorCode,
    vendor_name: sanitize(validData.vendorName),
    vendor_type: sanitize(validData.vendorType),
    business_category: sanitize(validData.businessCategory),
    status: validData.status,
    description: sanitize(validData.description || ''),
    
    contact_person_name: sanitize(validData.contactPersonName),
    designation: sanitize(validData.designation || ''),
    mobile_number: sanitize(cleanPhone),
    alternate_mobile: sanitize(validData.alternateMobile || ''),
    email_address: sanitize(validData.emailAddress),
    website: sanitize(validData.website || ''),
    
    address_line_1: sanitize(validData.addressLine1),
    address_line_2: sanitize(validData.addressLine2 || ''),
    city: sanitize(validData.city),
    district: sanitize(validData.district || ''),
    state: sanitize(validData.state),
    country: sanitize(validData.country),
    pincode: sanitize(validData.pincode),
    
    gst_number: sanitize(validData.gstNumber || ''),
    pan_number: sanitize(validData.panNumber || ''),
    business_registration_number: sanitize(validData.businessRegistrationNumber || ''),
    msme_registration: sanitize(validData.msmeRegistration || ''),
    
    gst_certificate_name: sanitize(validData.gstCertificateName || ''),
    pan_card_name: sanitize(validData.panCardName || ''),
    
    date_added: dateAdded,
    created_at: dateAdded,
    updated_at: dateAdded
  };

  try {
    const { data: newVendor, error } = await (await adminDb())
      .from('vendors')
      .insert(vendorPayload)
      .select('vendor_id')
      .single();

    if (error) {
      logger.error({ event: 'CREATE_VENDOR_DB_ERROR', code: error.code, message: error.message });
      return fail('Failed to register vendor profile.');
    }

    logger.info({ event: 'VENDOR_CREATED_DB', vendorId: newVendor.vendor_id, adminEmail: session.email });
    revalidatePath('/[panel]/accounts', 'page');
    invalidateEntityLists((await adminDb()).panel); // picker lists (src/lib/entityLists.ts)
    return ok(newVendor.vendor_id as string);
  } catch (err) {
    logger.error({ event: 'CREATE_VENDOR_DB_CRITICAL' }, err);
    return fail('Failed to register vendor profile.');
  }
}
