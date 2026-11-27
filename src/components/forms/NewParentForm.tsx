'use client';

import React, { useState, useTransition } from 'react';
import { usePanelRouter } from '@/lib/usePanelPath';
import { 
  Check
} from 'lucide-react';
import { useToast } from '@/components/Toast';
import { createParent } from '@/app/[panel]/parents/new/actions';
import { updateParentAction, type ParentEditData } from '@/app/[panel]/accounts/actions';
import CustomSelect from '@/components/CustomSelect';
import FormHeader, { FORM_INPUT_CLASS, FORM_GRID_CLASS, FORM_SAVE_BUTTON_CLASS } from './FormHeader';
import { MAHARASHTRA_DISTRICTS, MAHARASHTRA_STATE } from '@/lib/constants';


export interface NewParentFormProps {
  /** Set when shown in a pop-up: Cancel (also Esc / a click outside) closes it; save via Register Parent. */
  onClose?: () => void;
  /** Called after a successful save in the pop-up (e.g. close it and refresh the list). */
  onSaved?: () => void;
  /** Edit this parent instead of adding one: the fields start with its saved values. */
  edit?: ParentEditData;
}

const GRADE_OPTIONS = Array.from({ length: 12 }, (_, i) => ({ label: `Standard ${i + 1}`, value: String(i + 1) }));

export default function NewParentForm({ onClose, onSaved, edit }: NewParentFormProps = {}) {
  const inModal = !!onClose;
  // The website saves a buyer's class as "Grade 3" or "1 to 4": keep it selectable as it is.
  const gradeOptions = edit?.grade && !GRADE_OPTIONS.some((o) => o.value === edit.grade)
    ? [{ label: edit.grade, value: edit.grade }, ...GRADE_OPTIONS]
    : GRADE_OPTIONS;
  const { toast } = useToast();
  const router = usePanelRouter();
  const [isPending, startTransition] = useTransition();

  // Form states
  // 1. Basic Parent & Kid Information
  const [parentName, setParentName] = useState(edit?.parentName ?? '');
  const [kidName, setKidName] = useState(edit?.kidName ?? '');
  const [email, setEmail] = useState(edit?.email ?? '');
  const [phoneNumber, setPhoneNumber] = useState(edit?.phoneNumber ?? '');
  const [status, setStatus] = useState<'Active' | 'Inactive'>(edit?.status ?? 'Active');
  const [grade, setGrade] = useState(edit?.grade ?? '');

  // 2. Location
  const [city, setCity] = useState(edit ? edit.city : '');
  const [state, setState] = useState(edit ? edit.state : 'Maharashtra');

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
    // A website sign-up has no grade until the first purchase, so an edit may leave it empty.
    if (!grade && !edit) {
      toast('Please select a Grade/Standard.', 'error');
      return;
    }

    startTransition(async () => {
      const values = { parentName, kidName, email, phoneNumber, status, grade, city, state };
      const res = edit ? await updateParentAction(edit.dbId, values) : await createParent(values);

      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }

      toast(edit ? `Saved changes to "${parentName.trim()}".` : `Parent account for "${parentName}" created successfully!`, 'success');
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
        title={edit ? `Edit Individual User${edit.parentId ? ` · ${edit.parentId}` : ''}` : 'Add Individual User'}
        inModal={inModal}
        onClose={onClose}
        cancelHref="/accounts"
        backHref="/"
        backLabel="Back to Dashboard"
      />

      {edit?.websiteLinked && (
        <p className="text-xs text-sky-400">
          LMS School website account: the name and mobile number are saved to the website too. The sign-in email can only be changed on the website.
        </p>
      )}
      {edit?.websiteUnavailable && (
        <p className="text-xs text-amber-400">
          The LMS School website could not be reached, so changes can&apos;t be saved right now. Close this and try again shortly.
        </p>
      )}

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
                      maxLength={edit?.websiteLinked ? 100 : 150}
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
                      maxLength={150}
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
                      maxLength={254}
                      readOnly={edit?.websiteLinked}
                      title={edit?.websiteLinked ? 'Website sign-in email: change it on the website' : undefined}
                      className={`${FORM_INPUT_CLASS} ${edit?.websiteLinked ? 'opacity-60 cursor-not-allowed' : ''}`}
                    />
                  </div>

                  {/* Phone Number */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Mobile Number <span className="text-rose-500">*</span></label>
                    <input 
                      type="text" 
                      placeholder="e.g. 9876543210" 
                      inputMode="numeric"
                      maxLength={20}
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
                      options={gradeOptions}
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
                    disabled={isPending || !!edit?.websiteUnavailable}
                    className={FORM_SAVE_BUTTON_CLASS}
                  >
                    {isPending ? 'Saving...' : edit ? 'Save Changes' : 'Register Parent'}
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
