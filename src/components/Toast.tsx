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
          // Themed card; the type shows as a tinted icon tile + a coloured left edge.
          let Icon = AlertCircle;
          let tone = 'bg-accent-violet/10 border-accent-violet/25 text-accent-violet';
          let edge = 'var(--accent-violet)';
          if (t.type === 'success') {
            Icon = CheckCircle2;
            tone = 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500';
            edge = '#10b981';
          } else if (t.type === 'error') {
            Icon = XCircle;
            tone = 'bg-rose-500/10 border-rose-500/25 text-rose-500';
            edge = '#f43f5e';
          }

          return (
            <div
              key={t.id}
              role={t.type === 'error' ? 'alert' : 'status'}
              style={{ boxShadow: `inset 3px 0 0 ${edge}` }}
              className="toast-card flex items-start gap-3 p-3 rounded-xl transition-all duration-300 pointer-events-auto animate-slide-in"
            >
              <span className={`w-8 h-8 rounded-[10px] border flex items-center justify-center shrink-0 ${tone}`}>
                <Icon className="w-4 h-4" />
              </span>
              <p className="text-[13px] font-medium leading-relaxed flex-1 pt-1.5">{t.message}</p>
              <button
                type="button"
                onClick={() => removeToast(t.id)}
                aria-label="Dismiss"
                className="cal-nav shrink-0"
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
