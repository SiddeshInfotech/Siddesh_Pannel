import React from 'react';

interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  interactive?: boolean;
}

export default function GlassCard({ children, className = '', interactive = false }: GlassCardProps) {
  return (
    <div
      className={`glass rounded-2xl p-6 ${
        interactive ? 'glass-interactive cursor-pointer hover:shadow-xl' : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}
