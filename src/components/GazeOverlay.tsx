import React, { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { SDK_UI_MARKER } from '../core/sdkUi';
import { resolveSdkTheme, type SdkThemeMode } from '../core/sdkTheme';

interface GazeOverlayProps {
  videoRef: RefObject<HTMLVideoElement>;
  cursorRef: RefObject<HTMLDivElement>;
  dragCursorRef: RefObject<HTMLDivElement>;
  visible: boolean;
  isPinching: boolean;
  showDragCursor: boolean;
  gazeTarget?: string | null;
  isDragging?: boolean;
  isCalibrated?: boolean;
  hoverRect?: { x: number; y: number; width: number; height: number } | null;
  themeMode?: SdkThemeMode;
}

const DWELL_LOCK_MS = 650;

/** Renders a Figma-aligned gaze cursor with a hover ring and drag indicator. */
export function GazeOverlay({
  videoRef,
  cursorRef,
  dragCursorRef,
  visible,
  isPinching,
  showDragCursor,
  gazeTarget,
  isDragging = false,
  isCalibrated = false,
  hoverRect = null,
  themeMode = 'dark'
}: GazeOverlayProps): JSX.Element {
  const theme = resolveSdkTheme(themeMode);
  const [dwellProgress, setDwellProgress] = useState(0);
  const dwellStartRef = useRef<number | null>(null);
  const dwellTargetRef = useRef<string | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (!visible || !isCalibrated || !gazeTarget) {
      dwellStartRef.current = null;
      dwellTargetRef.current = null;
      setDwellProgress(0);
      return;
    }

    if (dwellTargetRef.current !== gazeTarget) {
      dwellTargetRef.current = gazeTarget;
      dwellStartRef.current = performance.now();
      setDwellProgress(0);
    }

    const tick = (): void => {
      const startedAt = dwellStartRef.current ?? performance.now();
      const nextProgress = Math.min(1, (performance.now() - startedAt) / DWELL_LOCK_MS);
      setDwellProgress(nextProgress);
      if (nextProgress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(tick);
      } else {
        animationFrameRef.current = null;
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [gazeTarget, isCalibrated, visible]);

  const cursorTone = useMemo(
    () =>
      isPinching || isDragging
        ? {
            border: theme.gazeClickRing,
            glow: theme.gazeClickGlow,
            center: theme.gazeClickCenter
          }
        : {
            border: theme.gazeRing,
            glow: theme.gazeGlow,
            center: theme.gazeCenter
          },
    [isDragging, isPinching, theme.gazeCenter, theme.gazeClickCenter, theme.gazeClickGlow, theme.gazeClickRing, theme.gazeGlow, theme.gazeRing]
  );

  const hoverFrameVisible =
    visible &&
    isCalibrated &&
    hoverRect &&
    hoverRect.width > 0 &&
    hoverRect.height > 0 &&
    !isDragging &&
    !isPinching;

  return (
    <div {...SDK_UI_MARKER} data-face-ignore="true" aria-hidden="true">
      <video
        ref={videoRef}
        {...SDK_UI_MARKER}
        data-face-ignore="true"
        muted
        playsInline
        style={{
          position: 'fixed',
          width: 1,
          height: 1,
          opacity: 0,
          pointerEvents: 'none',
          left: 0,
          bottom: 0,
          zIndex: -1
        }}
      />
      <div
        {...SDK_UI_MARKER}
        style={{
          position: 'fixed',
          left: hoverRect ? hoverRect.x - 2 : -1000,
          top: hoverRect ? hoverRect.y - 2 : -1000,
          width: hoverRect ? hoverRect.width + 4 : 0,
          height: hoverRect ? hoverRect.height + 4 : 0,
          borderRadius: 8,
          border: `2px solid ${theme.hoverRing}`,
          boxShadow: `0 0 0 2px ${theme.hoverRingShadow}`,
          opacity: hoverFrameVisible ? 1 : 0,
          pointerEvents: 'none',
          zIndex: 999997,
          transition:
            'left 120ms ease, top 120ms ease, width 120ms ease, height 120ms ease, opacity 120ms ease'
        }}
      />
      <div
        ref={cursorRef}
        {...SDK_UI_MARKER}
        data-exocor-cursor="gaze"
        data-face-ignore="true"
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          left: 0,
          top: 0,
          transform: 'translate3d(-1000px, -1000px, 0)',
          zIndex: 999999,
          width: 0,
          height: 0,
          opacity: visible ? 1 : 0,
          transition: 'transform 0.05s ease, opacity 140ms linear'
        }}
      >
        <div
          {...SDK_UI_MARKER}
          style={{
            width: 24,
            height: 24,
            borderRadius: '50%',
            position: 'fixed',
            transform: `translate(-50%, -50%) scale(${1 - dwellProgress * 0.04})`,
            border: `2px solid ${cursorTone.border}`,
            boxShadow: cursorTone.glow,
            background: 'transparent',
            pointerEvents: 'none',
            zIndex: 999999,
            transition: 'transform 90ms ease, border-color 120ms ease, box-shadow 120ms ease'
          }}
        >
          <div
            {...SDK_UI_MARKER}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 8,
              height: 8,
              borderRadius: '50%',
              transform: `translate(-50%, -50%) scale(${1 - dwellProgress * 0.05})`,
              background: cursorTone.center,
              transition: 'transform 90ms ease, background-color 120ms ease'
            }}
          />
        </div>
      </div>
      <div
        ref={dragCursorRef}
        {...SDK_UI_MARKER}
        data-exocor-cursor="drag"
        data-face-ignore="true"
        style={{
          position: 'fixed',
          pointerEvents: 'none',
          left: 0,
          top: 0,
          transform: 'translate3d(-1000px, -1000px, 0)',
          zIndex: 1000000,
          width: 0,
          height: 0,
          opacity: visible && showDragCursor ? 1 : 0,
          transition: 'transform 0.03s linear, opacity 100ms linear'
        }}
      >
        <div
          {...SDK_UI_MARKER}
          style={{
            width: 18,
            height: 18,
            borderRadius: '50%',
            position: 'fixed',
            transform: `translate(-50%, -50%) scale(${isDragging ? 1 : 0.96})`,
            border: `2px solid ${theme.dragRing}`,
            background: 'transparent',
            boxShadow: theme.dragGlow,
            pointerEvents: 'none',
            zIndex: 1000000,
            transition: 'transform 90ms ease, border-color 120ms ease, box-shadow 120ms ease'
          }}
        >
          <div
            {...SDK_UI_MARKER}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              width: 6,
              height: 6,
              borderRadius: '50%',
              transform: 'translate(-50%, -50%)',
              background: theme.dragCenter
            }}
          />
        </div>
      </div>
    </div>
  );
}
