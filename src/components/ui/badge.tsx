import * as React from 'react';
import { SDK_UI_MARKER } from '../../core/sdkUi';

type BadgeVariant = 'default' | 'success' | 'warning' | 'destructive';

const variantStyles: Record<BadgeVariant, React.CSSProperties> = {
  default: {
    borderColor: '#3f3f46',
    background: '#27272a',
    color: '#e4e4e7'
  },
  success: {
    borderColor: '#065f46',
    background: '#022c22',
    color: '#6ee7b7'
  },
  warning: {
    borderColor: '#92400e',
    background: '#451a03',
    color: '#fcd34d'
  },
  destructive: {
    borderColor: '#9f1239',
    background: '#4c0519',
    color: '#fda4af'
  }
};

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BadgeVariant;
}

function Badge({ className, style, variant = 'default', ...props }: BadgeProps): JSX.Element {
  return (
    <div
      className={className}
      {...SDK_UI_MARKER}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        borderRadius: 999,
        border: '1px solid transparent',
        padding: '2px 8px',
        fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 12,
        lineHeight: '16px',
        fontWeight: 500,
        transition: 'background-color 150ms ease, color 150ms ease, border-color 150ms ease',
        ...variantStyles[variant],
        ...style
      }}
      {...props}
    />
  );
}

export { Badge };
