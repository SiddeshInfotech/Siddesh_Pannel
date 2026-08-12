'use client';

import React, { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';

interface AppleDatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (date: string) => void;
  placeholder?: string;
  className?: string;
}

export default function AppleDatePicker({ value, onChange, placeholder = 'mm/dd/yyyy', className = '' }: AppleDatePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (value) {
      const [y, m] = value.split('-');
      return new Date(parseInt(y), parseInt(m) - 1, 1);
    }
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth(), 1);
  });
  
  const popoverRef = useRef<HTMLDivElement>(null);

  const [popupStyle, setPopupStyle] = useState<React.CSSProperties>({});

  const toggleOpen = () => {
    if (!isOpen && popoverRef.current) {
      const rect = popoverRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const popupHeight = 320; // approximate height

      let top, left = rect.left;
      
      if (spaceBelow < popupHeight && spaceAbove > popupHeight) {
        // Open upwards
        top = rect.top - popupHeight - 8;
      } else {
        // Open downwards
        top = rect.bottom + 8;
      }

      setPopupStyle({
        position: 'fixed',
        top: `${top}px`,
        left: `${left}px`,
        width: '280px', // fixed width
        zIndex: 9999
      });
    }
    setIsOpen(!isOpen);
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        // Also need to check if the click was inside the fixed popup
        // But since the popup is not a child of popoverRef when we use portals, wait... 
        // Here we render it inline, but with fixed position. Wait, if it's rendered inline,
        // it IS a child of popoverRef! So `contains` will still work.
        setIsOpen(false);
      }
    }
    
    function handleScroll() {
      if (isOpen) setIsOpen(false); // Close on scroll to avoid detached popup
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      window.addEventListener('scroll', handleScroll, true); // true for capture phase to catch all scrolls
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, [isOpen]);

  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();
  
  const days = [];
  
  const prevMonthDays = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 0).getDate();
  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    days.push({ day: prevMonthDays - i, isCurrentMonth: false, isPrevMonth: true });
  }
  
  for (let i = 1; i <= daysInMonth; i++) {
    days.push({ day: i, isCurrentMonth: true });
  }
  
  const remainingSlots = 42 - days.length;
  for (let i = 1; i <= remainingSlots; i++) {
    days.push({ day: i, isCurrentMonth: false, isNextMonth: true });
  }

  const nextMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
  };

  const prevMonth = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  };

  const handleDateSelect = (day: number, isPrev: boolean, isNext: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    let year = currentMonth.getFullYear();
    let month = currentMonth.getMonth();
    
    if (isPrev) month -= 1;
    else if (isNext) month += 1;
    
    const selectedDate = new Date(year, month, day);
    const yyyy = selectedDate.getFullYear();
    const mm = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const dd = String(selectedDate.getDate()).padStart(2, '0');
    
    onChange(`${yyyy}-${mm}-${dd}`);
    setIsOpen(false);
  };
  
  const formatDateForDisplay = (dateStr: string) => {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${m}/${d}/${y}`;
  };

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const weekDays = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

  return (
    <div className={`relative ${className}`} ref={popoverRef}>
      <div 
        onClick={toggleOpen}
        className="w-full px-4 py-3 bg-[#121216] border border-white/10 hover:border-white/15 focus-within:border-accent-violet rounded-xl text-sm text-zinc-300 flex items-center justify-between cursor-pointer transition-all"
      >
        <span>{value ? formatDateForDisplay(value) : placeholder}</span>
        <CalendarIcon className="w-4 h-4 text-zinc-500" />
      </div>

      {isOpen && (
        <div 
          style={popupStyle}
          className="p-4 bg-[#1e1e24]/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] animate-in fade-in zoom-in-95 duration-200"
        >
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold text-white ml-1 tracking-tight">
              {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </span>
            <div className="flex items-center gap-1">
              <button 
                onClick={prevMonth}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button 
                onClick={nextMonth}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-white/10 text-zinc-400 hover:text-white transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1 mb-2">
            {weekDays.map(day => (
              <div key={day} className="text-center text-[10px] font-bold text-zinc-500 mb-1">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((item, index) => {
              const isSelected = value && 
                item.isCurrentMonth && 
                parseInt(value.split('-')[2]) === item.day &&
                parseInt(value.split('-')[1]) === currentMonth.getMonth() + 1 &&
                parseInt(value.split('-')[0]) === currentMonth.getFullYear();

              const today = new Date();
              const isToday = item.isCurrentMonth &&
                item.day === today.getDate() &&
                currentMonth.getMonth() === today.getMonth() &&
                currentMonth.getFullYear() === today.getFullYear();

              return (
                <button
                  key={index}
                  onClick={(e) => handleDateSelect(item.day, !!item.isPrevMonth, !!item.isNextMonth, e)}
                  style={{ backgroundColor: isSelected ? 'var(--accent-violet)' : undefined }}
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-medium transition-all
                    ${!item.isCurrentMonth ? 'text-zinc-600 hover:text-zinc-400' : 'text-zinc-200'}
                    ${isSelected ? 'text-white shadow-[0_4px_14px_rgba(139,92,246,0.4)]' : ''}
                    ${!isSelected && isToday ? 'bg-white/10 text-white' : ''}
                    ${!isSelected && !isToday ? 'hover:bg-white/10' : ''}
                  `}
                >
                  {item.day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
