import React, { createRef } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { GazeOverlay } from '../components/GazeOverlay';

describe('GazeOverlay', () => {
  it('renders a separate drag cursor and toggles its visibility', () => {
    const videoRef = createRef<HTMLVideoElement>();
    const cursorRef = createRef<HTMLDivElement>();
    const dragCursorRef = createRef<HTMLDivElement>();

    const { rerender } = render(
      <GazeOverlay
        videoRef={videoRef}
        cursorRef={cursorRef}
        dragCursorRef={dragCursorRef}
        visible
        isPinching
        showDragCursor
        gazeTarget="button-1"
        isDragging
        isCalibrated
      />
    );

    expect(cursorRef.current?.getAttribute('data-exocor-cursor')).toBe('gaze');
    expect(dragCursorRef.current?.getAttribute('data-exocor-cursor')).toBe('drag');
    expect(cursorRef.current?.style.opacity).toBe('1');
    expect(cursorRef.current?.children).toHaveLength(1);
    expect(dragCursorRef.current?.style.opacity).toBe('1');
    expect(dragCursorRef.current?.style.pointerEvents).toBe('none');

    cursorRef.current?.style.setProperty('transform', 'translate3d(40px, 55px, 0)');

    rerender(
      <GazeOverlay
        videoRef={videoRef}
        cursorRef={cursorRef}
        dragCursorRef={dragCursorRef}
        visible
        isPinching
        showDragCursor={false}
        gazeTarget="button-1"
        isDragging={false}
        isCalibrated
      />
    );

    expect(cursorRef.current?.style.transform).toBe('translate3d(40px, 55px, 0)');
    expect(dragCursorRef.current?.style.opacity).toBe('0');
  });
});
