import React from 'react';
import { SDK_UI_MARKER } from '../core/sdkUi';
import { resolveSdkTheme, type SdkThemeMode } from '../core/sdkTheme';

interface VoiceTranscriptBubbleProps {
  visible: boolean;
  transcript: string;
  x: number;
  y: number;
  themeMode?: SdkThemeMode;
}

/** Shows live captured voice transcript near the gaze cursor. */
export function VoiceTranscriptBubble({
  visible,
  transcript,
  x,
  y,
  themeMode = 'dark'
}: VoiceTranscriptBubbleProps): JSX.Element | null {
  const theme = resolveSdkTheme(themeMode);
  const text = transcript.trim();
  if (!visible || !text) {
    return null;
  }

  const anchorX = Number.isFinite(x) ? Math.round(x + 22) : 20;
  const anchorY = Number.isFinite(y) ? Math.round(y - 16) : 20;
  const bubbleShadow = themeMode === 'light' ? '1px 2px 8px rgba(0, 0, 0, 0.18)' : 'none';

  return (
    <div
      {...SDK_UI_MARKER}
      data-exocor-text="ui-body-sm"
      aria-hidden="true"
      style={{
        position: 'fixed',
        left: `clamp(12px, ${anchorX}px, calc(100vw - 312px))`,
        top: `clamp(12px, ${anchorY}px, calc(100vh - 58px))`,
        zIndex: 2147483646,
        pointerEvents: 'none',
        maxWidth: 300,
        borderRadius: 8,
        border: `0.5px solid ${theme.panelBorder}`,
        background: theme.panelSurface,
        color: theme.textPrimary,
        boxShadow: bubbleShadow,
        fontFamily: '"Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        fontSize: 12,
        lineHeight: 'normal',
        fontWeight: 500,
        letterSpacing: '0.06px',
        padding: '4px 8px',
        whiteSpace: 'normal',
        wordBreak: 'break-word'
      }}
    >
      {text}
    </div>
  );
}
