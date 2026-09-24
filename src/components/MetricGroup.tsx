import React from 'react';

interface MetricGroupProps {
  children: React.ReactNode;
  className?: string;
}

// Outer container that holds a row of MetricCards, like a single bordered panel.
export default function MetricGroup({ children, className = '' }: MetricGroupProps) {
  return <div className={`glass metric-group grid ${className}`}>{children}</div>;
}
