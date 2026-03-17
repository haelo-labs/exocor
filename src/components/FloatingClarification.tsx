import React from 'react';
import { SDK_UI_MARKER } from '../core/sdkUi';
import { resolveSdkTheme, type SdkThemeMode } from '../core/sdkTheme';

interface FloatingClarificationProps {
  open: boolean;
  question: string | null;
  themeMode?: SdkThemeMode;
}

export function FloatingClarification({
  open,
  question,
  themeMode = 'dark'
}: FloatingClarificationProps): JSX.Element | null {
  if (!open || !question) {
    return null;
  }

  const theme = resolveSdkTheme(themeMode);

  return (
    <div
      {...SDK_UI_MARKER}
      style={{
        position: 'fixed',
        left: '50%',
        top: 24,
        transform: 'translateX(-50%)',
        zIndex: 2147483646,
        pointerEvents: 'none',
        maxWidth: 'calc(100vw - 48px)'
      }}
    >
      <div
        {...SDK_UI_MARKER}
        style={{
          display: 'inline-flex',
          alignItems: 'flex-start',
          borderRadius: 16,
          border: `1px solid ${theme.clarificationBorder}`,
          background: theme.clarificationSurface,
          boxShadow: theme.clarificationShadow,
          color: theme.textPrimary,
          padding: themeMode === 'light' ? '16px 24px' : '16px 24px 17px',
          maxWidth: 'min(760px, calc(100vw - 48px))'
        }}
      >
        <div
          {...SDK_UI_MARKER}
          data-exocor-text="floating-clarification"
          style={{
            color: theme.textPrimary,
            fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 20,
            lineHeight: '28px',
            fontWeight: theme.clarificationTextWeight,
            letterSpacing: '-0.2px',
            whiteSpace: 'normal',
            wordBreak: 'break-word'
          }}
        >
          {question}
        </div>
      </div>
    </div>
  );
}
