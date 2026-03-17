import React, { useState } from 'react';
import { StatusIndicator, type StatusIndicatorState } from './StatusIndicator';
import { CloseIcon } from './sdkIcons';
import { SDK_UI_MARKER } from '../core/sdkUi';
import { resolveSdkTheme, type SdkThemeMode } from '../core/sdkTheme';

interface EntryPointButtonProps {
  open: boolean;
  status?: StatusIndicatorState;
  onToggle: () => void;
  themeMode?: SdkThemeMode;
}

export function EntryPointButton({
  open,
  status = 'idle',
  onToggle,
  themeMode = 'dark'
}: EntryPointButtonProps): JSX.Element {
  const theme = resolveSdkTheme(themeMode);
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      {...SDK_UI_MARKER}
      style={{
        position: 'fixed',
        right: 24,
        bottom: 24,
        zIndex: 2147483646,
        pointerEvents: 'none'
      }}
    >
      <button
        {...SDK_UI_MARKER}
        type="button"
        onClick={onToggle}
        onPointerEnter={() => setIsHovered(true)}
        onPointerLeave={() => setIsHovered(false)}
        aria-label={open ? 'Close Exocor command panel' : 'Open Exocor command panel'}
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 48,
          height: 48,
          borderRadius: 16,
          border: `1px solid ${theme.panelBorder}`,
          background: isHovered ? theme.hoverSurface : theme.panelSurface,
          boxShadow: theme.entryPointShadow,
          cursor: 'pointer',
          padding: 0,
          color: theme.textPrimary,
          transition: 'background-color 150ms ease, border-color 150ms ease, transform 120ms ease'
        }}
      >
        {open ? <CloseIcon size={20} color={theme.textPrimary} /> : <StatusIndicator status={status} themeMode={themeMode} />}
      </button>
    </div>
  );
}
