import * as React from 'react';
import { SDK_UI_MARKER } from '../../core/sdkUi';

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={className}
      {...SDK_UI_MARKER}
      style={{
        borderRadius: 12,
        border: '1px solid #262626',
        background: '#18181b',
        color: '#f4f4f5',
        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.16)',
        fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        ...style
      }}
      {...props}
    />
  )
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={className}
      {...SDK_UI_MARKER}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 16,
        ...style
      }}
      {...props}
    />
  )
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, style, ...props }, ref) => (
    <h3
      ref={ref}
      className={className}
      {...SDK_UI_MARKER}
      style={{
        margin: 0,
        fontSize: 16,
        lineHeight: '20px',
        fontWeight: 600,
        ...style
      }}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={className}
      {...SDK_UI_MARKER}
      style={{
        padding: '0 16px 16px',
        ...style
      }}
      {...props}
    />
  )
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, style, ...props }, ref) => (
    <div
      ref={ref}
      className={className}
      {...SDK_UI_MARKER}
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px 16px',
        ...style
      }}
      {...props}
    />
  )
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardTitle, CardContent, CardFooter };
