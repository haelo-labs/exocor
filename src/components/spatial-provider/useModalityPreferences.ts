import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { Modality } from '../../types';
import {
  createActiveModalities,
  normalizeActiveModalities,
  readPersistedActiveModalities,
  type ActiveModalities
} from './modalityPreferences';

interface UseModalityPreferencesOptions {
  availableModalities: readonly Modality[];
  modalityStorageKey: string;
}

interface ModalityPreferencesRuntime {
  activeModalities: ActiveModalities;
  activeModalitiesRef: MutableRefObject<ActiveModalities>;
  isMicrophoneEnabled: boolean;
  isMicrophoneEnabledRef: MutableRefObject<boolean>;
  canToggleModalities: Record<Modality, boolean>;
  handleModalityToggle: (modality: Modality) => void;
}

export function useModalityPreferences({
  availableModalities,
  modalityStorageKey
}: UseModalityPreferencesOptions): ModalityPreferencesRuntime {
  const [activeModalities, setActiveModalities] = useState<ActiveModalities>(() =>
    createActiveModalities(availableModalities, readPersistedActiveModalities(modalityStorageKey))
  );

  const activeModalitiesRef = useRef(activeModalities);
  const previousAvailableModalitiesRef = useRef<readonly Modality[]>(availableModalities);
  const isMicrophoneEnabled = activeModalities.voice;
  const isMicrophoneEnabledRef = useRef(isMicrophoneEnabled);

  useEffect(() => {
    activeModalitiesRef.current = activeModalities;
  }, [activeModalities]);

  useEffect(() => {
    isMicrophoneEnabledRef.current = isMicrophoneEnabled;
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

  return {
    activeModalities,
    activeModalitiesRef,
    isMicrophoneEnabled,
    isMicrophoneEnabledRef,
    canToggleModalities,
    handleModalityToggle
  };
}
