import React from 'react';
import { SDK_UI_MARKER } from '../core/sdkUi';
import { resolveSdkTheme, type SdkThemeMode } from '../core/sdkTheme';

export type StatusIndicatorState = 'idle' | 'listening' | 'executing';

interface StatusIndicatorProps {
  className?: string;
  status?: StatusIndicatorState;
  themeMode?: SdkThemeMode;
}

export function StatusIndicator({
  className,
  status = 'idle',
  themeMode = 'dark'
}: StatusIndicatorProps): JSX.Element {
  const theme = resolveSdkTheme(themeMode);
  const tone = theme.status[status];
  const shouldPulse = status !== 'idle';

  return (
    <span
      {...SDK_UI_MARKER}
      className={className}
      aria-hidden="true"
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: 8,
        height: 8,
        alignItems: 'center',
        justifyContent: 'center'
      }}
    >
      {shouldPulse ? (
        <span
          {...SDK_UI_MARKER}
          style={{
            position: 'absolute',
            left: '50%',
            top: '50%',
            width: 12,
            height: 12,
            borderRadius: '50%',
            transform: 'translate(-50%, -50%)',
            background: tone.ring,
            animation: 'exocor-status-ring-pulse 1.12s ease-out infinite'
          }}
        />
      ) : null}
      <span
        {...SDK_UI_MARKER}
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: 8,
          height: 8,
          borderRadius: '50%',
          transform: 'translate(-50%, -50%)',
          background: tone.dot,
          animation: shouldPulse ? 'exocor-status-dot-pulse 1.12s ease-in-out infinite' : 'none'
        }}
      />
    </span>
  );
}
