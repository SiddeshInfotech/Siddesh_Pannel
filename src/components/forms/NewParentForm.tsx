'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Check
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import { createParent } from '@/app/parents/new/actions';
import CustomSelect from '@/components/CustomSelect';
import FormHeader, { FORM_INPUT_CLASS, FORM_GRID_CLASS, FORM_SAVE_BUTTON_CLASS } from './FormHeader';
import { MAHARASHTRA_DISTRICTS, MAHARASHTRA_STATE } from '@/lib/constants';


export interface NewParentFormProps {
  /** Set when shown in a pop-up: Cancel (also Esc / a click outside) closes it; save via Register Parent. */
  onClose?: () => void;
  /** Called after a successful save in the pop-up (e.g. close it and refresh the list). */
  onSaved?: () => void;
}

export default function NewParentForm({ onClose, onSaved }: NewParentFormProps = {}) {
  const inModal = !!onClose;
  const { toast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

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
      return;
    }
    if (!email || !phoneNumber) {
      toast('Please provide valid Contact Details (Email & Phone).', 'error');
      return;
    }
    if (!grade) {
      toast('Please select a Grade/Standard.', 'error');
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
      if (onSaved) { onSaved(); return; }
      setTimeout(() => {
        router.push('/accounts'); // Accounts page lists the parents
      }, 1500);
    });
  };

  return (
    <div className={inModal ? 'space-y-2' : 'space-y-2.5 max-w-6xl mx-auto'}>
      {!inModal && <div className="h-10"></div>}

      <FormHeader
        title="Add Individual User"
        inModal={inModal}
        onClose={onClose}
        cancelHref="/accounts"
        backHref="/"
        backLabel="Back to Dashboard"
      />

      {/* Form (single page, full width) */}
      <div>
        <div>
          <div className="pt-2">
              <div className="space-y-6">
                <div className={FORM_GRID_CLASS}>
                  {/* Parent Name */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Parent Name <span className="text-rose-500">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. Ramesh Kumar" 
                      value={parentName} 
                      onChange={e => setParentName(e.target.value)}
                      className={FORM_INPUT_CLASS}
                    />
                  </div>

                  {/* Kid Name */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Kid&apos;s Name <span className="text-rose-500">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. Aryan Kumar" 
                      value={kidName} 
                      onChange={e => setKidName(e.target.value)}
                      className={FORM_INPUT_CLASS}
                    />
                  </div>
                  
                  {/* Email */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Email Address <span className="text-rose-500">*</span></label>
                    <input 
                      type="email" 
                      placeholder="e.g. ramesh@example.com" 
                      value={email} 
                      onChange={e => setEmail(e.target.value)}
                      className={FORM_INPUT_CLASS}
                    />
                  </div>

                  {/* Phone Number */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Mobile Number <span className="text-rose-500">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. 9876543210" 
                      value={phoneNumber} 
                      onChange={e => setPhoneNumber(e.target.value)}
                      className={FORM_INPUT_CLASS}
                    />
                  </div>

                  {/* Grade/Standard */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Kid&apos;s Standard / Grade <span className="text-rose-500">*</span></label>
                    <CustomSelect size="sm" 
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
                    <label className="text-xs font-semibold text-zinc-300">Status <span className="text-rose-500">*</span></label>
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

                  {/* City/District */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">City / District <span className="text-rose-500">*</span></label>
                    <CustomSelect size="sm" 
                      value={city}
                      onChange={setCity}
                      options={MAHARASHTRA_DISTRICTS}
                      placeholder="Select District"
                    />
                  </div>

                  {/* State */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">State <span className="text-rose-500">*</span></label>
                    <CustomSelect size="sm" 
                      value={state}
                      onChange={setState}
                      options={MAHARASHTRA_STATE}
                      placeholder="Select State"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-6 border-t border-white/5">
                  <button
                    onClick={handleSave}
                    disabled={isPending}
                    className={FORM_SAVE_BUTTON_CLASS}
                  >
                    {isPending ? 'Saving...' : 'Register Parent'}
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              </div>
          </div>
        </div>
      </div>
    </div>
  );
}
