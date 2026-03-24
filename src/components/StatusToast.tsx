import React from 'react';
import { SDK_UI_MARKER } from '../core/sdkUi';
import { resolveSdkTheme, type SdkThemeMode } from '../core/sdkTheme';

export type StatusToastVariant = 'planning' | 'executing' | 'done' | 'failed';

interface StatusToastProps {
  open: boolean;
  message: string;
  variant: StatusToastVariant;
  onDismiss: () => void;
  themeMode?: SdkThemeMode;
}

const LABELS: Record<StatusToastVariant, string> = {
  planning: 'Planning',
  executing: 'Executing',
  done: 'Done',
  failed: 'Failed'
};

export function StatusToast({
  open,
  message,
  variant,
  onDismiss,
  themeMode = 'dark'
}: StatusToastProps): JSX.Element {
  const theme = resolveSdkTheme(themeMode);
  const isFailed = variant === 'failed';

  return (
    <div
      {...SDK_UI_MARKER}
      aria-hidden={!open}
      role="status"
      aria-label={message || LABELS[variant]}
      onClick={onDismiss}
      style={{
        position: 'fixed',
        left: '50%',
        top: 20,
        transform: 'translateX(-50%)',
        zIndex: 2147483646,
        pointerEvents: 'none'
      }}
    >
      <div
        {...SDK_UI_MARKER}
        data-exocor-text="toast"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          minHeight: 34,
          padding: '8px 16px',
          borderRadius: 12,
          border: `0.5px solid ${isFailed ? theme.toastFailedBorder : theme.toastBorder}`,
          background: isFailed ? theme.toastFailedSurface : theme.toastSurface,
          color: isFailed ? theme.toastFailedText : theme.toastText,
          boxShadow: theme.entryPointShadow,
          fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 14,
          lineHeight: 'normal',
          fontWeight: 500,
          letterSpacing: '-0.07px',
          transform: open ? 'translateY(0)' : 'translateY(-12px)',
          opacity: open ? 1 : 0,
          transition: 'transform 180ms ease-out, opacity 160ms ease-out'
        }}
      >
        {LABELS[variant]}
      </div>
    </div>
  );
}
