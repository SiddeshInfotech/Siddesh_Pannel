'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { 
  School, 
  MapPin, 
  Layers, 
  User, 
  Upload, 
  ChevronLeft,
  Check
} from 'lucide-react';
import GlassCard from '@/components/GlassCard';
import Link from 'next/link';
import { useToast } from '@/components/Toast';
import { updateSchoolAction } from '@/app/data/actions';
import CustomSelect from '@/components/CustomSelect';

interface EditSchoolClientProps {
  school: {
    dbId: string;
    name: string;
    board: 'CBSE' | 'State Board' | 'ICSE' | 'IB' | 'IGCSE';
    mediums: string[];
    street: string;
    city: string;
    state: string;
    zipCode: string;
    coordinatorName: string;
    email: string;
    phone: string;
    classroomsCount: number;
  };
}

export default function EditSchoolClient({ school }: EditSchoolClientProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Form states initialized with pre-populated values
  const [name, setName] = useState(school.name);
  const [board, setBoard] = useState<any>(school.board);
  const [mediums, setMediums] = useState<string[]>(school.mediums || []);
  const [street, setStreet] = useState(school.street);
  const [city, setCity] = useState(school.city);
  const [state, setState] = useState(school.state);
  const [pinCode, setPinCode] = useState(school.zipCode);
  const [coordinatorName, setCoordinatorName] = useState(school.coordinatorName);
  const [email, setEmail] = useState(school.email);
  const [phone, setPhone] = useState(school.phone);
  const [classrooms, setClassrooms] = useState(school.classroomsCount);

  // Mock uploader preview
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const handleMediumChange = (medium: string) => {
    setMediums(prev => 
      prev.includes(medium) 
        ? prev.filter(m => m !== medium) 
        : [...prev, medium]
    );
  };
  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !board) {
      toast('Please fill out all required fields (Name and Affiliation Board).', 'error');
      return;
    }

    startTransition(async () => {
      const res = await updateSchoolAction(school.dbId, {
        name,
        board,
        mediums: mediums,
        street,
        city,
        state,
        zipCode: pinCode,
        coordinatorName,
        email,
        phone,
        classroomsCount: classrooms
      });

      if (!res.ok) {
        toast(res.error, 'error');
        return;
      }

      toast(`School details for "${name}" updated successfully!`, 'success');
      setTimeout(() => {
        router.push('/data');
      }, 1500);
    });
  };

  return (
    <form onSubmit={handleSave} action="javascript:void(0)" className="space-y-8 max-w-6xl mx-auto">
      {/* Spacer to maintain layout height */}
      <div className="h-10"></div>

      {/* Header Bar */}
      <div className="flex justify-between items-center flex-wrap gap-4 border-b border-white/5 pb-6">
        <div>
          <div className="flex items-center gap-2 text-zinc-500 hover:text-zinc-300 text-xs font-semibold cursor-pointer mb-2">
            <Link href="/data" className="flex items-center gap-1">
              <ChevronLeft className="w-3.5 h-3.5" />
              Back to Directory
            </Link>
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight">Edit School Details</h2>
          <p className="text-xs text-zinc-400 mt-1">Modify the enterprise registration profile for this educational institution.</p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            href="/data"
            className="px-5 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-zinc-300 rounded-xl transition-all cursor-pointer"
          >
            Cancel
          </Link>
          
          <button
            type="submit"
            disabled={isPending}
            className="px-5 py-2.5 bg-gradient-to-r from-accent-violet to-accent-blue text-xs font-semibold text-white rounded-xl shadow-[0_0_15px_rgba(139,92,246,0.25)] hover:shadow-[0_0_20px_rgba(139,92,246,0.4)] transition-transform active:scale-95 cursor-pointer disabled:opacity-55"
          >
            {isPending ? 'Updating...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Form Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* Left Column (8 Columns) */}
        <div className="lg:col-span-8 space-y-8">
          
          {/* Card 1: School Profile */}
          <GlassCard className="bg-[#121216]/40 border border-white/5 space-y-6">
            <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
              <School className="w-4.5 h-4.5 text-accent-violet" />
              School Profile
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">Institutional Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. St. Xavier's International"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">Affiliation Board *</label>
                <CustomSelect
                  required
                  value={board}
                  onChange={val => setBoard(val as any)}
                  options={[
                    { value: 'CBSE', label: 'CBSE' },
                    { value: 'ICSE', label: 'ICSE' },
                    { value: 'IGCSE', label: 'IGCSE' },
                    { value: 'State Board', label: 'State Board' }
                  ]}
                  placeholder="Select Board"
                />
              </div>
            </div>

            {/* Instruction Mediums Radio Buttons */}
            <div className="space-y-3">
              <label className="text-xs font-bold text-zinc-400 block">Mediums of Instruction *</label>
              <div className="grid grid-cols-2 gap-4">
                {['Marathi', 'Semi-English'].map(med => {
                  const isSelected = mediums.includes(med);
                  return (
                    <button
                      type="button"
                      key={med}
                      onClick={() => handleMediumChange(med)}
                      className={`p-3.5 rounded-2xl flex items-center justify-between border cursor-pointer select-none transition-all w-full text-left bg-transparent ${
                        isSelected
                          ? 'bg-accent-violet/10! border-accent-violet/30! text-white'
                          : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-300'
                      }`}
                    >
                      <span className="text-xs font-semibold">{med}</span>
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center border transition-all ${
                        isSelected 
                          ? 'border-accent-violet text-accent-violet' 
                          : 'border-white/20 text-transparent'
                      }`}>
                        {isSelected && <Check className="w-2.5 h-2.5" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </GlassCard>

          {/* Card 2: Location Details */}
          <GlassCard className="bg-[#121216]/40 border border-white/5 space-y-6">
            <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
              <MapPin className="w-4.5 h-4.5 text-accent-violet" />
              Location Details
            </h3>

            <div className="space-y-2">
              <label className="text-xs font-bold text-zinc-400">Street Address *</label>
              <input
                type="text"
                required
                placeholder="House No, Street, Landmark"
                value={street}
                onChange={e => setStreet(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">City *</label>
                <input
                  type="text"
                  required
                  placeholder="City"
                  value={city}
                  onChange={e => setCity(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">State *</label>
                <input
                  type="text"
                  required
                  placeholder="State"
                  value={state}
                  onChange={e => setState(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-400">PIN Code *</label>
                <input
                  type="text"
                  required
                  placeholder="600000"
                  value={pinCode}
                  onChange={e => setPinCode(e.target.value)}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-white placeholder-zinc-500 focus:outline-none transition-all"
                />
              </div>
            </div>
          </GlassCard>

          {/* Card 3: Infrastructure */}
          <GlassCard className="bg-[#121216]/40 border border-white/5 space-y-6">
            <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
              <Layers className="w-4.5 h-4.5 text-accent-violet" />
              Infrastructure
            </h3>

            {/* Slider classrooms */}
            <div className="space-y-4">
              <div className="flex justify-between items-center text-xs font-bold text-zinc-400">
                <span>Number of Classrooms</span>
                <input 
                  type="number"
                  min="0"
                  max="100"
                  value={classrooms}
                  onChange={e => setClassrooms(Number(e.target.value))}
                  className="px-2.5 py-1 bg-white/5 border border-white/10 text-white rounded-lg font-mono w-16 text-center focus:outline-none focus:border-accent-violet"
                />
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={classrooms}
                onChange={e => setClassrooms(Number(e.target.value))}
                className="w-full h-1.5 bg-white/5 rounded-lg appearance-none cursor-pointer accent-accent-violet border border-white/5"
              />
            </div>
          </GlassCard>

        </div>

        {/* Right Column (4 Columns) */}
        <div className="lg:col-span-4 space-y-8">
          
          {/* Point of Contact */}
          <GlassCard className="bg-[#121216]/40 border border-white/5 space-y-4">
            <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-widest flex items-center gap-2">
              <User className="w-4 h-4 text-accent-violet" />
              Point of Contact
            </h3>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Coordinator Name</label>
                <input
                  type="text"
                  placeholder="Full Name"
                  value={coordinatorName}
                  onChange={e => setCoordinatorName(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Official Email</label>
                <input
                  type="email"
                  placeholder="school@edu.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none transition-all"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Contact Phone</label>
                <input
                  type="text"
                  placeholder="+91 98765 43210"
                  value={phone}
                  onChange={e => setPhone(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white/5 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-xs text-white placeholder-zinc-500 focus:outline-none transition-all"
                />
              </div>
            </div>
          </GlassCard>

        </div>
      </div>
    </form>
  );
}
