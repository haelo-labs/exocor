import React from 'react';
import { resolveSdkTheme, type SdkThemeMode } from '../core/sdkTheme';
import { SDK_UI_MARKER } from '../core/sdkUi';

interface ClarificationPromptProps {
  open: boolean;
  question: string | null;
  themeMode?: SdkThemeMode;
}

export function ClarificationPrompt({
  open,
  question,
  themeMode = 'dark'
}: ClarificationPromptProps): JSX.Element | null {
  if (!open || !question) {
    return null;
  }

  const theme = resolveSdkTheme(themeMode);
  const borderRadius = themeMode === 'light' ? 24 : 16;
  const padding = themeMode === 'light' ? '16px 24px' : '16px 24px 17px';

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
          borderRadius,
          border: `0.5px solid ${theme.clarificationBorder}`,
          background: theme.clarificationSurface,
          boxShadow: theme.clarificationShadow,
          color: theme.textPrimary,
          padding,
          maxWidth: 'min(760px, calc(100vw - 48px))'
        }}
      >
        <div
          {...SDK_UI_MARKER}
          data-exocor-text="clarification-prompt"
          style={{
            color: theme.textPrimary,
            fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 20,
            lineHeight: '28px',
            fontWeight: 400,
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
