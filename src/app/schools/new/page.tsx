'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { 
  School as SchoolIcon, 
  MapPin, 
  Layers, 
  User, 
  ChevronLeft,
  ChevronRight,
  Check,
  Building2,
  Calendar,
  Layers2,
  BookOpen,
  Phone,
  Mail,
  GraduationCap
} from 'lucide-react';
import GlassCard from '@/components/GlassCard';
import Link from 'next/link';
import { useToast } from '@/components/Toast';
import { createSchool } from './actions';
import CustomSelect from '@/components/CustomSelect';

type FormStep = 'identity' | 'location' | 'admin';

export default function NewSchoolPage() {
  const { toast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeStep, setActiveStep] = useState<FormStep>('identity');

  // Form states
  const [name, setName] = useState('');
  const [board, setBoard] = useState('');
  const [mediums, setMediums] = useState<string[]>(['Marathi', 'Semi-English']);
  const [street, setStreet] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
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
      setTimeout(() => {
        router.push(`/payments?schoolId=${res.data}`);
      }, 1500);
    });
  };

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      {/* Spacer */}
      <div className="h-10"></div>

      {/* Header Bar */}
      <div className="flex justify-between items-center flex-wrap gap-4 border-b border-white/5 dark:border-white/5 light:border-black/10 pb-6">
        <div>
          <div className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 light:text-zinc-500 light:hover:text-black text-xs font-semibold cursor-pointer mb-2">
            <Link href="/data" className="flex items-center gap-1">
              <ChevronLeft className="w-3.5 h-3.5" />
              Back to Directory
            </Link>
          </div>
          <h2 className="text-3xl font-extrabold text-white light:text-black tracking-tight">Add New School</h2>
          <p className="text-xs text-zinc-400 light:text-zinc-500 mt-1">Register a new educational institution into the enterprise ecosystem.</p>
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
            {isPending ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </div>

      {/* Main wizard interface */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left wizard steps navigation */}
        <div className="lg:col-span-3 space-y-2.5">
          <button
            onClick={() => setActiveStep('identity')}
            className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center gap-3 cursor-pointer ${
              activeStep === 'identity'
                ? 'bg-accent-violet/10 dark:bg-accent-violet/10 light:bg-accent-violet/5 border-accent-violet/30 dark:border-accent-violet/30 light:border-accent-violet/30 shadow-[0_4px_20px_rgba(124,58,237,0.05)]'
                : 'bg-[#121216]/20 dark:bg-[#121216]/20 light:bg-white border-white/5 dark:border-white/5 light:border-black/10 hover:bg-[#121216]/40 light:hover:bg-black/5'
            }`}
          >
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
              activeStep === 'identity' ? 'bg-accent-violet text-white' : 'bg-white/5 dark:bg-white/5 light:bg-black/5 text-zinc-400 light:text-zinc-600'
            }`}>
              1
            </div>
            <div>
              <h4 className={`text-xs font-bold ${activeStep === 'identity' ? 'text-white light:text-accent-violet' : 'text-zinc-400 light:text-zinc-600'}`}>Identity</h4>
              <p className="text-[10px] text-zinc-500 light:text-zinc-500 mt-0.5">Profile & Affiliations</p>
            </div>
          </button>

          <button
            onClick={() => setActiveStep('location')}
            className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center gap-3 cursor-pointer ${
              activeStep === 'location'
                ? 'bg-accent-violet/10 dark:bg-accent-violet/10 light:bg-accent-violet/5 border-accent-violet/30 dark:border-accent-violet/30 light:border-accent-violet/30 shadow-[0_4px_20px_rgba(124,58,237,0.05)]'
                : 'bg-[#121216]/20 dark:bg-[#121216]/20 light:bg-white border-white/5 dark:border-white/5 light:border-black/10 hover:bg-[#121216]/40 light:hover:bg-black/5'
            }`}
          >
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
              activeStep === 'location' ? 'bg-accent-violet text-white' : 'bg-white/5 dark:bg-white/5 light:bg-black/5 text-zinc-400 light:text-zinc-600'
            }`}>
              2
            </div>
            <div>
              <h4 className={`text-xs font-bold ${activeStep === 'location' ? 'text-white light:text-accent-violet' : 'text-zinc-400 light:text-zinc-600'}`}>Location</h4>
              <p className="text-[10px] text-zinc-500 light:text-zinc-500 mt-0.5">Physical Address</p>
            </div>
          </button>

          <button
            onClick={() => setActiveStep('admin')}
            className={`w-full text-left p-4 rounded-2xl border transition-all flex items-center gap-3 cursor-pointer ${
              activeStep === 'admin'
                ? 'bg-accent-violet/10 dark:bg-accent-violet/10 light:bg-accent-violet/5 border-accent-violet/30 dark:border-accent-violet/30 light:border-accent-violet/30 shadow-[0_4px_20px_rgba(124,58,237,0.05)]'
                : 'bg-[#121216]/20 dark:bg-[#121216]/20 light:bg-white border-white/5 dark:border-white/5 light:border-black/10 hover:bg-[#121216]/40 light:hover:bg-black/5'
            }`}
          >
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
              activeStep === 'admin' ? 'bg-accent-violet text-white' : 'bg-white/5 dark:bg-white/5 light:bg-black/5 text-zinc-400 light:text-zinc-600'
            }`}>
              3
            </div>
            <div>
              <h4 className={`text-xs font-bold ${activeStep === 'admin' ? 'text-white light:text-accent-violet' : 'text-zinc-400 light:text-zinc-600'}`}>Administration</h4>
              <p className="text-[10px] text-zinc-500 light:text-zinc-500 mt-0.5">Contact & Facilities</p>
            </div>
          </button>
        </div>

        {/* Right active step form panel */}
        <div className="lg:col-span-9">
          <GlassCard className="bg-[#121216]/40 dark:bg-[#121216]/40 light:bg-white border border-white/5 dark:border-white/5 light:border-black/15 p-8 rounded-3xl relative overflow-hidden shadow-xl">
            <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-accent-violet/5 rounded-full blur-[100px] pointer-events-none"></div>

            {/* STEP 1: IDENTITY */}
            {activeStep === 'identity' && (
              <div className="space-y-6 animate-fade-in">
                <div className="border-b border-white/5 dark:border-white/5 light:border-black/10 pb-4">
                  <h3 className="text-lg font-bold text-white light:text-black flex items-center gap-2.5">
                    <Building2 className="w-5 h-5 text-accent-violet" />
                    Institutional Identity
                  </h3>
                  <p className="text-xs text-zinc-500 light:text-zinc-500 mt-1">Specify core branding information and education parameters.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Name */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 flex items-center gap-1.5">
                      <SchoolIcon className="w-3.5 h-3.5 text-zinc-500" />
                      Institutional Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. St. Xavier's International School"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                    />
                  </div>

                  {/* Board */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5 text-zinc-500" />
                      Affiliation Board *
                    </label>
                    <CustomSelect
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
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Grade */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 flex items-center gap-1.5">
                      <Layers2 className="w-3.5 h-3.5 text-zinc-500" />
                      Grade Scope *
                    </label>
                    <CustomSelect
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
                    <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 flex items-center gap-1.5">
                      <Layers2 className="w-3.5 h-3.5 text-zinc-500" />
                      Section
                    </label>
                    <CustomSelect
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
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Class Name */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5 text-zinc-500" />
                      Full Class Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Curriculum Portal"
                      value={fullClassName}
                      onChange={e => setFullClassName(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                    />
                  </div>

                  {/* Year */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 flex items-center gap-1.5">
                      <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                      Academic Year
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. 2026-27"
                      value={academicYear}
                      onChange={e => setAcademicYear(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Mediums */}
                <div className="space-y-3 pt-2">
                  <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 block">Instruction Mediums *</label>
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
                              ? 'bg-accent-violet/10! border-accent-violet/30! text-white light:text-black shadow-sm'
                              : 'bg-white/5 border-white/5 dark:border-white/5 light:border-black/10 text-zinc-400 hover:bg-[#121216]/40 light:hover:bg-black/5 hover:text-zinc-200'
                          }`}
                        >
                          <span className="text-xs font-semibold">{med}</span>
                          <div className={`w-5 h-5 rounded-full flex items-center justify-center border transition-all ${
                            isSelected 
                              ? 'border-accent-violet text-accent-violet bg-accent-violet/5' 
                              : 'border-white/20 light:border-black/20 text-transparent'
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
                    className="flex items-center gap-2 px-5 py-2.5 bg-accent-violet text-xs font-bold text-white rounded-xl shadow-lg hover:bg-accent-violet/95 active:scale-95 transition-all cursor-pointer"
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
                <div className="border-b border-white/5 dark:border-white/5 light:border-black/10 pb-4">
                  <h3 className="text-lg font-bold text-white light:text-black flex items-center gap-2.5">
                    <MapPin className="w-5 h-5 text-accent-violet" />
                    Location Parameters
                  </h3>
                  <p className="text-xs text-zinc-500 light:text-zinc-500 mt-1">Specify institutional geo-coordinates and address attributes.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 block">Street Address *</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 102 Green Valley Road, Sector 4"
                    value={street}
                    onChange={e => setStreet(e.target.value)}
                    className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* City */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 block">City *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Pune"
                      value={city}
                      onChange={e => setCity(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                    />
                  </div>

                  {/* State */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 block">State *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Maharashtra"
                      value={state}
                      onChange={e => setState(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                    />
                  </div>

                  {/* PIN */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 block">PIN Code *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. 411001"
                      value={pinCode}
                      onChange={e => setPinCode(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Wizard navigation buttons */}
                <div className="flex justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setActiveStep('identity')}
                    className="flex items-center gap-1.5 px-4 py-2 border border-white/10 dark:border-white/10 light:border-black/15 text-xs font-bold text-zinc-400 hover:text-white light:hover:text-black rounded-xl transition-all cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveStep('admin')}
                    className="flex items-center gap-2 px-5 py-2.5 bg-accent-violet text-xs font-bold text-white rounded-xl shadow-lg hover:bg-accent-violet/95 active:scale-95 transition-all cursor-pointer"
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
                <div className="border-b border-white/5 dark:border-white/5 light:border-black/10 pb-4">
                  <h3 className="text-lg font-bold text-white light:text-black flex items-center gap-2.5">
                    <User className="w-5 h-5 text-accent-violet" />
                    Administration & Infrastructure
                  </h3>
                  <p className="text-xs text-zinc-500 light:text-zinc-500 mt-1">Specify coordination contacts and classroom capabilities.</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Coordinator */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-zinc-500" />
                      Coordinator Name
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Rameshwar Gulave"
                      value={coordinatorName}
                      onChange={e => setCoordinatorName(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                    />
                  </div>

                  {/* Email */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-zinc-500" />
                      Coordinator Email
                    </label>
                    <input
                      type="email"
                      placeholder="e.g. rameshwar@school.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                    />
                  </div>

                  {/* Phone */}
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-400 light:text-zinc-600 flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-zinc-500" />
                      Phone Number
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. +91 9876543210"
                      value={phone}
                      onChange={e => setPhone(e.target.value)}
                      className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                    />
                  </div>
                </div>

                {/* Classrooms count */}
                <div className="space-y-4 pt-2">
                  <div className="flex justify-between items-center text-xs font-bold text-zinc-400 light:text-zinc-600">
                    <span className="flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-zinc-500" />
                      Classrooms Limit
                    </span>
                    <input 
                      type="number"
                      min="1"
                      max="100"
                      value={classrooms}
                      onChange={e => setClassrooms(Number(e.target.value))}
                      className="px-2.5 py-1 bg-white/5 border border-white/10 text-white light:text-black rounded-lg font-mono w-16 text-center focus:outline-none focus:border-accent-violet"
                    />
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    value={classrooms}
                    onChange={e => setClassrooms(Number(e.target.value))}
                    className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-accent-violet border border-white/5"
                  />
                  <p className="text-[10px] text-zinc-500">Limits the maximum active key/device nodes that can bind simultaneously.</p>
                </div>

                {/* Wizard navigation buttons */}
                <div className="flex justify-between pt-4">
                  <button
                    type="button"
                    onClick={() => setActiveStep('location')}
                    className="flex items-center gap-1.5 px-4 py-2 border border-white/10 dark:border-white/10 light:border-black/15 text-xs font-bold text-zinc-400 hover:text-white light:hover:text-black rounded-xl transition-all cursor-pointer"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    Back
                  </button>
                  
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isPending}
                    className="flex items-center gap-2 px-6 py-2.5 bg-gradient-to-r from-accent-violet to-accent-blue text-xs font-bold text-white rounded-xl shadow-[0_0_15px_rgba(139,92,246,0.25)] hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] active:scale-95 transition-all cursor-pointer disabled:opacity-55"
                  >
                    {isPending ? 'Saving Profile...' : 'Save Profile'}
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
