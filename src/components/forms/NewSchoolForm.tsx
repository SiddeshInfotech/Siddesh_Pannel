'use client';

import React, { useState, useTransition } from 'react';
import { usePanelRouter } from '@/lib/usePanelPath';
import {
  ChevronLeft,
  ChevronRight,
  Check
} from 'lucide-react';
import CustomSelect from '@/components/CustomSelect';
import FormHeader, { type FormStepDef, FORM_INPUT_CLASS, FORM_GRID_CLASS, FORM_SAVE_BUTTON_CLASS } from './FormHeader';
import { useToast } from '@/components/Toast';
import { createSchool } from '@/app/[panel]/schools/new/actions';
import { MAHARASHTRA_DISTRICTS, MAHARASHTRA_STATE } from '@/lib/constants';

type FormStep = 'identity' | 'location' | 'admin';

const CLASSROOMS_MIN = 1;
const CLASSROOMS_MAX = 100;
/** Classrooms limit is always a whole number within 1–100 (empty / typed-out-of-range input is clamped). */
const clampClassrooms = (raw: string) =>
  Math.min(CLASSROOMS_MAX, Math.max(CLASSROOMS_MIN, Math.round(Number(raw)) || CLASSROOMS_MIN));

const STEPS: FormStepDef<FormStep>[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'location', label: 'Location' },
  { id: 'admin', label: 'Administration' },
];

export interface NewSchoolFormProps {
  /** Set when shown in a pop-up: Cancel closes it instead of navigating away. A saved school
   *  always continues to its payment step (activation), from the page or the pop-up. */
  onClose?: () => void;
}

export default function NewSchoolForm({ onClose }: NewSchoolFormProps = {}) {
  const inModal = !!onClose;
  const { toast } = useToast();
  const router = usePanelRouter();
  const [isPending, startTransition] = useTransition();
  const [activeStep, setActiveStep] = useState<FormStep>('identity');

  // Form states
  const [name, setName] = useState('');
  const [board, setBoard] = useState('');
  const [mediums, setMediums] = useState<string[]>(['Marathi', 'Semi-English']);
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('Maharashtra');
  const [pinCode, setPinCode] = useState('');
  const [coordinatorName, setCoordinatorName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [classrooms, setClassrooms] = useState(5);
  const [academicYear, setAcademicYear] = useState('');
  const [section, setSection] = useState('');
  const [standard, setStandard] = useState('');
  const [fullClassName, setFullClassName] = useState('');

  const handleMediumChange = (medium: string) => {
    setMediums(prev => 
      prev.includes(medium) 
        ? prev.filter(m => m !== medium) 
        : [...prev, medium]
    );
  };

  const handleSave = () => {
    if (!name) {
      toast('Please fill out the Institutional Name.', 'error');
      setActiveStep('identity');
      return;
    }
    if (!board) {
      toast('Please select an Affiliation Board.', 'error');
      setActiveStep('identity');
      return;
    }
    if (!street || !city || !state || !pinCode) {
      toast('Please complete all Location Details.', 'error');
      setActiveStep('location');
      return;
    }

    startTransition(async () => {
      const res = await createSchool({
        name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
        board: board as any,
        mediums: mediums,
        street,
        city,
        state,
        zipCode: pinCode,
        coordinatorName,
        email,
        phone,
        classroomsCount: classrooms,
        academicYear,
        section,
        standard,
        fullClassName
      });

      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }

      toast(`School Profile saved! Please complete the payment details to activate.`, 'success');
      onClose?.();
      setTimeout(() => {
        router.push(`/payments?schoolId=${res.data}`);
      }, 1500);
    });
  };

  return (
    <div className={inModal ? 'space-y-2' : 'space-y-2.5 max-w-6xl mx-auto'}>
      {!inModal && <div className="h-10"></div>}

      <FormHeader
        title="Add New School"
        steps={STEPS}
        activeStep={activeStep}
        onStepChange={setActiveStep}
        inModal={inModal}
        onClose={onClose}
        cancelHref="/accounts"
        backHref="/accounts"
        backLabel="Back to Directory"
      />

      {/* Form steps (full width) */}
      <div>
        <div>
          <div className="pt-2">

            {/* STEP 1: IDENTITY */}
            {activeStep === 'identity' && (
              <div className="space-y-6 animate-fade-in">
                <div className={FORM_GRID_CLASS}>
                  {/* Name */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Institutional Name <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. St. Xavier's International School"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className={FORM_INPUT_CLASS}
                    />
                  </div>

                  {/* Board */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Affiliation Board <span className="text-rose-500">*</span></label>
                    <CustomSelect size="sm"
                      required
                      value={board}
                      onChange={val => setBoard(val)}
                      options={[
                        { value: 'CBSE', label: 'CBSE' },
                        { value: 'ICSE', label: 'ICSE' },
                        { value: 'IGCSE', label: 'IGCSE' },
                        { value: 'State Board', label: 'State Board' }
                      ]}
                      placeholder="Select Affiliation Board"
                    />
                  </div>

                  {/* Grade */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Grade Scope <span className="text-rose-500">*</span></label>
                    <CustomSelect size="sm"
                      required
                      value={standard}
                      onChange={val => setStandard(val)}
                      options={[
                        { value: '1st to 4th', label: '1st to 4th' },
                        { value: '1st to 7th', label: '1st to 7th' },
                        { value: '5th to 7th', label: '5th to 7th' },
                        { value: '8th to 10th', label: '8th to 10th' },
                        { value: '1st to 10th', label: '1st to 10th' },
                        { value: '1st to 20th', label: '1st to 20th' },
                        { value: 'Grade 1', label: 'Grade 1' },
                        { value: 'Grade 2', label: 'Grade 2' },
                        { value: 'Grade 3', label: 'Grade 3' },
                        { value: 'Grade 4', label: 'Grade 4' },
                        { value: 'Grade 5', label: 'Grade 5' },
                        { value: 'Grade 6', label: 'Grade 6' },
                        { value: 'Grade 7', label: 'Grade 7' },
                        { value: 'Grade 8', label: 'Grade 8' },
                        { value: 'Grade 9', label: 'Grade 9' },
                        { value: 'Grade 10', label: 'Grade 10' }
                      ]}
                      placeholder="Select Grade Scope"
                    />
                  </div>

                  {/* Section */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Section</label>
                    <CustomSelect size="sm"
                      value={section}
                      onChange={val => setSection(val)}
                      options={[
                        { value: 'Section A', label: 'Section A' },
                        { value: 'Section B', label: 'Section B' },
                        { value: 'Section C', label: 'Section C' },
                        { value: 'Section D', label: 'Section D' },
                        { value: 'A', label: 'A' },
                        { value: 'B', label: 'B' },
                        { value: 'C', label: 'C' },
                        { value: 'D', label: 'D' }
                      ]}
                      placeholder="Select Section"
                    />
                  </div>

                  {/* Class Name */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Full Class Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Curriculum Portal"
                      value={fullClassName}
                      onChange={e => setFullClassName(e.target.value)}
                      className={FORM_INPUT_CLASS}
                    />
                  </div>

                  {/* Year */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Academic Year</label>
                    <input
                      type="text"
                      placeholder="e.g. 2026-27"
                      value={academicYear}
                      onChange={e => setAcademicYear(e.target.value)}
                      className={FORM_INPUT_CLASS}
                    />
                  </div>
                </div>

                {/* Mediums */}
                <div className="space-y-3 pt-2">
                  <label className="text-xs font-semibold text-zinc-300">Instruction Mediums <span className="text-rose-500">*</span></label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {['Marathi', 'Semi-English'].map(med => {
                      const isSelected = mediums.includes(med);
                      return (
                        <button
                          type="button"
                          key={med}
                          onClick={() => handleMediumChange(med)}
                          className={`p-4 rounded-2xl flex items-center justify-between border cursor-pointer select-none transition-all w-full text-left bg-transparent ${
                            isSelected
                              ? 'bg-accent-violet/10! border-accent-violet/30! text-white shadow-sm'
                              : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-[#121216]/40 light:hover:bg-black/5 hover:text-zinc-200'
                          }`}
                        >
                          <span className="text-xs font-semibold">{med}</span>
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                            isSelected 
                              ? 'border-accent-violet text-accent-violet bg-accent-violet/5' 
                              : 'border-white/20 text-transparent'
                          }`}>
                            {isSelected && <Check className="w-3 h-3" />}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Next button */}
                <div className="flex justify-end pt-4">
                  <button
                    type="button"
                    onClick={() => setActiveStep('location')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white rounded-xl cursor-pointer transition-all"
                  >
                    Next Step
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: LOCATION */}
            {activeStep === 'location' && (
              <div className="space-y-6 animate-fade-in">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-zinc-300">Street Address <span className="text-rose-500">*</span></label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 102 Green Valley Road, Sector 4"
                    value={street}
                    onChange={e => setStreet(e.target.value)}
                    className={FORM_INPUT_CLASS}
                  />
                </div>

                <div className={FORM_GRID_CLASS}>
                  {/* City */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">City / District <span className="text-rose-500">*</span></label>
                    <CustomSelect size="sm" 
                      value={city}
                      onChange={setCity}
                      options={MAHARASHTRA_DISTRICTS}
                      placeholder="Select City / District"
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

                  {/* PIN */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">PIN Code <span className="text-rose-500">*</span></label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 411001"
                      value={pinCode}
                      onChange={e => setPinCode(e.target.value)}
                      className={FORM_INPUT_CLASS}
                    />
                  </div>
                </div>

                {/* Wizard navigation buttons */}
                <div className="flex justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setActiveStep('identity')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl cursor-pointer transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveStep('admin')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-white rounded-xl cursor-pointer transition-all"
                  >
                    Next Step
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: ADMINISTRATION */}
            {activeStep === 'admin' && (
              <div className="space-y-6 animate-fade-in">
                <div className={FORM_GRID_CLASS}>
                  {/* Coordinator */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Coordinator Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Rameshwar Gulave"
                      value={coordinatorName}
                      onChange={e => setCoordinatorName(e.target.value)}
                      className={FORM_INPUT_CLASS}
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Coordinator Email</label>
                    <input
                      type="email"
                      placeholder="e.g. rameshwar@school.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className={FORM_INPUT_CLASS}
                    />
                  </div>

                  {/* Phone */}
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-zinc-300">Phone Number</label>
                    <input
                      type="text"
                      placeholder="e.g. +91 9876543210"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      className={FORM_INPUT_CLASS}
                    />
                  </div>
                </div>

                {/* Classrooms count — slider + number box kept in sync and clamped to 1–100 */}
                <div className="space-y-3 pt-2">
                  <div className="flex justify-between items-center gap-4">
                    <label htmlFor="classrooms-limit" className="text-xs font-semibold text-zinc-300">Classrooms Limit</label>
                    <input
                      type="number"
                      min={CLASSROOMS_MIN}
                      max={CLASSROOMS_MAX}
                      value={classrooms}
                      onChange={e => setClassrooms(clampClassrooms(e.target.value))}
                      aria-label="Classrooms limit"
                      className={`${FORM_INPUT_CLASS} !w-20 text-center font-mono`}
                    />
                  </div>
                  <input
                    id="classrooms-limit"
                    type="range"
                    min={CLASSROOMS_MIN}
                    max={CLASSROOMS_MAX}
                    value={classrooms}
                    onChange={e => setClassrooms(clampClassrooms(e.target.value))}
                    className="range-fancy w-full"
                    style={{ '--range-fill': `${((classrooms - CLASSROOMS_MIN) / (CLASSROOMS_MAX - CLASSROOMS_MIN)) * 100}%` } as React.CSSProperties}
                  />
                  <div className="flex justify-between text-[10px] font-mono text-zinc-500 select-none">
                    {[1, 25, 50, 75, 100].map(mark => (
                      <button
                        key={mark}
                        type="button"
                        onClick={() => setClassrooms(mark)}
                        className={`px-1 rounded transition-colors hover:text-[var(--foreground)] ${classrooms === mark ? 'text-accent-violet font-bold' : ''}`}
                      >
                        {mark}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-zinc-500">Limits the maximum active key/device nodes that can bind simultaneously.</p>
                </div>

                {/* Wizard navigation buttons */}
                <div className="flex justify-between pt-6 border-t border-white/5">
                  <button
                    type="button"
                    onClick={() => setActiveStep('location')}
                    className="flex items-center gap-1 px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl cursor-pointer transition-all"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>
                  
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isPending}
                    className={FORM_SAVE_BUTTON_CLASS}
                  >
                    {isPending ? 'Saving Profile...' : 'Save Profile'}
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
