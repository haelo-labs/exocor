import React from 'react';
import { SDK_UI_MARKER } from '../core/sdkUi';
import { resolveSdkTheme, type SdkThemeMode } from '../core/sdkTheme';

interface LearningOverlayProps {
  open: boolean;
  themeMode?: SdkThemeMode;
}

export function LearningOverlay({
  open,
  themeMode = 'dark'
}: LearningOverlayProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  const theme = resolveSdkTheme(themeMode);

  return (
    <div
      {...SDK_UI_MARKER}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2147483646,
        background: theme.discoveryBackdrop,
        backdropFilter: 'blur(28px)',
        WebkitBackdropFilter: 'blur(28px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 10
      }}
    >
      <div
        {...SDK_UI_MARKER}
        data-exocor-text="learning-overlay"
        aria-live="polite"
        style={{
          display: 'inline-flex',
          alignItems: 'baseline',
          justifyContent: 'center',
          color: theme.textPrimary,
          fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontSize: 24,
          fontWeight: 500,
          lineHeight: '140%',
          letterSpacing: '-0.36px',
          whiteSpace: 'nowrap'
        }}
      >
        <span {...SDK_UI_MARKER}>Learning your app</span>
        <span {...SDK_UI_MARKER} aria-hidden="true" style={{ display: 'inline-flex' }}>
          <span {...SDK_UI_MARKER} style={{ animation: 'exocor-learning-dot-1 1.2s infinite steps(1, end)' }}>
            .
          </span>
          <span {...SDK_UI_MARKER} style={{ animation: 'exocor-learning-dot-2 1.2s infinite steps(1, end)' }}>
            .
          </span>
          <span {...SDK_UI_MARKER} style={{ animation: 'exocor-learning-dot-3 1.2s infinite steps(1, end)' }}>
            .
          </span>
        </span>
      </div>
    </div>
  );
}
