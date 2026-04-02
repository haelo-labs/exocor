import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { CommandInputMethod, VoiceState } from '../../types';
import { createSpeechController, type SpeechController } from '../../utils/speech';
import { normalizeCommand, SILENCE_TIMEOUT_MS } from './commandRuntime';
import type { VoiceGazeSnapshot } from './runtimeState';

interface UseVoiceCommandRuntimeOptions {
  availableModalities: readonly ('voice' | 'gaze' | 'gesture')[];
  isMicrophoneEnabled: boolean;
  isMicrophoneEnabledRef: MutableRefObject<boolean>;
  gazeRef: MutableRefObject<VoiceGazeSnapshot>;
  gazeEnabled: boolean;
  executeCommand: (
    command: string,
    inputMethod?: CommandInputMethod,
    voiceGazeSnapshot?: VoiceGazeSnapshot | null
  ) => Promise<boolean>;
}

interface VoiceCommandRuntime {
  voice: VoiceState;
  isAudioCapturing: boolean;
}

export function useVoiceCommandRuntime({
  availableModalities,
  isMicrophoneEnabled,
  isMicrophoneEnabledRef,
  gazeRef,
  gazeEnabled,
  executeCommand
}: UseVoiceCommandRuntimeOptions): VoiceCommandRuntime {
  const [voice, setVoice] = useState<VoiceState>({ transcript: '', isListening: false, confidence: 0 });
  const [isAudioCapturing, setIsAudioCapturing] = useState(false);
  const voiceAvailable = availableModalities.includes('voice');

  const speechControllerRef = useRef<SpeechController | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const audioCaptureTimerRef = useRef<number | null>(null);
  const lastVoiceSubmissionRef = useRef('');
  const voiceGazeSnapshotRef = useRef<VoiceGazeSnapshot | null>(null);
  const executeCommandRef = useRef(executeCommand);

  useEffect(() => {
    executeCommandRef.current = executeCommand;
  }, [executeCommand]);

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
  }, [gazeRef]);

  const resetVoiceGazeSnapshot = useCallback(() => {
    voiceGazeSnapshotRef.current = null;
  }, []);

  useEffect(() => {
    if (gazeEnabled) {
      return;
    }

    resetVoiceGazeSnapshot();
  }, [gazeEnabled, resetVoiceGazeSnapshot]);

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

  const clearAudioCaptureTimer = useCallback(() => {
    if (audioCaptureTimerRef.current) {
      window.clearTimeout(audioCaptureTimerRef.current);
      audioCaptureTimerRef.current = null;
    }
  }, []);

  const resetVoiceCaptureState = useCallback(() => {
    clearAudioCaptureTimer();
    setIsAudioCapturing(false);
  }, [clearAudioCaptureTimer]);

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
      const pendingExecution = executeCommandRef.current(normalized, 'voice', gazeSnapshot);
      void pendingExecution.then((accepted) => {
        if (!accepted && lastVoiceSubmissionRef.current === normalized) {
          lastVoiceSubmissionRef.current = '';
        }
      });
    },
    [clearSilenceTimer, clearVoiceTranscript, resetVoiceGazeSnapshot]
  );

  useEffect(() => {
    if (!voiceAvailable) {
      speechControllerRef.current?.destroy();
      speechControllerRef.current = null;
      resetVoiceUtteranceState();
      clearVoiceTranscript();
      lastVoiceSubmissionRef.current = '';
      resetVoiceCaptureState();
      setVoice((previous) =>
        !previous.transcript && !previous.isListening && previous.confidence === 0
          ? previous
          : {
              transcript: '',
              isListening: false,
              confidence: 0
            }
      );
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
        if (hasAudio && isMicrophoneEnabledRef.current) {
          setIsAudioCapturing(true);
          clearAudioCaptureTimer();
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
          resetVoiceCaptureState();
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
        resetVoiceCaptureState();
      }
    });

    speechControllerRef.current = speech;
    if (isMicrophoneEnabledRef.current && speech.isSupported) {
      speech.start();
    }

    return () => {
      resetVoiceUtteranceState();
      clearVoiceTranscript();
      lastVoiceSubmissionRef.current = '';
      resetVoiceCaptureState();
      speech.destroy();
      speechControllerRef.current = null;
    };
  }, [
    captureVoiceGazeSnapshot,
    clearAudioCaptureTimer,
    clearSilenceTimer,
    clearVoiceTranscript,
    voiceAvailable,
    isMicrophoneEnabledRef,
    resetVoiceCaptureState,
    resetVoiceUtteranceState,
    submitVoiceCommand
  ]);

  useEffect(() => {
    if (!voiceAvailable) {
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
    speech.stop();
    resetVoiceCaptureState();
    clearVoiceTranscript();
    lastVoiceSubmissionRef.current = '';
    setVoice((previous) =>
      !previous.transcript && !previous.isListening && previous.confidence === 0
        ? previous
        : {
            transcript: '',
            isListening: false,
            confidence: 0
          }
    );
  }, [clearVoiceTranscript, isMicrophoneEnabled, resetVoiceCaptureState, resetVoiceUtteranceState, voiceAvailable]);

  useEffect(() => {
    return () => {
      clearAudioCaptureTimer();
    };
  }, [clearAudioCaptureTimer]);

  return {
    voice,
    isAudioCapturing
  };
}
