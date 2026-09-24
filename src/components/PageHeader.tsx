import React from 'react';

interface PageHeaderProps {
  title: string;
  description?: string;
  icon?: React.ComponentType<{ className?: string }>;
  actions?: React.ReactNode;
}

// One header for every page: optional icon box, title, one-line description, actions on the right.
export default function PageHeader({ title, description, icon: Icon, actions }: PageHeaderProps) {
  return (
    <div className="page-header">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <span className="metric-icon">
            <Icon className="w-4 h-4 text-foreground" />
          </span>
        )}
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {description && <p className="page-subtitle">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
