'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  User,
  Building,
  FileText,
  ChevronLeft,
  ChevronRight,
  Check,
} from 'lucide-react';
import Link from 'next/link';

import GlassCard from '@/components/GlassCard';
import CustomSelect from '@/components/CustomSelect';
import { useToast } from '@/components/Toast';
import { updateVendorAction } from '@/app/data/actions';

type FormStep = 'basic' | 'contact' | 'tax';

interface EditVendorClientProps {
  vendor: {
    dbId: string;

    vendorName: string;
    vendorType: string;
    businessCategory: string;
    status: 'Active' | 'Inactive';
    description: string;

    contactPersonName: string;
    designation: string;
    mobileNumber: string;
    alternateMobile: string;
    emailAddress: string;
    website: string;

    addressLine1: string;
    addressLine2: string;
    city: string;
    district: string;
    state: string;
    country: string;
    pincode: string;

    gstNumber: string;
    panNumber: string;
    businessRegistrationNumber: string;
    msmeRegistration: string;

    gstCertificateName: string;
    panCardName: string;
  };
}

export default function EditVendorClient({
  vendor,
}: EditVendorClientProps) {
  const { toast } = useToast();
  const router = useRouter();

  const [isPending, startTransition] = useTransition();
  const [activeStep, setActiveStep] = useState<FormStep>('basic');

  // Basic
  const [vendorName, setVendorName] = useState(vendor.vendorName);
  const [vendorType, setVendorType] = useState(vendor.vendorType);
  const [businessCategory, setBusinessCategory] = useState(vendor.businessCategory);
  const [status, setStatus] = useState<'Active' | 'Inactive'>(vendor.status);
  const [description, setDescription] = useState(vendor.description);

  // Contact
  const [contactPersonName, setContactPersonName] = useState(vendor.contactPersonName);
  const [designation, setDesignation] = useState(vendor.designation);
  const [mobileNumber, setMobileNumber] = useState(vendor.mobileNumber);
  const [alternateMobile, setAlternateMobile] = useState(vendor.alternateMobile);
  const [emailAddress, setEmailAddress] = useState(vendor.emailAddress);
  const [website, setWebsite] = useState(vendor.website);

  // Address
  const [addressLine1, setAddressLine1] = useState(vendor.addressLine1);
  const [addressLine2, setAddressLine2] = useState(vendor.addressLine2);
  const [city, setCity] = useState(vendor.city);
  const [district, setDistrict] = useState(vendor.district);
  const [state, setState] = useState(vendor.state);
  const [country, setCountry] = useState(vendor.country);
  const [pincode, setPincode] = useState(vendor.pincode);

  // Tax
  const [gstNumber, setGstNumber] = useState(vendor.gstNumber);
  const [panNumber, setPanNumber] = useState(vendor.panNumber);
  const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState(vendor.businessRegistrationNumber);
  const [msmeRegistration, setMsmeRegistration] = useState(vendor.msmeRegistration);

  const [gstCertificate, setGstCertificate] = useState<{
    name: string;
    data: string;
  } | null>(
    vendor.gstCertificateName
      ? {
          name: vendor.gstCertificateName,
          data: '',
        }
      : null
  );

  const [panCard, setPanCard] = useState<{
    name: string;
    data: string;
  } | null>(
    vendor.panCardName
      ? {
          name: vendor.panCardName,
          data: '',
        }
      : null
  );

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'gst' | 'pan'
  ) => {
    const file = e.target.files?.[0];

    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast('File size must be under 5MB.', 'error');
      return;
    }

    const reader = new FileReader();

    reader.onloadend = () => {
      const base64 = reader.result as string;

      if (type === 'gst') {
        setGstCertificate({
          name: file.name,
          data: base64,
        });
      } else {
        setPanCard({
          name: file.name,
          data: base64,
        });
      }

      toast(`${file.name} uploaded successfully!`, 'success');
    };

    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!vendorName) {
      toast('Please enter the Vendor Name.', 'error');
      setActiveStep('basic');
      return;
    }

    if (!vendorType) {
      toast('Please select a Vendor Type.', 'error');
      setActiveStep('basic');
      return;
    }

    if (!businessCategory) {
      toast('Please select a Business Category.', 'error');
      setActiveStep('basic');
      return;
    }

    if (!contactPersonName || !mobileNumber || !emailAddress) {
      toast('Please fill out all required Contact fields.', 'error');
      setActiveStep('contact');
      return;
    }

    if (!addressLine1 || !city || !state || !country || !pincode) {
      toast('Please complete all Address fields.', 'error');
      setActiveStep('contact');
      return;
    }

    startTransition(async () => {
      const res = await updateVendorAction(vendor.dbId, {
        vendorName,
        vendorType,
        businessCategory,
        status,

        description,

        contactPersonName,
        designation,
        mobileNumber,
        alternateMobile,
        emailAddress,
        website,

        addressLine1,
        addressLine2,
        city,
        district,
        state,
        country,
        pincode,

        gstNumber,
        panNumber,
        businessRegistrationNumber,
        msmeRegistration,

        gstCertificateName: gstCertificate?.name || '',
        panCardName: panCard?.name || '',
      });

      if (!res.ok) {
        toast(res.error || 'An error occurred', 'error');
        return;
      }

      toast('Vendor updated successfully!', 'success');

      setTimeout(() => {
        router.push('/data');
      }, 1200);
    });
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="h-10"></div>

      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-4 border-b border-white/5 pb-6">
        <div>
          <div className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 text-xs font-semibold mb-2">
            <Link href="/data" className="flex items-center gap-1">
              <ChevronLeft className="w-3.5 h-3.5" />
              Back to Directory
            </Link>
          </div>

          <h2 className="text-3xl font-extrabold text-white tracking-tight">
            Edit Vendor
          </h2>

          <p className="text-xs text-zinc-400 mt-1">
            Update vendor profile and business information.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/data"
            className="px-5 py-2.5 bg-white/5 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl hover:bg-white/10 transition-all"
          >
            Cancel
          </Link>

          <button
            onClick={handleSave}
            disabled={isPending}
            className="px-5 py-2.5 bg-gradient-to-r from-accent-violet to-accent-blue text-xs font-semibold text-white rounded-xl disabled:opacity-50"
          >
            {isPending ? 'Updating...' : 'Save Changes'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Navigation */}
        <div className="lg:col-span-3 space-y-2.5">
          <button
            onClick={() => setActiveStep('basic')}
            className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left text-xs font-semibold transition-all cursor-pointer ${
              activeStep === 'basic'
                ? 'bg-white/10 text-white border border-white/10'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Building
              className={`w-4 h-4 ${
                activeStep === 'basic' ? 'text-accent-purple' : 'text-zinc-500'
              }`}
            />
            <div>
              <p className="font-bold">Basic Information</p>
              <p className="text-[10px] text-zinc-500">Vendor details</p>
            </div>
          </button>

          <button
            onClick={() => setActiveStep('contact')}
            className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left text-xs font-semibold transition-all cursor-pointer ${
              activeStep === 'contact'
                ? 'bg-white/10 text-white border border-white/10'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <User
              className={`w-4 h-4 ${
                activeStep === 'contact' ? 'text-accent-blue' : 'text-zinc-500'
              }`}
            />
            <div>
              <p className="font-bold">Contact & Address</p>
              <p className="text-[10px] text-zinc-500">Contact information</p>
            </div>
          </button>

          <button
            onClick={() => setActiveStep('tax')}
            className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left text-xs font-semibold transition-all cursor-pointer ${
              activeStep === 'tax'
                ? 'bg-white/10 text-white border border-white/10'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileText
              className={`w-4 h-4 ${
                activeStep === 'tax' ? 'text-emerald-400' : 'text-zinc-500'
              }`}
            />
            <div>
              <p className="font-bold">Tax & Legal</p>
              <p className="text-[10px] text-zinc-500">GST & registrations</p>
            </div>
          </button>
        </div>

        <div className="lg:col-span-9">
          <GlassCard className="p-8">
            {activeStep === 'basic' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white">
                    Basic Vendor Information
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Update the vendor's primary business details.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">
                      Vendor Name<span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={vendorName}
                      onChange={(e) => setVendorName(e.target.value)}
                      placeholder="Vendor Name"
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-xs focus:border-accent-violet outline-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">
                      Status
                    </label>
                    <CustomSelect
                      value={status}
                      onChange={(v: any) => setStatus(v)}
                      options={[
                        { label: 'Active', value: 'Active' },
                        { label: 'Inactive', value: 'Inactive' },
                      ]}
                      placeholder="Select Status"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">
                      Vendor Type<span className="text-rose-500">*</span>
                    </label>
                    <CustomSelect
                      value={vendorType}
                      onChange={setVendorType}
                      options={[
                        { label: 'Education', value: 'Education' },
                        { label: 'Online/Offline School', value: 'Online/Offline School' },
                        { label: 'Other', value: 'Other' },
                      ]}
                      placeholder="Vendor Type"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">
                      Business Category<span className="text-rose-500">*</span>
                    </label>
                    <CustomSelect
                      value={businessCategory}
                      onChange={setBusinessCategory}
                      options={[
                        { label: 'AI Lab', value: 'AI Lab' },
                        { label: 'Software', value: 'Software' },
                        { label: 'Electronics', value: 'Electronics' },
                        { label: 'Other', value: 'Other' },
                      ]}
                      placeholder="Business Category"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">
                    Description
                  </label>
                  <textarea
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Vendor description..."
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-xs resize-none focus:border-accent-violet outline-none"
                  />
                </div>

                <div className="flex justify-end pt-4">
                  <button
                    onClick={() => setActiveStep('contact')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-xs text-white"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {activeStep === 'contact' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white">
                    Contact & Address Details
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Update vendor contact information and business address.
                  </p>
                </div>

                <div className="border-b border-white/5 pb-6">
                  <h4 className="text-sm font-bold text-accent-blue mb-4">
                    Contact Information
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        Contact Person *
                      </label>
                      <input
                        type="text"
                        value={contactPersonName}
                        onChange={(e) => setContactPersonName(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        Designation
                      </label>
                      <input
                        type="text"
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        Mobile Number *
                      </label>
                      <input
                        type="text"
                        value={mobileNumber}
                        onChange={(e) => setMobileNumber(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        Alternate Mobile
                      </label>
                      <input
                        type="text"
                        value={alternateMobile}
                        onChange={(e) => setAlternateMobile(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        Email *
                      </label>
                      <input
                        type="email"
                        value={emailAddress}
                        onChange={(e) => setEmailAddress(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        Website
                      </label>
                      <input
                        type="url"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-accent-purple mb-4">
                    Business Address
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="md:col-span-2 space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        Address Line 1 *
                      </label>
                      <input
                        type="text"
                        value={addressLine1}
                        onChange={(e) => setAddressLine1(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>

                    <div className="md:col-span-2 space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        Address Line 2
                      </label>
                      <input
                        type="text"
                        value={addressLine2}
                        onChange={(e) => setAddressLine2(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        City *
                      </label>
                      <input
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        District
                      </label>
                      <input
                        value={district}
                        onChange={(e) => setDistrict(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        State *
                      </label>
                      <input
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        Country *
                      </label>
                      <input
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">
                        Pincode *
                      </label>
                      <input
                        value={pincode}
                        onChange={(e) => setPincode(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-4">
                  <button
                    onClick={() => setActiveStep('basic')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs text-zinc-300"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>

                  <button
                    onClick={() => setActiveStep('tax')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs text-white"
                  >
                    Next
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {activeStep === 'tax' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white">
                    Tax & Legal Information
                  </h3>
                  <p className="text-xs text-zinc-400 mt-1">
                    Update taxation and registration details.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">
                      GST Number
                    </label>
                    <input
                      type="text"
                      value={gstNumber}
                      onChange={(e) => setGstNumber(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">
                      PAN Number
                    </label>
                    <input
                      type="text"
                      value={panNumber}
                      onChange={(e) => setPanNumber(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">
                      Business Registration Number
                    </label>
                    <input
                      type="text"
                      value={businessRegistrationNumber}
                      onChange={(e) => setBusinessRegistrationNumber(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">
                      MSME Registration
                    </label>
                    <input
                      type="text"
                      value={msmeRegistration}
                      onChange={(e) => setMsmeRegistration(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-xs text-white outline-none focus:border-accent-violet"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs font-semibold text-zinc-300">
                      GST Certificate
                    </p>
                    <p className="mt-2 text-xs text-zinc-500 break-all">
                      {gstCertificate?.name || 'No file uploaded'}
                    </p>
                    <input
                      type="file"
                      onChange={(e) => handleFileUpload(e, 'gst')}
                      className="mt-4 text-xs"
                      accept="image/*,.pdf"
                    />
                  </div>

                  <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <p className="text-xs font-semibold text-zinc-300">
                      PAN Card
                    </p>
                    <p className="mt-2 text-xs text-zinc-500 break-all">
                      {panCard?.name || 'No file uploaded'}
                    </p>
                    <input
                      type="file"
                      onChange={(e) => handleFileUpload(e, 'pan')}
                      className="mt-4 text-xs"
                      accept="image/*,.pdf"
                    />
                  </div>
                </div>

                <div className="flex justify-between pt-6 border-t border-white/5">
                  <button
                    onClick={() => setActiveStep('contact')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs text-zinc-300"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>

                  <button
                    onClick={handleSave}
                    disabled={isPending}
                    className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-accent-violet to-accent-blue rounded-xl text-xs font-semibold text-white disabled:opacity-50"
                  >
                    {isPending ? 'Updating...' : 'Save Changes'}
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}