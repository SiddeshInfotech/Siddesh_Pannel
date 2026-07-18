'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { CheckCircle2, XCircle, AlertCircle, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'success') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts([{ id, message, type }]);

    // Auto remove after 4 seconds
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      
      {/* Toast Container - Top Right Positioned */}
      <div className="fixed top-6 right-6 z-50 flex flex-col gap-3 w-full max-w-sm pointer-events-none">
        {toasts.map((t) => {
          let bgClass = 'bg-[#121216]/95 border-white/5 text-white';
          let Icon = AlertCircle;
          let iconColor = 'text-accent-blue';

          if (t.type === 'success') {
            bgClass = 'bg-emerald-950/40 border-emerald-500/20 backdrop-blur-xl text-emerald-100';
            Icon = CheckCircle2;
            iconColor = 'text-emerald-400';
          } else if (t.type === 'error') {
            bgClass = 'bg-rose-950/40 border-rose-500/20 backdrop-blur-xl text-rose-100';
            Icon = XCircle;
            iconColor = 'text-rose-400';
          } else if (t.type === 'info') {
            bgClass = 'bg-zinc-950/40 border-white/10 backdrop-blur-xl text-zinc-100';
            Icon = AlertCircle;
            iconColor = 'text-accent-violet';
          }

          return (
            <div
              key={t.id}
              className={`flex items-start gap-3 p-4 rounded-2xl border shadow-2xl transition-all duration-300 pointer-events-auto animate-slide-in ${bgClass}`}
            >
              <span className={`p-0.5 rounded-lg shrink-0 ${iconColor}`}>
                <Icon className="w-5 h-5" />
              </span>
              <p className="text-xs font-semibold leading-relaxed flex-1">{t.message}</p>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                className="text-zinc-500 hover:text-zinc-300 transition-colors p-0.5 rounded hover:bg-white/5 cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
