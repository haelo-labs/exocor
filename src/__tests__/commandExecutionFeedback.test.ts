import { describe, expect, it, vi } from 'vitest';
import { createCommandExecutionFeedback } from '../components/spatial-provider/commandExecutionFeedback';
import type { PendingClarificationState } from '../components/spatial-provider/runtimeState';
import type { ResolutionStatus } from '../types';

function createStateRecorder<T>(initialValue: T) {
  let current = initialValue;
  return {
    get value(): T {
      return current;
    },
    set: (next: T | ((previous: T) => T)) => {
      current = typeof next === 'function' ? (next as (previous: T) => T)(current) : next;
    }
  };
}

describe('createCommandExecutionFeedback', () => {
  it('opens typed clarification in the panel and records the pending question', () => {
    const pendingClarificationState = createStateRecorder<PendingClarificationState | null>(null);
    const voiceClarificationState = createStateRecorder<string | null>('stale');
    const isResolvingState = createStateRecorder(true);
    const resolutionStatusState = createStateRecorder<ResolutionStatus>('resolving');
    const progressMessageState = createStateRecorder<string | null>(null);
    const chatInputState = createStateRecorder('');
    const panelOpenState = createStateRecorder(false);
    const updateCommandHistoryEntry = vi.fn();
    const appendCommandHistoryTrace = vi.fn();
    const showPreview = vi.fn();
    const dismissToast = vi.fn();

    const feedback = createCommandExecutionFeedback({
      historyEntryId: 'cmd-1',
      baseCommand: 'assign ticket',
      inputMethod: 'text',
      normalizedCommand: 'alex',
      setPendingClarification: pendingClarificationState.set,
      setVoiceClarificationQuestion: voiceClarificationState.set,
      setIsResolving: isResolvingState.set,
      setResolutionStatus: resolutionStatusState.set,
      setProgressMessage: progressMessageState.set,
      setChatInput: chatInputState.set,
      setIsPanelOpen: panelOpenState.set,
      showPreview,
      showToast: vi.fn(),
      dismissToast,
      updateCommandHistoryEntry,
      appendCommandHistoryTrace
    });

    const result = feedback.requestClarification('Which assignee?', 'Need assignee');

    expect(result).toBe(true);
    expect(isResolvingState.value).toBe(false);
    expect(resolutionStatusState.value).toBe('executed');
    expect(progressMessageState.value).toBe('Which assignee?');
    expect(pendingClarificationState.value).toEqual({
      question: 'Which assignee?',
      baseCommand: 'assign ticket',
      historyEntryId: 'cmd-1'
    });
    expect(voiceClarificationState.value).toBeNull();
    expect(panelOpenState.value).toBe(true);
    expect(showPreview).toHaveBeenCalledWith('Which assignee?');
    expect(dismissToast).toHaveBeenCalled();
    expect(updateCommandHistoryEntry).toHaveBeenCalledWith('cmd-1', 'planning', 'Clarification requested');
    expect(appendCommandHistoryTrace).toHaveBeenCalledWith('cmd-1', 'Need assignee');
  });

  it('restores the original voice command to chat input when execution fails', () => {
    const resolutionStatusState = createStateRecorder<ResolutionStatus>('resolving');
    const progressMessageState = createStateRecorder<string | null>(null);
    const chatInputState = createStateRecorder('');
    const feedback = createCommandExecutionFeedback({
      historyEntryId: 'cmd-voice',
      baseCommand: 'assign ticket',
      inputMethod: 'voice',
      normalizedCommand: 'assign ticket to alex',
      setPendingClarification: vi.fn(),
      setVoiceClarificationQuestion: vi.fn(),
      setIsResolving: vi.fn(),
      setResolutionStatus: resolutionStatusState.set,
      setProgressMessage: progressMessageState.set,
      setChatInput: chatInputState.set,
      setIsPanelOpen: vi.fn(),
      showPreview: vi.fn(),
      showToast: vi.fn(),
      dismissToast: vi.fn(),
      updateCommandHistoryEntry: vi.fn(),
      appendCommandHistoryTrace: vi.fn()
    });

    const result = feedback.finishFailure('Target not found');

    expect(result).toBe(false);
    expect(resolutionStatusState.value).toBe('failed');
    expect(progressMessageState.value).toBe('Failed: Target not found');
    expect(chatInputState.value).toBe('assign ticket to alex');
  });
});
