import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { StatusToastVariant } from '../StatusToast';

interface ToastState {
  open: boolean;
  variant: StatusToastVariant;
  message: string;
}

interface ProviderUiRuntime {
  chatInput: string;
  isPanelOpen: boolean;
  resolvedIntentPreview: string | null;
  toastState: ToastState;
  setChatInput: Dispatch<SetStateAction<string>>;
  setIsPanelOpen: Dispatch<SetStateAction<boolean>>;
  showPreview: (value: string | null) => void;
  dismissToast: () => void;
  showToast: (variant: StatusToastVariant, message: string, autoDismissMs?: number) => void;
}

const INITIAL_TOAST_STATE: ToastState = {
  open: false,
  variant: 'planning',
  message: ''
};

export function useProviderUiRuntime(): ProviderUiRuntime {
  const [chatInput, setChatInput] = useState('');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [resolvedIntentPreview, setResolvedIntentPreview] = useState<string | null>(null);
  const [toastState, setToastState] = useState<ToastState>(INITIAL_TOAST_STATE);

  const previewTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showPreview = useCallback((value: string | null) => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }

    setResolvedIntentPreview(value);

    if (!value) {
      return;
    }

    previewTimerRef.current = window.setTimeout(() => {
      setResolvedIntentPreview(null);
      previewTimerRef.current = null;
    }, 2800);
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }

    setToastState((previous) => ({ ...previous, open: false }));
  }, []);

  const showToast = useCallback((variant: StatusToastVariant, message: string, autoDismissMs?: number) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }

    setToastState({
      open: true,
      variant,
      message
    });

    if (!autoDismissMs) {
      return;
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToastState((previous) => ({ ...previous, open: false }));
      toastTimerRef.current = null;
    }, autoDismissMs);
  }, []);

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
      }
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  return {
    chatInput,
    isPanelOpen,
    resolvedIntentPreview,
    toastState,
    setChatInput,
    setIsPanelOpen,
    showPreview,
    dismissToast,
    showToast
  };
}
