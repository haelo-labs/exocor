import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { CommandHistoryItem } from '../ChatPanel';
import type { CommandInputMethod } from '../../types';
import {
  getAllHistoryStorageKeys,
  getLegacyHistoryStorageKeys,
  HISTORY_SESSION_STORAGE_KEY,
  LEGACY_HISTORY_STORAGE_KEY,
  sanitizePersistedHistory,
  toHistoryInputMethod
} from './commandHistoryStorage';
import type { PendingClarificationState } from './runtimeState';

interface UseCommandHistoryRuntimeOptions {
  initialRoutePath: string;
  initialTitle: string;
}

interface CommandHistoryRuntime {
  commandHistory: CommandHistoryItem[];
  pendingClarification: PendingClarificationState | null;
  voiceClarificationQuestion: string | null;
  isHistoryHydrated: boolean;
  setPendingClarification: Dispatch<SetStateAction<PendingClarificationState | null>>;
  setVoiceClarificationQuestion: Dispatch<SetStateAction<string | null>>;
  addCommandHistoryEntry: (command: string, inputMethod: CommandInputMethod) => string;
  updateCommandHistoryEntry: (id: string, status: CommandHistoryItem['status'], message?: string) => void;
  appendCommandHistoryTrace: (id: string, label: string) => void;
  clearCommandHistory: () => void;
}

export function useCommandHistoryRuntime({
  initialRoutePath,
  initialTitle
}: UseCommandHistoryRuntimeOptions): CommandHistoryRuntime {
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>([]);
  const [pendingClarification, setPendingClarification] = useState<PendingClarificationState | null>(null);
  const [voiceClarificationQuestion, setVoiceClarificationQuestion] = useState<string | null>(null);
  const [isHistoryHydrated, setIsHistoryHydrated] = useState(false);
  const historyCounterRef = useRef(0);
  const historyTraceCounterRef = useRef(0);

  const addCommandHistoryEntry = useCallback((command: string, inputMethod: CommandInputMethod): string => {
    const id = `cmd-${Date.now()}-${historyCounterRef.current++}`;
    const startedAt = Date.now();
    const normalizedInputMethod = toHistoryInputMethod(inputMethod);
    const nextEntry: CommandHistoryItem = {
      id,
      command,
      status: 'planning',
      inputMethod: normalizedInputMethod,
      createdAt: startedAt,
      traces: [
        {
          id: `trace-${startedAt}-${historyTraceCounterRef.current++}`,
          label: `Command received from ${normalizedInputMethod}`,
          at: startedAt
        }
      ]
    };
    setCommandHistory((previous) => [nextEntry, ...previous]);
    return id;
  }, []);

  const updateCommandHistoryEntry = useCallback(
    (id: string, status: CommandHistoryItem['status'], message?: string) => {
      setCommandHistory((previous) => previous.map((entry) => (entry.id === id ? { ...entry, status, message } : entry)));
    },
    []
  );

  const appendCommandHistoryTrace = useCallback((id: string, label: string) => {
    const now = Date.now();
    setCommandHistory((previous) =>
      previous.map((entry) => {
        if (entry.id !== id) {
          return entry;
        }
        const lastTrace = entry.traces[entry.traces.length - 1];
        if (lastTrace?.label === label) {
          return entry;
        }
        return {
          ...entry,
          traces: [
            ...entry.traces,
            {
              id: `trace-${now}-${historyTraceCounterRef.current++}`,
              label,
              at: now
            }
          ]
        };
      })
    );
  }, []);

  const clearCommandHistory = useCallback(() => {
    setCommandHistory([]);
    setPendingClarification(null);
    setVoiceClarificationQuestion(null);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setIsHistoryHydrated(true);
      return;
    }

    const availableHistoryKeys = [
      ...getAllHistoryStorageKeys(initialRoutePath, initialTitle),
      ...getLegacyHistoryStorageKeys(initialRoutePath, initialTitle)
    ];
    const scopedEntry = availableHistoryKeys
      .map((key) => ({ key, raw: window.localStorage.getItem(key) }))
      .find((entry) => Boolean(entry.raw));

    if (scopedEntry?.raw) {
      try {
        const parsed = JSON.parse(scopedEntry.raw) as unknown;
        const sanitized = sanitizePersistedHistory(parsed);
        setCommandHistory(sanitized);
        for (const key of getAllHistoryStorageKeys(initialRoutePath, initialTitle)) {
          window.localStorage.setItem(key, JSON.stringify(sanitized));
        }
        if (scopedEntry.key.includes(LEGACY_HISTORY_STORAGE_KEY)) {
          window.localStorage.removeItem(scopedEntry.key);
        }
        setIsHistoryHydrated(true);
        return;
      } catch {
        window.localStorage.removeItem(scopedEntry.key);
      }
    }

    const legacyRaw = window.sessionStorage.getItem(HISTORY_SESSION_STORAGE_KEY);
    if (!legacyRaw) {
      setIsHistoryHydrated(true);
      return;
    }

    try {
      const parsed = JSON.parse(legacyRaw) as unknown;
      const sanitized = sanitizePersistedHistory(parsed);
      setCommandHistory(sanitized);
      for (const key of getAllHistoryStorageKeys(initialRoutePath, initialTitle)) {
        window.localStorage.setItem(key, JSON.stringify(sanitized));
      }
      window.sessionStorage.removeItem(HISTORY_SESSION_STORAGE_KEY);
    } catch {
      window.sessionStorage.removeItem(HISTORY_SESSION_STORAGE_KEY);
    } finally {
      setIsHistoryHydrated(true);
    }
  }, [initialRoutePath, initialTitle]);

  useEffect(() => {
    if (!isHistoryHydrated || typeof window === 'undefined') {
      return;
    }

    for (const key of getAllHistoryStorageKeys(initialRoutePath, initialTitle)) {
      window.localStorage.setItem(key, JSON.stringify(commandHistory));
    }
  }, [commandHistory, initialRoutePath, initialTitle, isHistoryHydrated]);

  return {
    commandHistory,
    pendingClarification,
    voiceClarificationQuestion,
    isHistoryHydrated,
    setPendingClarification,
    setVoiceClarificationQuestion,
    addCommandHistoryEntry,
    updateCommandHistoryEntry,
    appendCommandHistoryTrace,
    clearCommandHistory
  };
}
