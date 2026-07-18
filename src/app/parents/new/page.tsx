'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { 
  User, 
  MapPin, 
  ChevronLeft,
  ChevronRight,
  Check,
  BookOpen
} from 'lucide-react';
import GlassCard from '@/components/GlassCard';
import Link from 'next/link';
import { useToast } from '@/components/Toast';
import { createParent } from './actions';
import CustomSelect from '@/components/CustomSelect';
import { MAHARASHTRA_DISTRICTS, MAHARASHTRA_STATE } from '@/lib/constants';

type FormStep = 'basic' | 'location';

export default function NewParentPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeStep, setActiveStep] = useState<FormStep>('basic');

  // Form states
  // 1. Basic Parent & Kid Information
  const [parentName, setParentName] = useState('');
  const [kidName, setKidName] = useState('');
  const [email, setEmail] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [status, setStatus] = useState<'Active' | 'Inactive'>('Active');
  const [grade, setGrade] = useState('');

  // 2. Location
  const [city, setCity] = useState('');
  const [state, setState] = useState('Maharashtra');

  const handleSave = () => {
    // Validations
    if (!parentName || !kidName) {
      toast('Please enter both Parent and Kid Names.', 'error');
      setActiveStep('basic');
      return;
    }
    if (!email || !phoneNumber) {
      toast('Please provide valid Contact Details (Email & Phone).', 'error');
      setActiveStep('basic');
      return;
    }
    if (!grade) {
      toast('Please select a Grade/Standard.', 'error');
      setActiveStep('basic');
      return;
    }

    startTransition(async () => {
      const res = await createParent({
        parentName,
        kidName,
        email,
        phoneNumber,
        status,
        grade,
        city,
        state
      });

      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }

      toast(`Parent account for "${parentName}" created successfully!`, 'success');
      setTimeout(() => {
        router.push('/data'); // Redirecting to data page where parents will be listed
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
          <h2 className="text-3xl font-extrabold text-white light:text-black tracking-tight">Add Individual User</h2>
          <p className="text-xs text-zinc-400 light:text-zinc-500 mt-1">Register a parent/individual purchasing a single key for their kid.</p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/data"
            className="px-5 py-2.5 bg-white/5 dark:bg-white/5 light:bg-white border border-white/10 dark:border-white/10 light:border-black/15 text-xs font-semibold text-zinc-300 light:text-black rounded-xl hover:bg-white/10 light:hover:bg-black/5 transition-all cursor-pointer"
          >
            Cancel
          </Link>
          
          <button
            onClick={handleSave}
            disabled={isPending}
            className="px-5 py-2.5 bg-gradient-to-r from-accent-violet to-accent-blue text-xs font-semibold text-white rounded-xl shadow-[0_0_15px_rgba(139,92,246,0.25)] hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] transition-transform active:scale-95 cursor-pointer disabled:opacity-55"
          >
            {isPending ? 'Saving...' : 'Save Account'}
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
            <User className={`w-4 h-4 ${activeStep === 'basic' ? 'text-accent-purple' : 'text-zinc-500'}`} />
            <div>
              <p className="font-bold">Basic Information</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">Parent & Kid details</p>
            </div>
          </button>

          <button
            onClick={() => setActiveStep('location')}
            className={`w-full flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-left text-xs font-semibold transition-all cursor-pointer ${
              activeStep === 'location' 
                ? 'bg-white/10 text-white shadow-md border border-white/10' 
                : 'text-zinc-400 hover:text-zinc-200 bg-white/0'
            }`}
          >
            <MapPin className={`w-4 h-4 ${activeStep === 'location' ? 'text-accent-blue' : 'text-zinc-500'}`} />
            <div>
              <p className="font-bold">Location</p>
              <p className="text-[10px] text-zinc-500 mt-0.5">City & State</p>
            </div>
          </button>
        </div>

        {/* Wizard Form Panels */}
        <div className="lg:col-span-9">
          <GlassCard className="p-8">
            {activeStep === 'basic' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white light:text-black">Basic Information</h3>
                  <p className="text-xs text-zinc-400 light:text-zinc-500 mt-1">Core details for the parent and student.</p>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Parent Name */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Parent Name <span className="text-rose-500">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. Ramesh Kumar" 
                      value={parentName} 
                      onChange={e => setParentName(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                    />
                  </div>

                  {/* Kid Name */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Kid's Name <span className="text-rose-500">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. Aryan Kumar" 
                      value={kidName} 
                      onChange={e => setKidName(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                    />
                  </div>
                  
                  {/* Email */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700 font-bold">Email Address <span className="text-rose-500">*</span></label>
                    <input 
                      type="email" 
                      placeholder="e.g. ramesh@example.com" 
                      value={email} 
                      onChange={e => setEmail(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                    />
                  </div>

                  {/* Phone Number */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700 font-bold">Mobile Number <span className="text-rose-500">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. 9876543210" 
                      value={phoneNumber} 
                      onChange={e => setPhoneNumber(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 dark:bg-white/5 border border-white/10 dark:border-white/10 text-xs rounded-xl focus:border-accent-violet outline-none transition-all text-white light:text-black"
                    />
                  </div>

                  {/* Grade/Standard */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700">Kid's Standard / Grade <span className="text-rose-500">*</span></label>
                    <CustomSelect 
                      value={grade}
                      onChange={setGrade}
                      options={[
                        { label: 'Standard 1', value: '1' },
                        { label: 'Standard 2', value: '2' },
                        { label: 'Standard 3', value: '3' },
                        { label: 'Standard 4', value: '4' },
                        { label: 'Standard 5', value: '5' },
                        { label: 'Standard 6', value: '6' },
                        { label: 'Standard 7', value: '7' },
                        { label: 'Standard 8', value: '8' },
                        { label: 'Standard 9', value: '9' },
                        { label: 'Standard 10', value: '10' },
                        { label: 'Standard 11', value: '11' },
                        { label: 'Standard 12', value: '12' }
                      ]}
                      placeholder="Select Grade"
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
                </div>

                <div className="flex justify-end pt-4">
                  <button
                    onClick={() => setActiveStep('location')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white rounded-xl cursor-pointer transition-all"
                  >
                    Next: Location
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {activeStep === 'location' && (
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white light:text-black">Location Details</h3>
                  <p className="text-xs text-zinc-400 light:text-zinc-500 mt-1">Provide the location information for the parent.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* City/District */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700 font-bold">City / District <span className="text-rose-500">*</span></label>
                    <CustomSelect 
                      value={city}
                      onChange={setCity}
                      options={MAHARASHTRA_DISTRICTS}
                      placeholder="Select District"
                    />
                  </div>

                  {/* State */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300 light:text-zinc-700 font-bold">State <span className="text-rose-500">*</span></label>
                    <CustomSelect 
                      value={state}
                      onChange={setState}
                      options={MAHARASHTRA_STATE}
                      placeholder="Select State"
                    />
                  </div>
                </div>

                <div className="flex justify-between pt-6 border-t border-white/5">
                  <button
                    onClick={() => setActiveStep('basic')}
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
                    {isPending ? 'Saving...' : 'Register Parent'}
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
