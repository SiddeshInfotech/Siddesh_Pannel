'use server';

import { supabaseAdmin } from '@/lib/supabase';
import { revalidatePath } from 'next/cache';
import { getAdminSession } from '@/lib/auth';
import { sanitize } from '@/lib/sanitize';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { ActionResult, fail, ok } from '@/lib/actionResult';
import fs from 'fs';
import path from 'path';

// Define Zod validation schema for vendor fields
const CreateVendorSchema = z.object({
  vendorName: z.string().trim().min(1, 'Vendor Name is required.').max(150, 'Vendor Name is too long.'),
  vendorType: z.string().trim().min(1, 'Vendor Type is required.'),
  businessCategory: z.string().trim().min(1, 'Business Category is required.'),
  status: z.enum(['Active', 'Inactive'], { message: 'Status must be Active or Inactive.' }),
  description: z.string().trim().max(500, 'Description is too long.').optional(),
  
  contactPersonName: z.string().trim().min(1, 'Contact Person Name is required.').max(100, 'Contact Person Name is too long.'),
  designation: z.string().trim().max(100, 'Designation is too long.').optional(),
  mobileNumber: z.string().trim().min(1, 'Mobile Number is required.').max(15, 'Mobile Number is too long.'),
  alternateMobile: z.string().trim().max(15, 'Alternate Mobile is too long.').optional(),
  emailAddress: z.string().trim().email('Enter a valid Email Address.').max(254),
  website: z.string().trim().url('Enter a valid Website URL.').or(z.literal('')).optional(),
  
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

function generateVendorId(): string {
  const random = Math.floor(1000 + Math.random() * 9000);
  return `VND-${new Date().getFullYear()}-${random}`;
}

function generateVendorCode(): string {
  const random = Math.floor(100 + Math.random() * 900);
  return `VND-CODE-${random}`;
}

export async function createVendor(formData: any): Promise<ActionResult<string>> {
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
  if (!/^\+?[0-9]{10,15}$/.test(cleanPhone)) {
    return fail('Enter a valid Mobile Number (10–15 digits).');
  }

  const vendorId = generateVendorId();
  const vendorCode = generateVendorCode();
  const dateAdded = new Date().toISOString();

  // Create structured payload
  const vendorPayload = {
    vendor_id: vendorId,
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

  // Try saving to Supabase vendors table
  try {
    const { data: newVendor, error } = await supabaseAdmin
      .from('vendors')
      .insert(vendorPayload)
      .select('vendor_id')
      .single();

    if (!error) {
      logger.info({ event: 'VENDOR_CREATED_DB', vendorId: newVendor.vendor_id, adminEmail: session.email });
      revalidatePath('/vendors');
      return ok(newVendor.vendor_id as string);
    }
    
    // Log error and fall back to local file if table not found
    logger.warn({ event: 'CREATE_VENDOR_DB_ERROR_FALLBACK', code: error.code, message: error.message });
  } catch (err) {
    logger.error({ event: 'CREATE_VENDOR_DB_CRITICAL_FALLBACK' }, err);
  }

  // Fallback: Save to src/lib/vendors.json
  try {
    const filePath = path.join(process.cwd(), 'src/lib/vendors.json');
    let vendorsList: any[] = [];
    
    if (fs.existsSync(filePath)) {
      const fileData = fs.readFileSync(filePath, 'utf8');
      vendorsList = JSON.parse(fileData);
    }
    
    vendorsList.push(vendorPayload);
    fs.writeFileSync(filePath, JSON.stringify(vendorsList, null, 2), 'utf8');
    
    logger.info({ event: 'VENDOR_CREATED_LOCAL', vendorId, adminEmail: session.email });
    
    // Also save uploaded files locally to public/uploads/ if supplied
    const uploadDir = path.join(process.cwd(), 'public/uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    if (validData.gstCertificateData && validData.gstCertificateName) {
      const base64Data = validData.gstCertificateData.replace(/^data:.+;base64,/, "");
      fs.writeFileSync(path.join(uploadDir, `${vendorId}_gst_${validData.gstCertificateName}`), base64Data, 'base64');
    }
    
    if (validData.panCardData && validData.panCardName) {
      const base64Data = validData.panCardData.replace(/^data:.+;base64,/, "");
      fs.writeFileSync(path.join(uploadDir, `${vendorId}_pan_${validData.panCardName}`), base64Data, 'base64');
    }

    revalidatePath('/vendors');
    return ok(vendorId);
  } catch (err) {
    logger.error({ event: 'CREATE_VENDOR_LOCAL_CRITICAL_ERROR' }, err);
    return fail('Failed to register vendor profile.');
  }
}
