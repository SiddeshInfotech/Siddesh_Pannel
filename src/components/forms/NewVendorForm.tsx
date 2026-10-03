'use client';

import React, { useState, useTransition } from 'react';
import { usePanelRouter } from '@/lib/usePanelPath';
import { 
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  MapPin, 
  FileText, 
  ChevronLeft,
  ChevronRight,
  Check,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Phone,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Mail,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Globe,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  PlusCircle,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
  Briefcase
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import { createVendor } from '@/app/[panel]/vendors/new/actions';
import { updateVendorAction, type VendorEditData } from '@/app/[panel]/accounts/actions';
import CustomSelect from '@/components/CustomSelect';
import FormHeader, { type FormStepDef } from './FormHeader';
import { MAHARASHTRA_DISTRICTS, MAHARASHTRA_STATE } from '@/lib/constants';

type FormStep = 'basic' | 'contact' | 'tax';

export interface NewVendorFormProps {
  /** Set when shown in a pop-up: Cancel (also Esc / a click outside) closes it; save via Register Vendor. */
  onClose?: () => void;
  /** Called after a successful save in the pop-up (e.g. close it and refresh the list). */
  onSaved?: () => void;
  /** Edit mode: pre-fills the form and saves with updateVendorAction. */
  vendor?: VendorEditData;
}

const STEPS: FormStepDef<FormStep>[] = [
  { id: 'basic', label: 'Basic Info' },
  { id: 'contact', label: 'Contact Info' },
  { id: 'tax', label: 'Legal Info' },
];

export default function NewVendorForm({ onClose, onSaved, vendor }: NewVendorFormProps = {}) {
  const inModal = !!onClose;
  const { toast } = useToast();
  const router = usePanelRouter();
  const [isPending, startTransition] = useTransition();
  const [activeStep, setActiveStep] = useState<FormStep>('basic');

  // Form states
  // 1. Basic Vendor Information
  const [vendorName, setVendorName] = useState(vendor?.vendorName ?? '');
  const [vendorType, setVendorType] = useState(vendor?.vendorType ?? '');
  const [businessCategory, setBusinessCategory] = useState(vendor?.businessCategory ?? '');
  const [status, setStatus] = useState<'Active' | 'Inactive'>(vendor?.status ?? 'Active');
  const [description, setDescription] = useState(vendor?.description ?? '');

  // 2. Contact Information
  const [contactPersonName, setContactPersonName] = useState(vendor?.contactPersonName ?? '');
  const [designation, setDesignation] = useState(vendor?.designation ?? '');
  const [mobileNumber, setMobileNumber] = useState(vendor?.mobileNumber ?? '');
  const [alternateMobile, setAlternateMobile] = useState(vendor?.alternateMobile ?? '');
  const [emailAddress, setEmailAddress] = useState(vendor?.emailAddress ?? '');
  const [website, setWebsite] = useState(vendor?.website ?? '');

  // 3. Business Address
  const [addressLine1, setAddressLine1] = useState(vendor?.addressLine1 ?? '');
  const [addressLine2, setAddressLine2] = useState(vendor?.addressLine2 ?? '');
  const [city, setCity] = useState(vendor?.city ?? '');
  const [district, setDistrict] = useState(vendor?.district ?? '');
  const [state, setState] = useState(vendor?.state || 'Maharashtra');
  const [country, setCountry] = useState(vendor?.country || 'India');
  const [pincode, setPincode] = useState(vendor?.pincode ?? '');

  // 4. Tax & Legal Info
  const [gstNumber, setGstNumber] = useState(vendor?.gstNumber ?? '');
  const [panNumber, setPanNumber] = useState(vendor?.panNumber ?? '');
  const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState(vendor?.businessRegistrationNumber ?? '');
  const [msmeRegistration, setMsmeRegistration] = useState(vendor?.msmeRegistration ?? '');

  // File Upload states (Base64)
  const [gstCertificate, setGstCertificate] = useState<{ name: string; data: string } | null>(
    vendor?.gstCertificateName ? { name: vendor.gstCertificateName, data: '' } : null
  );
  const [panCard, setPanCard] = useState<{ name: string; data: string } | null>(
    vendor?.panCardName ? { name: vendor.panCardName, data: '' } : null
  );

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'gst' | 'pan') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast('File size must be under 5MB.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64String = reader.result as string;
      if (type === 'gst') {
        setGstCertificate({ name: file.name, data: base64String });
      } else {
        setPanCard({ name: file.name, data: base64String });
      }
      toast(`${file.name} uploaded successfully!`, 'success');
    };
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    // Validations
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
      toast('Please fill out all required Contact fields (Name, Mobile, Email).', 'error');
      setActiveStep('contact');
      return;
    }

    if (!addressLine1 || !city || !state || !country || !pincode) {
      toast('Please complete all Address fields.', 'error');
      setActiveStep('contact');
      return;
    }

    if (vendor) {
      startTransition(async () => {
        const res = await updateVendorAction(vendor.dbId, {
          vendorName, vendorType, businessCategory, status, description,
          contactPersonName, designation, mobileNumber, alternateMobile, emailAddress, website,
          addressLine1, addressLine2, city, district, state, country, pincode,
          gstNumber, panNumber, businessRegistrationNumber, msmeRegistration,
          gstCertificateName: gstCertificate?.name || '',
          panCardName: panCard?.name || '',
        });
        if (!res.ok) {
          toast(res.error || 'An error occurred', 'error');
          return;
        }
        toast(`Vendor "${vendorName}" updated.`, 'success');
        onSaved?.();
      });
      return;
    }

    startTransition(async () => {
      const res = await createVendor({
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
        gstCertificateName: gstCertificate?.name,
        gstCertificateData: gstCertificate?.data,
        panCardName: panCard?.name,
        panCardData: panCard?.data
      });

      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }

      toast(`Vendor "${vendorName}" successfully registered!`, 'success');
      if (onSaved) { onSaved(); return; }
      setTimeout(() => {
        router.push('/');
      }, 1500);
    });
  };

  return (
    <div className={inModal ? 'space-y-2' : 'space-y-2.5 max-w-6xl mx-auto'}>
      {!inModal && <div className="h-10"></div>}

      <FormHeader
        title={vendor ? 'Edit Vendor' : 'Add New Vendor'}
        steps={STEPS}
        activeStep={activeStep}
        onStepChange={setActiveStep}
        inModal={inModal}
        onClose={onClose}
        cancelHref="/"
        backHref="/"
        backLabel="Back to Dashboard"
      />

      {/* Grid Content */}
      <div>
        {/* Wizard Form Panels */}
        <div>
          <div className="pt-2">
            {activeStep === 'basic' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-5">
                  {/* Vendor Name */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Vendor Name <span className="text-rose-500">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. Acme Bookstore Ltd." 
                      value={vendorName} 
                      onChange={e => setVendorName(e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                    />
                  </div>

                  {/* Status */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 font-bold">Status <span className="text-rose-500">*</span></label>
                    <CustomSelect size="sm" 
                      value={status}
                      onChange={(val: any /* eslint-disable-line @typescript-eslint/no-explicit-any */) => setStatus(val)}
                      options={[
                        { label: 'Active', value: 'Active' },
                        { label: 'Inactive', value: 'Inactive' }
                      ]}
                      placeholder="Select Status"
                    />
                  </div>

                  {/* Vendor Type */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Vendor Type <span className="text-rose-500">*</span></label>
                    <CustomSelect size="sm" 
                      value={vendorType}
                      onChange={setVendorType}
                      options={[
                        { label: 'Education', value: 'Education' },
                        { label: 'Online/Offline School', value: 'Online/Offline School' },
                        { label: 'Other', value: 'Other' }
                      ]}
                      placeholder="Select Vendor Type"
                    />
                  </div>

                  {/* Business Category */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Business Category <span className="text-rose-500">*</span></label>
                    <CustomSelect size="sm" 
                      value={businessCategory}
                      onChange={setBusinessCategory}
                      options={[
                        { label: 'AI Lab', value: 'AI Lab' },
                        { label: 'Software', value: 'Software' },
                        { label: 'Electronics', value: 'Electronics' },
                        { label: 'Other', value: 'Other' }
                      ]}
                      placeholder="Select Business Category"
                    />
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Description</label>
                  <textarea 
                    rows={4}
                    placeholder="Brief description of the vendor business, services or products..."
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white resize-none"
                  />
                </div>

                <div className="flex justify-end pt-4">
                  <button
                    onClick={() => setActiveStep('contact')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white rounded-xl cursor-pointer transition-all"
                  >
                    Next: Contact Details
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {activeStep === 'contact' && (
              <div className="space-y-6">
                <div className="pb-4">
                  <h4 className="text-sm font-bold text-accent-purple mb-4 w-fit px-3.5 py-2 rounded-[14px] bg-[var(--surface-hover)]">Contact Information</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-5">
                    {/* Contact Person Name */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">Contact Person Name <span className="text-rose-500">*</span></label>
                      <input 
                        type="text" 
                        placeholder="e.g. John Doe" 
                        value={contactPersonName} 
                        onChange={e => setContactPersonName(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                      />
                    </div>

                    {/* Designation */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">Designation</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Sales Manager" 
                        value={designation} 
                        onChange={e => setDesignation(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                      />
                    </div>

                    {/* Mobile Number */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 font-bold">Mobile Number <span className="text-rose-500">*</span></label>
                      <input 
                        type="text" 
                        placeholder="e.g. 9876543210" 
                        value={mobileNumber} 
                        onChange={e => setMobileNumber(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                      />
                    </div>

                    {/* Alternate Mobile */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">Alternate Mobile</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 9876543211" 
                        value={alternateMobile} 
                        onChange={e => setAlternateMobile(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                      />
                    </div>

                    {/* Email Address */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 font-bold">Email Address <span className="text-rose-500">*</span></label>
                      <input 
                        type="email" 
                        placeholder="e.g. contact@acme.com" 
                        value={emailAddress} 
                        onChange={e => setEmailAddress(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                      />
                    </div>

                    {/* Website */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300">Website</label>
                      <input 
                        type="url" 
                        placeholder="e.g. https://acme.com" 
                        value={website} 
                        onChange={e => setWebsite(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-accent-blue mb-4 w-fit px-3.5 py-2 rounded-[14px] bg-[var(--surface-hover)]">Business Address</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-5">
                    {/* Address Line 1 & 2 — one row, half width each */}
                    <div className="md:col-span-2 lg:col-span-3 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5">
                      {/* Address Line 1 */}
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-300 font-bold">Address Line 1 <span className="text-rose-500">*</span></label>
                        <input 
                          type="text" 
                          placeholder="Street Name, Building, Suite" 
                          value={addressLine1} 
                          onChange={e => setAddressLine1(e.target.value)}
                          className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                        />
                      </div>

                      {/* Address Line 2 */}
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-zinc-300">Address Line 2</label>
                        <input 
                          type="text" 
                          placeholder="Locality, Landmark" 
                          value={addressLine2} 
                          onChange={e => setAddressLine2(e.target.value)}
                          className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                        />
                      </div>
                    </div>

                    {/* City */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 font-bold">City <span className="text-rose-500">*</span></label>
                      <CustomSelect size="sm" 
                        value={city}
                        onChange={setCity}
                        options={MAHARASHTRA_DISTRICTS}
                        placeholder="Select City"
                      />
                    </div>

                    {/* District */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 font-bold">District</label>
                      <CustomSelect size="sm" 
                        value={district}
                        onChange={setDistrict}
                        options={MAHARASHTRA_DISTRICTS}
                        placeholder="Select District"
                      />
                    </div>

                    {/* State */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 font-bold">State <span className="text-rose-500">*</span></label>
                      <CustomSelect size="sm" 
                        value={state}
                        onChange={setState}
                        options={MAHARASHTRA_STATE}
                        placeholder="Select State"
                      />
                    </div>

                    {/* Country */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 font-bold">Country <span className="text-rose-500">*</span></label>
                      <input 
                        type="text" 
                        placeholder="Country" 
                        value={country} 
                        onChange={e => setCountry(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                      />
                    </div>

                    {/* Pincode */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 font-bold">Pincode / Zip <span className="text-rose-500">*</span></label>
                      <input 
                        type="text" 
                        placeholder="6-digit ZIP code" 
                        value={pincode} 
                        onChange={e => setPincode(e.target.value)}
                        className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                      />
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-4">
                  <button
                    onClick={() => setActiveStep('basic')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl cursor-pointer transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button
                    onClick={() => setActiveStep('tax')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white rounded-xl cursor-pointer transition-all"
                  >
                    Next: Tax & Legal
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {activeStep === 'tax' && (
              <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-5">
                  {/* GST Number */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">GST Number</label>
                    <input 
                      type="text" 
                      placeholder="15-digit GSTIN" 
                      value={gstNumber} 
                      onChange={e => setGstNumber(e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                    />
                  </div>

                  {/* PAN Number */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">PAN Number</label>
                    <input 
                      type="text" 
                      placeholder="10-digit PAN" 
                      value={panNumber} 
                      onChange={e => setPanNumber(e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                    />
                  </div>

                  {/* Business Registration Number */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Business Registration Number</label>
                    <input 
                      type="text" 
                      placeholder="CIN or Reg Number" 
                      value={businessRegistrationNumber} 
                      onChange={e => setBusinessRegistrationNumber(e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                    />
                  </div>

                  {/* MSME Registration */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">MSME Registration</label>
                    <input 
                      type="text" 
                      placeholder="UDYAM Registration Number" 
                      value={msmeRegistration} 
                      onChange={e => setMsmeRegistration(e.target.value)}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 text-xs rounded-[14px] focus:border-accent-violet focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)] outline-none transition-all text-white"
                    />
                  </div>
                </div>

                {/* Certificate uploads — kept two per row */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-5">
                  {/* GST Certificate Upload */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">GST Certificate (PDF/Image)</label>
                    <div className="relative flex items-center justify-center upload-dashed rounded-xl p-4 bg-white/0 hover:bg-white/5 transition-all">
                      <input 
                        type="file" 
                        accept="image/*,application/pdf"
                        onChange={e => handleFileUpload(e, 'gst')}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <div className="text-center">
                        <FileText className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
                        <p className="text-[10px] text-zinc-400">{gstCertificate ? gstCertificate.name : 'Upload file (Max 5MB)'}</p>
                      </div>
                    </div>
                  </div>

                  {/* PAN Card Upload */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">PAN Card (PDF/Image)</label>
                    <div className="relative flex items-center justify-center upload-dashed rounded-xl p-4 bg-white/0 hover:bg-white/5 transition-all">
                      <input 
                        type="file" 
                        accept="image/*,application/pdf"
                        onChange={e => handleFileUpload(e, 'pan')}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <div className="text-center">
                        <FileText className="w-8 h-8 text-zinc-500 mx-auto mb-2" />
                        <p className="text-[10px] text-zinc-400">{panCard ? panCard.name : 'Upload file (Max 5MB)'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-between pt-6 border-t border-white/5">
                  <button
                    onClick={() => setActiveStep('contact')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl cursor-pointer transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>

                  <button
                    onClick={handleSave}
                    disabled={isPending}
                    className="flex items-center gap-1.5 px-6 py-2.5 bg-[var(--surface-hover)] hover:brightness-95 border border-[var(--card-border)] text-xs font-semibold text-[var(--foreground)] rounded-xl transition-all active:scale-95 cursor-pointer disabled:opacity-55"
                  >
                    {isPending ? 'Saving...' : vendor ? 'Save Changes' : 'Register Vendor'}
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
