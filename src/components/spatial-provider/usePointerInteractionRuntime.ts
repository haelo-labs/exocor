import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import * as DOMScannerModule from '../../core/DOMScanner';
import type { DOMScannerPolicy } from '../../core/DOMScanner';
import { isSdkUiElement } from '../../core/sdkUi';
import type { DOMCapabilityMap, GazeState, GestureState, IntentAction } from '../../types';
import { useFaceNoseCursor, type FaceNoseCursorController } from '../../utils/mediapipe';
import { EMPTY_GAZE_STATE, EMPTY_GESTURE_STATE } from './runtimeState';
import { findElementByNode, resolveSelectorForElement } from './hostDomUtils';
import type { ActiveModalities } from './modalityPreferences';

interface UsePointerInteractionRuntimeOptions {
  activeModalities: ActiveModalities;
  domMapRef: MutableRefObject<DOMCapabilityMap>;
  domScannerPolicy: DOMScannerPolicy;
  setDomMap: Dispatch<SetStateAction<DOMCapabilityMap>>;
  setLastIntent: Dispatch<SetStateAction<IntentAction | null>>;
  setResolutionStatus: Dispatch<SetStateAction<'idle' | 'resolving' | 'executed' | 'failed' | 'unresolved'>>;
  setProgressMessage: Dispatch<SetStateAction<string | null>>;
  showPreview: (value: string | null) => void;
}

interface PointerInteractionRuntime {
  gaze: GazeState;
  gesture: GestureState;
  gazeRef: MutableRefObject<GazeState>;
  pointerTracker: FaceNoseCursorController;
}

export function usePointerInteractionRuntime({
  activeModalities,
  domMapRef,
  domScannerPolicy,
  setDomMap,
  setLastIntent,
  setResolutionStatus,
  setProgressMessage,
  showPreview
}: UsePointerInteractionRuntimeOptions): PointerInteractionRuntime {
  const [gaze, setGaze] = useState<GazeState>(EMPTY_GAZE_STATE);
  const [gesture, setGesture] = useState<GestureState>(EMPTY_GESTURE_STATE);
  const gazeRef = useRef(gaze);

  useEffect(() => {
    gazeRef.current = gaze;
  }, [gaze]);

  const onGazeSample = useCallback((sample: { x: number; y: number; target: HTMLElement | null; isCalibrated: boolean }) => {
    if (!activeModalities.gaze) {
      setGaze((previous) =>
        previous.gazeTarget || previous.gazeX !== 0 || previous.gazeY !== 0 || previous.isCalibrated
          ? EMPTY_GAZE_STATE
          : previous
      );
      return;
    }

    const targetSelector = sample.target ? resolveSelectorForElement(sample.target) : null;
    const directMatch =
      sample.target instanceof HTMLElement ? findElementByNode(sample.target, domMapRef.current.elements) : null;
    const selectorMatch = targetSelector
      ? domMapRef.current.elements.find((element) => element.selector === targetSelector)
      : null;
    let targetId = directMatch?.id || selectorMatch?.id || null;

    if (!targetId && sample.target instanceof HTMLElement) {
      const liveMap = DOMScannerModule.scanDOM(domScannerPolicy);
      const liveMatch =
        findElementByNode(sample.target, liveMap.elements) ||
        (targetSelector ? liveMap.elements.find((element) => element.selector === targetSelector) || null : null);

      if (liveMatch) {
        targetId = liveMatch.id;
        setDomMap(liveMap);
      } else if (targetSelector) {
        targetId = targetSelector;
      }
    }

    setGaze({
      gazeTarget: targetId,
      gazeX: sample.x,
      gazeY: sample.y,
      isCalibrated: sample.isCalibrated
    });
  }, [activeModalities.gaze, domMapRef, domScannerPolicy, setDomMap]);

  const onPinchState = useCallback((sample: { isPinching: boolean }) => {
    if (!activeModalities.gesture) {
      setGesture((previous) =>
        previous.gesture !== 'none' || previous.hand !== 'unknown' || previous.confidence !== 0
          ? EMPTY_GESTURE_STATE
          : previous
      );
      return;
    }

    setGesture({
      gesture: sample.isPinching ? 'pinch' : 'none',
      hand: 'unknown',
      confidence: sample.isPinching ? 0.9 : 0
    });
  }, [activeModalities.gesture]);

  const onPinchClick = useCallback(
    (sample: { target: Element | null; x: number; y: number }) => {
      if (!activeModalities.gesture) {
        return;
      }

      const targetSelector =
        sample.target && !isSdkUiElement(sample.target) ? resolveSelectorForElement(sample.target) : null;
      if (!targetSelector) {
        return;
      }

      const pinchIntent: IntentAction = {
        action: 'click',
        target: targetSelector,
        value: null,
        confidence: 0.9,
        source: 'manual',
        rawCommand: 'pinch click'
      };

      setLastIntent(pinchIntent);
      setResolutionStatus('executed');
      setProgressMessage('Pinch click executed');
      showPreview('Pinch click executed');
    },
    [activeModalities.gesture, setLastIntent, setProgressMessage, setResolutionStatus, showPreview]
  );

  const pointerTrackerOptions = useMemo(
    () => ({
      gestureEnabled: activeModalities.gesture,
      onGaze: onGazeSample,
      onPinchState,
      onPinchClick
    }),
    [activeModalities.gesture, onGazeSample, onPinchClick, onPinchState]
  );

  const pointerTracker = useFaceNoseCursor(pointerTrackerOptions);

  useEffect(() => {
    if (activeModalities.gaze) {
      return;
    }

    setGaze((previous) =>
      previous.gazeTarget || previous.gazeX !== 0 || previous.gazeY !== 0 || previous.isCalibrated
        ? EMPTY_GAZE_STATE
        : previous
    );
  }, [activeModalities.gaze]);

  useEffect(() => {
    if (activeModalities.gesture) {
      return;
    }

    setGesture((previous) =>
      previous.gesture !== 'none' || previous.hand !== 'unknown' || previous.confidence !== 0
        ? EMPTY_GESTURE_STATE
        : previous
    );
  }, [activeModalities.gesture]);

  useEffect(() => {
    const needsPointerTracking = activeModalities.gaze || activeModalities.gesture;
    if (!needsPointerTracking) {
      pointerTracker.stopTracking();
      return;
    }

    void pointerTracker.startTracking();

    return () => {
      pointerTracker.stopTracking();
    };
  }, [activeModalities.gaze, activeModalities.gesture, pointerTracker]);

  return {
    gaze,
    gesture,
    gazeRef,
    pointerTracker
  };
}
