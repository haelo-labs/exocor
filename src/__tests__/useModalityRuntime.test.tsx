import React, { useRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DOMCapabilityMap } from '../types';
import { emptyMap } from '../components/spatial-provider/shared';
import { useModalityRuntime } from '../components/spatial-provider/useModalityRuntime';

vi.mock('../utils/speech', () => ({
  createSpeechController: () => ({
    isSupported: true,
    start: vi.fn(),
    stop: vi.fn(),
    restart: vi.fn(),
    destroy: vi.fn()
  })
}));

vi.mock('../utils/mediapipe', () => ({
  useFaceNoseCursor: () => ({
    videoRef: { current: null },
    cursorRef: { current: null },
    dragCursorRef: { current: null },
    isTracking: false,
    isPinching: false,
    isDragging: false,
    isLoading: false,
    showCursor: false,
    status: 'Idle',
    error: '',
    startTracking: async () => {},
    stopTracking: () => {},
    recalibrate: () => {}
  })
}));

function ModalityHarness({
  availableModalities = ['voice', 'gaze', 'gesture']
}: {
  availableModalities?: Array<'voice' | 'gaze' | 'gesture'>;
}) {
  const domMapRef = useRef<DOMCapabilityMap>(emptyMap);
  const runtime = useModalityRuntime({
    availableModalities,
    modalityStorageKey: 'exocor.modality-test',
    domMapRef,
    domScannerPolicy: {
      reactHints: true,
      routerHints: true,
      excludedSelectors: [],
      captureElements: true
    },
    setDomMap: vi.fn(),
    executeCommand: async () => true,
    setLastIntent: vi.fn(),
    setResolutionStatus: vi.fn(),
    setProgressMessage: vi.fn(),
    showPreview: vi.fn()
  });

  return (
    <div>
      <button onClick={() => runtime.handleModalityToggle('gaze')}>toggle-gaze</button>
      <button onClick={() => runtime.handleModalityToggle('gesture')}>toggle-gesture</button>
      <div data-testid="modalities">{JSON.stringify(runtime.activeModalities)}</div>
      <div data-testid="can-toggle">{JSON.stringify(runtime.canToggleModalities)}</div>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('useModalityRuntime', () => {
  it('defaults to gaze and gesture on while leaving voice off', () => {
    render(<ModalityHarness />);

    expect(screen.getByTestId('modalities').textContent).toBe('{"voice":false,"gaze":true,"gesture":true}');
  });

  it('keeps gesture dependent on gaze when toggled', () => {
    render(<ModalityHarness />);

    fireEvent.click(screen.getByText('toggle-gaze'));
    expect(screen.getByTestId('modalities').textContent).toBe('{"voice":false,"gaze":false,"gesture":false}');

    fireEvent.click(screen.getByText('toggle-gesture'));
    expect(screen.getByTestId('modalities').textContent).toBe('{"voice":false,"gaze":true,"gesture":true}');
  });
});
