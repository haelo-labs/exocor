import * as React from 'react';
import { SDK_UI_MARKER } from '../../core/sdkUi';

type ButtonVariant = 'default' | 'ghost' | 'outline' | 'secondary';
type ButtonSize = 'default' | 'sm' | 'lg' | 'icon';

const variantStyles: Record<ButtonVariant, React.CSSProperties> = {
  default: {
    background: '#f4f4f5',
    color: '#18181b',
    border: '1px solid rgba(228, 228, 231, 0.96)'
  },
  ghost: {
    background: 'transparent',
    color: '#f4f4f5',
    border: '1px solid transparent'
  },
  outline: {
    background: '#18181b',
    color: '#f4f4f5',
    border: '1px solid #262626'
  },
  secondary: {
    background: '#27272a',
    color: '#f4f4f5',
    border: '1px solid #262626'
  }
};

const sizeStyles: Record<ButtonSize, React.CSSProperties> = {
  default: {
    minHeight: 36,
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 14,
    lineHeight: '18px'
  },
  sm: {
    minHeight: 32,
    padding: '6px 12px',
    borderRadius: 8,
    fontSize: 12,
    lineHeight: '16px'
  },
  lg: {
    minHeight: 40,
    padding: '8px 32px',
    borderRadius: 8,
    fontSize: 14,
    lineHeight: '18px'
  },
  icon: {
    width: 36,
    height: 36,
    minHeight: 36,
    padding: 0,
    borderRadius: 8,
    fontSize: 14,
    lineHeight: '18px'
  }
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, style, variant = 'default', size = 'default', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={className}
      {...SDK_UI_MARKER}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        whiteSpace: 'nowrap',
        fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontWeight: 500,
        cursor: props.disabled ? 'default' : 'pointer',
        transition: 'background-color 150ms ease, color 150ms ease, border-color 150ms ease, opacity 150ms ease',
        outline: 'none',
        opacity: props.disabled ? 0.5 : 1,
        pointerEvents: props.disabled ? 'none' : undefined,
        ...sizeStyles[size],
        ...variantStyles[variant],
        ...style
      }}
      {...props}
    />
  )
);
Button.displayName = 'Button';

export { Button };
