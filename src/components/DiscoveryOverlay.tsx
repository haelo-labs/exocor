import React from 'react';
import { resolveSdkTheme, type SdkThemeMode } from '../core/sdkTheme';
import { SDK_UI_MARKER } from '../core/sdkUi';

interface DiscoveryOverlayProps {
  open: boolean;
  themeMode?: SdkThemeMode;
}

export function DiscoveryOverlay({
  open,
  themeMode = 'dark'
}: DiscoveryOverlayProps): JSX.Element | null {
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
        data-exocor-text="discovery-overlay"
        aria-live="polite"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
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
        <span {...SDK_UI_MARKER}>Analyzing app structure...</span>
      </div>
    </div>
  );
}
