'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { 
  User, 
  MapPin, 
  FileText, 
  ChevronLeft,
  ChevronRight,
  Check,
  Building,
  Phone,
  Mail,
  Globe,
  PlusCircle,
  Briefcase
} from 'lucide-react';
import GlassCard from '@/components/GlassCard';
import Link from 'next/link';
import { useToast } from '@/components/Toast';
import { createVendor } from './actions';
import CustomSelect from '@/components/CustomSelect';

type FormStep = 'basic' | 'contact' | 'tax';

export default function NewVendorPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeStep, setActiveStep] = useState<FormStep>('basic');

  // Form states
  // 1. Basic Vendor Information
  const [vendorName, setVendorName] = useState('');
  const [vendorType, setVendorType] = useState('');
  const [businessCategory, setBusinessCategory] = useState('');
  const [status, setStatus] = useState<'Active' | 'Inactive'>('Active');
  const [description, setDescription] = useState('');

  // 2. Contact Information
  const [contactPersonName, setContactPersonName] = useState('');
  const [designation, setDesignation] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [alternateMobile, setAlternateMobile] = useState('');
  const [emailAddress, setEmailAddress] = useState('');
  const [website, setWebsite] = useState('');

  // 3. Business Address
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [state, setState] = useState('');
  const [country, setCountry] = useState('India');
  const [pincode, setPincode] = useState('');

  // 4. Tax & Legal Info
  const [gstNumber, setGstNumber] = useState('');
  const [panNumber, setPanNumber] = useState('');
  const [businessRegistrationNumber, setBusinessRegistrationNumber] = useState('');
  const [msmeRegistration, setMsmeRegistration] = useState('');

  // File Upload states (Base64)
  const [gstCertificate, setGstCertificate] = useState<{ name: string; data: string } | null>(null);
  const [panCard, setPanCard] = useState<{ name: string; data: string } | null>(null);

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
      setTimeout(() => {
        router.push('/');
      }, 1500);
    });
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="h-10"></div>

      {/* Header */}
      <div className="flex justify-between items-center flex-wrap gap-4 border-b border-white/5 dark:border-white/5 light:border-black/10 pb-6">
        <div>
          <div className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 light:text-zinc-500 light:hover:text-black text-xs font-semibold cursor-pointer mb-2">
            <Link href="/" className="flex items-center gap-1">
              <ChevronLeft className="w-3.5 h-3.5" />
              Back to Dashboard
            </Link>
          </div>
          <h2 className="text-3xl font-extrabold text-white light:text-black tracking-tight">Add New Vendor</h2>
          <p className="text-xs text-zinc-400 light:text-zinc-500 mt-1">Register a vendor or supplier into the school procurement system.</p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="px-5 py-2.5 bg-white/5 dark:bg-white/5 light:bg-white border border-white/10 dark:border-white/10 light:border-black/15 text-xs font-semibold text-zinc-300 light:text-black rounded-xl hover:bg-white/10 light:hover:bg-black/5 transition-all cursor-pointer"
          >
            Cancel
          </Link>
          
          <button
            onClick={handleSave}
            disabled={isPending}
            className="px-5 py-2.5 bg-gradient-to-r from-accent-violet to-accent-blue text-xs font-semibold text-white rounded-xl shadow-[0_0_15px_rgba(139,92,246,0.25)] hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] transition-transform active:scale-95 cursor-pointer disabled:opacity-55"
          >
            {isPending ? 'Saving...' : 'Save Vendor Profile'}
          </button>
        </div>
      </div>

      {/* Grid Content */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left wizard Navigation */}
        <div className="lg:col-span-3 space-y-2.5">
          <button
            onClick={() => setActiveStep('basic')}
            className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left text-xs font-semibold transition-all cursor-pointer ${
              activeStep === 'basic' 
                ? 'bg-white/10 text-white shadow-md border border-white/10' 
                : 'text-zinc-400 hover:text-zinc-200 bg-white/0'
            }`}
          >
            <Building className={`w-4 h-4 ${activeStep === 'basic' ? 'text-accent-purple' : 'text-zinc-500'}`} />
            <div>
              <p className="font-bold">Basic Information</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">Vendor details & description</p>
            </div>
          </button>

          <button
            onClick={() => setActiveStep('contact')}
            className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left text-xs font-semibold transition-all cursor-pointer ${
              activeStep === 'contact' 
                ? 'bg-white/10 text-white shadow-md border border-white/10' 
                : 'text-zinc-400 hover:text-zinc-200 bg-white/0'
            }`}
          >
            <User className={`w-4 h-4 ${activeStep === 'contact' ? 'text-accent-blue' : 'text-zinc-500'}`} />
            <div>
              <p className="font-bold">Contact & Address</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">Contacts and address fields</p>
            </div>
          </button>

          <button
            onClick={() => setActiveStep('tax')}
            className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left text-xs font-semibold transition-all cursor-pointer ${
              activeStep === 'tax' 
                ? 'bg-white/10 text-white shadow-md border border-white/10' 
                : 'text-zinc-400 hover:text-zinc-200 bg-white/0'
            }`}
          >
            <FileText className={`w-4 h-4 ${activeStep === 'tax' ? 'text-emerald-400' : 'text-zinc-500'}`} />
            <div>
              <p className="font-bold">Tax & Legal Info</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">Registration & certificates</p>
            </div>
          </button>
        </div>

        {/* Wizard Form Panels */}
        <div className="lg:col-span-9">
          <GlassCard className="p-8">
            {activeStep === 'basic' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white light:text-black">Basic Vendor Information</h3>
                  <p className="text-xs text-zinc-400 light:text-zinc-500 mt-1">Core details required to register a vendor.</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Vendor Name */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Vendor Name <span className="text-rose-500">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. Acme Bookstore Ltd." 
                      value={vendorName} 
                      onChange={e => setVendorName(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                    />
                  </div>

                  {/* Status */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700 font-bold">Status <span className="text-rose-500">*</span></label>
                    <CustomSelect 
                      value={status}
                      onChange={(val: any) => setStatus(val)}
                      options={[
                        { label: 'Active', value: 'Active' },
                        { label: 'Inactive', value: 'Inactive' }
                      ]}
                      placeholder="Select Status"
                    />
                  </div>

                  {/* Vendor Type */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Vendor Type <span className="text-rose-500">*</span></label>
                    <CustomSelect 
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
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Business Category <span className="text-rose-500">*</span></label>
                    <CustomSelect 
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
                  <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Description</label>
                  <textarea 
                    rows={4}
                    placeholder="Brief description of the vendor business, services or products..."
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black resize-none"
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
                <div>
                  <h3 className="text-lg font-bold text-white light:text-black">Contact & Address Details</h3>
                  <p className="text-xs text-zinc-400 light:text-zinc-500 mt-1">Provide information about the vendor's primary contact person and physical location.</p>
                </div>

                <div className="border-b border-white/5 pb-4">
                  <h4 className="text-sm font-bold text-accent-purple mb-4">Contact Information</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Contact Person Name */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Contact Person Name <span className="text-rose-500">*</span></label>
                      <input 
                        type="text" 
                        placeholder="e.g. John Doe" 
                        value={contactPersonName} 
                        onChange={e => setContactPersonName(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                      />
                    </div>

                    {/* Designation */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Designation</label>
                      <input 
                        type="text" 
                        placeholder="e.g. Sales Manager" 
                        value={designation} 
                        onChange={e => setDesignation(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                      />
                    </div>

                    {/* Mobile Number */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700 font-bold">Mobile Number <span className="text-rose-500">*</span></label>
                      <input 
                        type="text" 
                        placeholder="e.g. 9876543210" 
                        value={mobileNumber} 
                        onChange={e => setMobileNumber(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                      />
                    </div>

                    {/* Alternate Mobile */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Alternate Mobile</label>
                      <input 
                        type="text" 
                        placeholder="e.g. 9876543211" 
                        value={alternateMobile} 
                        onChange={e => setAlternateMobile(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                      />
                    </div>

                    {/* Email Address */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700 font-bold">Email Address <span className="text-rose-500">*</span></label>
                      <input 
                        type="email" 
                        placeholder="e.g. contact@acme.com" 
                        value={emailAddress} 
                        onChange={e => setEmailAddress(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                      />
                    </div>

                    {/* Website */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Website</label>
                      <input 
                        type="url" 
                        placeholder="e.g. https://acme.com" 
                        value={website} 
                        onChange={e => setWebsite(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-bold text-accent-blue mb-4">Business Address</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Address Line 1 */}
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700 font-bold">Address Line 1 <span className="text-rose-500">*</span></label>
                      <input 
                        type="text" 
                        placeholder="Street Name, Building, Suite" 
                        value={addressLine1} 
                        onChange={e => setAddressLine1(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                      />
                    </div>

                    {/* Address Line 2 */}
                    <div className="space-y-2 md:col-span-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Address Line 2</label>
                      <input 
                        type="text" 
                        placeholder="Locality, Landmark" 
                        value={addressLine2} 
                        onChange={e => setAddressLine2(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                      />
                    </div>

                    {/* City */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700 font-bold">City <span className="text-rose-500">*</span></label>
                      <input 
                        type="text" 
                        placeholder="City" 
                        value={city} 
                        onChange={e => setCity(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                      />
                    </div>

                    {/* District */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">District</label>
                      <input 
                        type="text" 
                        placeholder="District" 
                        value={district} 
                        onChange={e => setDistrict(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                      />
                    </div>

                    {/* State */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700 font-bold">State <span className="text-rose-500">*</span></label>
                      <input 
                        type="text" 
                        placeholder="State" 
                        value={state} 
                        onChange={e => setState(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                      />
                    </div>

                    {/* Country */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700 font-bold">Country <span className="text-rose-500">*</span></label>
                      <input 
                        type="text" 
                        placeholder="Country" 
                        value={country} 
                        onChange={e => setCountry(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                      />
                    </div>

                    {/* Pincode */}
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700 font-bold">Pincode / Zip <span className="text-rose-500">*</span></label>
                      <input 
                        type="text" 
                        placeholder="6-digit ZIP code" 
                        value={pincode} 
                        onChange={e => setPincode(e.target.value)}
                        className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
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
                <div>
                  <h3 className="text-lg font-bold text-white light:text-black">Tax & Legal Information</h3>
                  <p className="text-xs text-zinc-400 light:text-zinc-500 mt-1">Provide regulatory and tax configurations necessary for procurement invoicing.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* GST Number */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">GST Number</label>
                    <input 
                      type="text" 
                      placeholder="15-digit GSTIN" 
                      value={gstNumber} 
                      onChange={e => setGstNumber(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                    />
                  </div>

                  {/* PAN Number */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">PAN Number</label>
                    <input 
                      type="text" 
                      placeholder="10-digit PAN" 
                      value={panNumber} 
                      onChange={e => setPanNumber(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                    />
                  </div>

                  {/* Business Registration Number */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Business Registration Number</label>
                    <input 
                      type="text" 
                      placeholder="CIN or Reg Number" 
                      value={businessRegistrationNumber} 
                      onChange={e => setBusinessRegistrationNumber(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                    />
                  </div>

                  {/* MSME Registration */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">MSME Registration</label>
                    <input 
                      type="text" 
                      placeholder="UDYAM Registration Number" 
                      value={msmeRegistration} 
                      onChange={e => setMsmeRegistration(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                    />
                  </div>

                  {/* GST Certificate Upload */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">GST Certificate (PDF/Image)</label>
                    <div className="relative flex items-center justify-center border-2 border-dashed border-white/10 hover:border-white/20 rounded-xl p-4 bg-white/0 hover:bg-white/5 transition-all">
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
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">PAN Card (PDF/Image)</label>
                    <div className="relative flex items-center justify-center border-2 border-dashed border-white/10 hover:border-white/20 rounded-xl p-4 bg-white/0 hover:bg-white/5 transition-all">
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
                    className="flex items-center gap-1.5 px-6 py-2.5 bg-gradient-to-r from-accent-violet to-accent-blue text-xs font-semibold text-white rounded-xl shadow-[0_0_15px_rgba(139,92,246,0.25)] hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] transition-transform active:scale-95 cursor-pointer disabled:opacity-55"
                  >
                    {isPending ? 'Saving...' : 'Register Vendor'}
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
