import React from 'react';
import { notFound } from 'next/navigation';
import { getAdminSession } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabase';
import EditVendorClient from './EditVendorClient';

export const revalidate = 0;
export const dynamic = 'force-dynamic';

interface PageProps {
  params: any;
}

async function getVendor(id: string) {
  const { data, error } = await supabaseAdmin
    .from('vendors')
    .select('*')
    .eq('vendor_id', id)
    .single();

  if (error || !data) return null;

  return data;
}

export default async function EditVendorPage({
  params,
}: PageProps) {
  const session = await getAdminSession();

  if (!session) return null;

  const resolvedParams = await params;
  const id = resolvedParams?.id;

  if (!id) return notFound();

  const vendor = await getVendor(id);

  if (!vendor) return notFound();

  return (
    <EditVendorClient
      vendor={{
        dbId: vendor.vendor_id,

        vendorName: vendor.vendor_name,
        vendorType: vendor.vendor_type,
        businessCategory: vendor.business_category,
        status: vendor.status,

        description: vendor.description || '',

        contactPersonName: vendor.contact_person_name || '',
        designation: vendor.designation || '',
        mobileNumber: vendor.mobile_number || '',
        alternateMobile: vendor.alternate_mobile || '',
        emailAddress: vendor.email_address || '',
        website: vendor.website || '',

        addressLine1: vendor.address_line_1 || '',
        addressLine2: vendor.address_line_2 || '',
        city: vendor.city || '',
        district: vendor.district || '',
        state: vendor.state || '',
        country: vendor.country || '',
        pincode: vendor.pincode || '',

        gstNumber: vendor.gst_number || '',
        panNumber: vendor.pan_number || '',
        businessRegistrationNumber:
          vendor.business_registration_number || '',
        msmeRegistration:
          vendor.msme_registration || '',

        gstCertificateName:
          vendor.gst_certificate_name || '',
        panCardName:
          vendor.pan_card_name || '',
      }}
    />
  );
}