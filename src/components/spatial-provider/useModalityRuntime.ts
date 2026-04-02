import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import * as DOMScannerModule from '../../core/DOMScanner';
import type { DOMScannerPolicy } from '../../core/DOMScanner';
import { isSdkUiElement } from '../../core/sdkUi';
import type {
  CommandInputMethod,
  DOMCapabilityMap,
  GazeState,
  GestureState,
  IntentAction,
  Modality,
  ResolutionStatus,
  VoiceState
} from '../../types';
import {
  createSpeechController,
  type SpeechController
} from '../../utils/speech';
import {
  useFaceNoseCursor,
  type FaceNoseCursorController
} from '../../utils/mediapipe';
import {
  createActiveModalities,
  EMPTY_GAZE_STATE,
  EMPTY_GESTURE_STATE,
  findElementByNode,
  isTextEntryElement,
  normalizeActiveModalities,
  normalizeCommand,
  readPersistedActiveModalities,
  resolveSelectorForElement,
  SILENCE_TIMEOUT_MS,
  type ActiveModalities,
  type VoiceGazeSnapshot
} from './shared';

interface UseModalityRuntimeOptions {
  availableModalities: readonly Modality[];
  modalityStorageKey: string;
  domMapRef: MutableRefObject<DOMCapabilityMap>;
  domScannerPolicy: DOMScannerPolicy;
  setDomMap: Dispatch<SetStateAction<DOMCapabilityMap>>;
  executeCommand: (
    command: string,
    inputMethod?: CommandInputMethod,
    voiceGazeSnapshot?: VoiceGazeSnapshot | null
  ) => Promise<boolean>;
  setLastIntent: Dispatch<SetStateAction<IntentAction | null>>;
  setResolutionStatus: Dispatch<SetStateAction<ResolutionStatus>>;
  setProgressMessage: Dispatch<SetStateAction<string | null>>;
  showPreview: (value: string | null) => void;
}

interface ModalityRuntime {
  voice: VoiceState;
  gaze: GazeState;
  gesture: GestureState;
  activeModalities: ActiveModalities;
  isAudioCapturing: boolean;
  isMicrophoneEnabled: boolean;
  canToggleModalities: Record<Modality, boolean>;
  handleModalityToggle: (modality: Modality) => void;
  pointerTracker: FaceNoseCursorController;
}

export function useModalityRuntime({
  availableModalities,
  modalityStorageKey,
  domMapRef,
  domScannerPolicy,
  setDomMap,
  executeCommand,
  setLastIntent,
  setResolutionStatus,
  setProgressMessage,
  showPreview
}: UseModalityRuntimeOptions): ModalityRuntime {
  const [voice, setVoice] = useState<VoiceState>({ transcript: '', isListening: false, confidence: 0 });
  const [gaze, setGaze] = useState<GazeState>(EMPTY_GAZE_STATE);
  const [gesture, setGesture] = useState<GestureState>(EMPTY_GESTURE_STATE);
  const [activeModalities, setActiveModalities] = useState<ActiveModalities>(() =>
    createActiveModalities(availableModalities, readPersistedActiveModalities(modalityStorageKey))
  );
  const [isAudioCapturing, setIsAudioCapturing] = useState(false);

  const speechControllerRef = useRef<SpeechController | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const audioCaptureTimerRef = useRef<number | null>(null);
  const lastVoiceSubmissionRef = useRef('');
  const voiceGazeSnapshotRef = useRef<VoiceGazeSnapshot | null>(null);
  const previousAvailableModalitiesRef = useRef<readonly Modality[]>(availableModalities);
  const activeModalitiesRef = useRef(activeModalities);
  const gazeRef = useRef(gaze);
  const microphoneEnabledRef = useRef(activeModalities.voice);

  const isMicrophoneEnabled = activeModalities.voice;

  useEffect(() => {
    activeModalitiesRef.current = activeModalities;
  }, [activeModalities]);

  useEffect(() => {
    gazeRef.current = gaze;
  }, [gaze]);

  useEffect(() => {
    microphoneEnabledRef.current = isMicrophoneEnabled;
  }, [isMicrophoneEnabled]);

  useEffect(() => {
    const persisted = readPersistedActiveModalities(modalityStorageKey);
    const carriedForward = previousAvailableModalitiesRef.current.reduce<Partial<ActiveModalities>>((result, modality) => {
      if (availableModalities.includes(modality)) {
        result[modality] = activeModalitiesRef.current[modality];
      }
      return result;
    }, {});

    const next = createActiveModalities(availableModalities, carriedForward, persisted);
    previousAvailableModalitiesRef.current = availableModalities;

    setActiveModalities((previous) =>
      previous.voice === next.voice &&
      previous.gaze === next.gaze &&
      previous.gesture === next.gesture
        ? previous
        : next
    );
  }, [availableModalities, modalityStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(modalityStorageKey, JSON.stringify(activeModalities));
  }, [activeModalities, modalityStorageKey]);

  const canToggleModalities = useMemo(
    () => ({
      voice: availableModalities.includes('voice'),
      gaze: availableModalities.includes('gaze'),
      gesture: availableModalities.includes('gesture')
    }),
    [availableModalities]
  );

  const handleModalityToggle = useCallback(
    (modality: Modality) => {
      if (!canToggleModalities[modality]) {
        return;
      }

      setActiveModalities((previous) => {
        const next = {
          ...previous,
          [modality]: !previous[modality]
        };

        if (modality === 'gaze' && previous.gaze) {
          next.gesture = false;
        }

        return normalizeActiveModalities(availableModalities, next);
      });
    },
    [availableModalities, canToggleModalities]
  );

  const onGazeSample = useCallback((sample: { x: number; y: number; target: HTMLElement | null; isCalibrated: boolean }) => {
    if (!activeModalitiesRef.current.gaze) {
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
  }, [domMapRef, domScannerPolicy, setDomMap]);

  const onPinchState = useCallback((sample: { isPinching: boolean }) => {
    if (!activeModalitiesRef.current.gesture) {
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
  }, []);

  const onPinchClick = useCallback(
    (sample: { target: Element | null; x: number; y: number }) => {
      if (!activeModalitiesRef.current.gesture) {
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
    [setLastIntent, setProgressMessage, setResolutionStatus, showPreview]
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

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const captureVoiceGazeSnapshot = useCallback((): VoiceGazeSnapshot => {
    const snapshot: VoiceGazeSnapshot = {
      gazeTarget: gazeRef.current.gazeTarget,
      gazeX: gazeRef.current.gazeX,
      gazeY: gazeRef.current.gazeY,
      isCalibrated: gazeRef.current.isCalibrated
    };
    voiceGazeSnapshotRef.current = snapshot;
    return snapshot;
  }, []);

  const resetVoiceGazeSnapshot = useCallback(() => {
    voiceGazeSnapshotRef.current = null;
  }, []);

  useEffect(() => {
    if (activeModalities.gaze) {
      return;
    }

    resetVoiceGazeSnapshot();
    setGaze((previous) =>
      previous.gazeTarget || previous.gazeX !== 0 || previous.gazeY !== 0 || previous.isCalibrated
        ? EMPTY_GAZE_STATE
        : previous
    );
  }, [activeModalities.gaze, resetVoiceGazeSnapshot]);

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

  const clearVoiceTranscript = useCallback(() => {
    setVoice((previous) => {
      if (!previous.transcript && previous.confidence === 0) {
        return previous;
      }

      return {
        ...previous,
        transcript: '',
        confidence: 0
      };
    });
  }, []);

  const resetVoiceUtteranceState = useCallback(() => {
    clearSilenceTimer();
    resetVoiceGazeSnapshot();
  }, [clearSilenceTimer, resetVoiceGazeSnapshot]);

  const submitVoiceCommand = useCallback(
    (normalized: string, gazeSnapshot: VoiceGazeSnapshot) => {
      if (normalized === lastVoiceSubmissionRef.current) {
        return;
      }

      clearSilenceTimer();
      resetVoiceGazeSnapshot();
      lastVoiceSubmissionRef.current = normalized;
      clearVoiceTranscript();
      speechControllerRef.current?.restart();
      const pendingExecution = executeCommand(normalized, 'voice', gazeSnapshot);
      void pendingExecution.then((accepted) => {
        if (!accepted && lastVoiceSubmissionRef.current === normalized) {
          lastVoiceSubmissionRef.current = '';
        }
      });
    },
    [clearSilenceTimer, clearVoiceTranscript, executeCommand, resetVoiceGazeSnapshot]
  );

  useEffect(() => {
    if (!availableModalities.includes('voice')) {
      speechControllerRef.current?.destroy();
      speechControllerRef.current = null;
      resetVoiceUtteranceState();
      clearVoiceTranscript();
      lastVoiceSubmissionRef.current = '';
      if (audioCaptureTimerRef.current) {
        window.clearTimeout(audioCaptureTimerRef.current);
        audioCaptureTimerRef.current = null;
      }
      setIsAudioCapturing(false);
      setVoice((previous) => ({
        ...previous,
        transcript: '',
        isListening: false,
        confidence: 0
      }));
      return;
    }

    const speech = createSpeechController({
      continuous: true,
      lang: 'en-US',
      onTranscript: ({ transcript, confidence, isFinal }) => {
        setVoice((previous) => ({
          ...previous,
          transcript,
          confidence
        }));

        const hasAudio = Boolean(transcript.trim());
        if (hasAudio && microphoneEnabledRef.current) {
          setIsAudioCapturing(true);
          if (audioCaptureTimerRef.current) {
            window.clearTimeout(audioCaptureTimerRef.current);
          }
          audioCaptureTimerRef.current = window.setTimeout(() => {
            setIsAudioCapturing(false);
          }, 450);
        }

        const normalized = normalizeCommand(transcript);
        if (!normalized) {
          return;
        }

        const gazeSnapshot = voiceGazeSnapshotRef.current || captureVoiceGazeSnapshot();
        if (isFinal) {
          submitVoiceCommand(normalized, gazeSnapshot);
          return;
        }

        clearSilenceTimer();
        silenceTimerRef.current = window.setTimeout(() => {
          submitVoiceCommand(normalized, gazeSnapshot);
        }, SILENCE_TIMEOUT_MS);
      },
      onListening: (listening) => {
        if (listening) {
          lastVoiceSubmissionRef.current = '';
        }
        setVoice((previous) => ({
          ...previous,
          isListening: listening
        }));
        if (!listening) {
          resetVoiceUtteranceState();
          clearVoiceTranscript();
          if (audioCaptureTimerRef.current) {
            window.clearTimeout(audioCaptureTimerRef.current);
            audioCaptureTimerRef.current = null;
          }
          setIsAudioCapturing(false);
        }
      },
      onError: () => {
        lastVoiceSubmissionRef.current = '';
        setVoice((previous) => ({
          ...previous,
          transcript: '',
          isListening: false,
          confidence: 0
        }));
        resetVoiceUtteranceState();
        if (audioCaptureTimerRef.current) {
          window.clearTimeout(audioCaptureTimerRef.current);
          audioCaptureTimerRef.current = null;
        }
        setIsAudioCapturing(false);
      }
    });

    speechControllerRef.current = speech;
    if (microphoneEnabledRef.current && speech.isSupported) {
      speech.start();
    }

    return () => {
      resetVoiceUtteranceState();
      clearVoiceTranscript();
      lastVoiceSubmissionRef.current = '';
      if (audioCaptureTimerRef.current) {
        window.clearTimeout(audioCaptureTimerRef.current);
        audioCaptureTimerRef.current = null;
      }
      speech.destroy();
      speechControllerRef.current = null;
    };
  }, [
    availableModalities,
    captureVoiceGazeSnapshot,
    clearSilenceTimer,
    clearVoiceTranscript,
    executeCommand,
    resetVoiceUtteranceState,
    submitVoiceCommand
  ]);

  useEffect(() => {
    if (!availableModalities.includes('voice')) {
      return;
    }

    const speech = speechControllerRef.current;
    if (!speech?.isSupported) {
      return;
    }

    if (isMicrophoneEnabled) {
      speech.start();
      return;
    }

    resetVoiceUtteranceState();
    if (audioCaptureTimerRef.current) {
      window.clearTimeout(audioCaptureTimerRef.current);
      audioCaptureTimerRef.current = null;
    }
    speech.stop();
    setIsAudioCapturing(false);
    clearVoiceTranscript();
    lastVoiceSubmissionRef.current = '';
    setVoice((previous) => ({
      ...previous,
      transcript: '',
      isListening: false,
      confidence: 0
    }));
  }, [availableModalities, clearVoiceTranscript, isMicrophoneEnabled, resetVoiceUtteranceState]);

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

  useEffect(() => {
    return () => {
      if (audioCaptureTimerRef.current) {
        window.clearTimeout(audioCaptureTimerRef.current);
      }
    };
  }, []);

  return {
    voice,
    gaze,
    gesture,
    activeModalities,
    isAudioCapturing,
    isMicrophoneEnabled,
    canToggleModalities,
    handleModalityToggle,
    pointerTracker
  };
}
