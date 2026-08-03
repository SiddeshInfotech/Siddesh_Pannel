'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
import GlassCard from './GlassCard';

interface Option {
  value: string;
  label: string;
}

interface CustomSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: Option[];
  placeholder?: string;
  required?: boolean;
  className?: string;
}

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Select option',
  required = false,
  className = '',
}: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedOption = options.find((opt) => opt.value === value);

  const handleSelect = (val: string) => {
    onChange(val);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      {/* Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 bg-[#121216]/40 border border-white/10 hover:border-white/15 focus:border-accent-violet rounded-xl text-sm text-left flex items-center justify-between text-zinc-300 transition-all cursor-pointer select-none custom-select-btn"
      >
        <span className={!selectedOption ? 'text-zinc-500 font-medium' : 'text-white font-semibold'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {/* Hidden select for standard HTML form validation */}
      <select
        required={required}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      {/* Dropdown Options List */}
      {isOpen && (
        <div className="absolute left-0 right-0 mt-2 z-50 animate-fade-in custom-select-dropdown">
          <div className="bg-[#121216] border border-white/10 shadow-2xl p-1.5 max-h-60 overflow-y-auto rounded-xl custom-select-container">
            {options.map((opt) => {
              const isSelected = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => handleSelect(opt.value)}
                  className={`w-full text-left px-3.5 py-2.5 rounded-lg text-xs font-semibold select-none cursor-pointer transition-all flex items-center justify-between ${
                    isSelected
                      ? 'bg-accent-violet/15 text-accent-violet'
                      : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span>{opt.label}</span>
                  {isSelected && (
                    <div className="w-1.5 h-1.5 rounded-full bg-accent-violet"></div>
                  )}
                </button>
              );
            })}
            {options.length === 0 && (
              <div className="px-3.5 py-2.5 text-xs text-zinc-500 text-center font-medium">
                No options available
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
