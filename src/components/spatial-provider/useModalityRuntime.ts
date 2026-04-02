import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { DOMScannerPolicy } from '../../core/DOMScanner';
import type {
  CommandInputMethod,
  DOMCapabilityMap,
  IntentAction,
  Modality,
  ResolutionStatus,
  VoiceState,
  GazeState,
  GestureState
} from '../../types';
import type { FaceNoseCursorController } from '../../utils/mediapipe';
import type { ActiveModalities } from './modalityPreferences';
import { useModalityPreferences } from './useModalityPreferences';
import { usePointerInteractionRuntime } from './usePointerInteractionRuntime';
import { useVoiceCommandRuntime } from './useVoiceCommandRuntime';
import type { VoiceGazeSnapshot } from './runtimeState';

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
  const {
    activeModalities,
    isMicrophoneEnabled,
    isMicrophoneEnabledRef,
    canToggleModalities,
    handleModalityToggle
  } = useModalityPreferences({
    availableModalities,
    modalityStorageKey
  });

  const { gaze, gesture, gazeRef, pointerTracker } = usePointerInteractionRuntime({
    activeModalities,
    domMapRef,
    domScannerPolicy,
    setDomMap,
    setLastIntent,
    setResolutionStatus,
    setProgressMessage,
    showPreview
  });

  const { voice, isAudioCapturing } = useVoiceCommandRuntime({
    availableModalities,
    isMicrophoneEnabled,
    isMicrophoneEnabledRef,
    gazeRef,
    gazeEnabled: activeModalities.gaze,
    executeCommand
  });

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
