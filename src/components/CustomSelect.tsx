'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { commonPrefix } from '@/lib/labelGroups';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
import GlassCard from './GlassCard';

interface Option {
  value: string;
  label: string;
  /** Options sharing a group get the same background shade (one shade per group). */
  group?: string;
}

// Group shades, light → darker, cycling after five groups (accent mixed into the item background).
const GROUP_TINT_PERCENT = [6, 11, 16, 21, 26];

interface CustomSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: Option[];
  placeholder?: string;
  required?: boolean;
  className?: string;
  /** 'sm' matches the compact inputs of the Add Vendor / School / Parent forms. */
  size?: 'md' | 'sm';
}

export default function CustomSelect({
  value,
  onChange,
  options,
  placeholder = 'Select option',
  required = false,
  className = '',
  size = 'md',
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
  // Distinct groups in display order — decides each group's tint shade.
  const groupOrder = [...new Set(options.map((o) => o.group).filter((g): g is string => !!g))];

  // Consecutive options with the same group form one section (one shaded card).
  const sections: Array<{ group?: string; items: Option[] }> = [];
  for (const opt of options) {
    const last = sections[sections.length - 1];
    if (last && last.group === opt.group) last.items.push(opt);
    else sections.push({ group: opt.group, items: [opt] });
  }

  const renderRow = (opt: Option, text: string, inGroup: boolean) => {
    const isSelected = opt.value === value;
    return (
      <button
        key={opt.value}
        type="button"
        onClick={() => handleSelect(opt.value)}
        title={opt.label}
        className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-semibold select-none cursor-pointer transition-all flex items-center justify-between ${
          isSelected
            ? 'bg-accent-violet/15 text-accent-violet'
            // Grouped rows avoid `bg-white/` classes: the light theme forces a gray background on
            // those (globals.css), which would cover the group shade.
            : inGroup
              ? 'text-foreground hover:bg-foreground/5'
              : 'text-zinc-300 hover:bg-white/5 hover:text-white'
        }`}
      >
        <span>{text}</span>
        {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-accent-violet"></div>}
      </button>
    );
  };

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
        className={`w-full ${size === 'sm' ? 'px-3 py-2 text-xs rounded-[14px] outline-none focus:shadow-[0_0_0_3px_rgba(124,58,237,0.15)]' : 'px-4 py-3 text-sm rounded-xl'} bg-[#121216]/40 border border-white/10 hover:border-white/15 focus:border-accent-violet text-left flex items-center justify-between text-zinc-300 transition-all cursor-pointer select-none custom-select-btn`}
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
            {sections.map((section, si) => {
              // Ungrouped options (e.g. "All Products", "Unresolved") keep the plain row style.
              if (!section.group) {
                return section.items.map((opt) => renderRow(opt, opt.label, false));
              }
              const tint = GROUP_TINT_PERCENT[groupOrder.indexOf(section.group) % GROUP_TINT_PERCENT.length];
              const title = section.items.length > 1 ? commonPrefix(section.items.map((o) => o.label)) : '';
              return (
                <div
                  key={section.group + si}
                  className="rounded-xl p-1 my-1 first:mt-0 last:mb-0"
                  style={{ backgroundColor: `color-mix(in srgb, var(--accent-violet) ${tint}%, transparent)` }}
                >
                  {title && (
                    <div className="px-2.5 pt-1.5 pb-1 text-[9px] font-bold uppercase tracking-widest text-accent-violet">
                      {title}
                    </div>
                  )}
                  {/* Under a group title, rows show only what differs (Android / Windows / Linux). */}
                  {section.items.map((opt) => renderRow(opt, title ? opt.label.slice(title.length).trim() || opt.label : opt.label, true))}
                </div>
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
