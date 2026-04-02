import type { Dispatch, SetStateAction } from 'react';
import type { DirectToolShortcutMatch } from '../../core/ToolRegistry';
import type {
  CommandInputMethod,
  ResolutionStatus,
  SequenceExecutionResult,
  ToolCapabilityEntry
} from '../../types';
import type { CommandHistoryItem } from '../ChatPanel';
import type { PendingClarificationState } from './shared';

interface CommandExecutionFeedbackOptions {
  historyEntryId: string;
  baseCommand: string;
  inputMethod: CommandInputMethod;
  normalizedCommand: string;
  setPendingClarification: Dispatch<SetStateAction<PendingClarificationState | null>>;
  setVoiceClarificationQuestion: Dispatch<SetStateAction<string | null>>;
  setIsResolving: Dispatch<SetStateAction<boolean>>;
  setResolutionStatus: Dispatch<SetStateAction<ResolutionStatus>>;
  setProgressMessage: Dispatch<SetStateAction<string | null>>;
  setChatInput: Dispatch<SetStateAction<string>>;
  setIsPanelOpen: Dispatch<SetStateAction<boolean>>;
  showPreview: (value: string | null) => void;
  showToast: (variant: 'planning' | 'executing' | 'done' | 'failed', message: string, autoDismissMs?: number) => void;
  dismissToast: () => void;
  updateCommandHistoryEntry: (id: string, status: CommandHistoryItem['status'], message?: string) => void;
  appendCommandHistoryTrace: (id: string, label: string) => void;
}

interface BeginPlanningOptions {
  preferredToolEntries: ToolCapabilityEntry[];
  toolShortcutMatch: DirectToolShortcutMatch | null;
}

export interface CommandExecutionFeedback {
  beginInstantExecution: (toolShortcutMatch: DirectToolShortcutMatch | null) => void;
  beginPlanning: (options: BeginPlanningOptions) => void;
  requestClarification: (question: string, traceLabel: string) => true;
  finishStopped: () => false;
  finishUnavailable: (message: string) => false;
  finishUnresolved: (progressMessage: string, previewMessage: string) => false;
  finishFailure: (message: string) => false;
  finishSuccess: (result: SequenceExecutionResult) => true;
}

export function createCommandExecutionFeedback({
  historyEntryId,
  baseCommand,
  inputMethod,
  normalizedCommand,
  setPendingClarification,
  setVoiceClarificationQuestion,
  setIsResolving,
  setResolutionStatus,
  setProgressMessage,
  setChatInput,
  setIsPanelOpen,
  showPreview,
  showToast,
  dismissToast,
  updateCommandHistoryEntry,
  appendCommandHistoryTrace
}: CommandExecutionFeedbackOptions): CommandExecutionFeedback {
  const restoreVoiceInput = (): void => {
    if (inputMethod === 'voice') {
      setChatInput(normalizedCommand);
    }
  };

  return {
    beginInstantExecution: (toolShortcutMatch): void => {
      setProgressMessage('Executing instant action...');
      showToast('executing', 'Executing instant action...');
      appendCommandHistoryTrace(historyEntryId, 'Executing instant action');
      updateCommandHistoryEntry(historyEntryId, 'executing', 'Instant action matched');

      if (toolShortcutMatch?.type === 'direct_execute') {
        appendCommandHistoryTrace(historyEntryId, `Matched app-native tool shortcut: ${toolShortcutMatch.tool.id}`);
      }
    },
    beginPlanning: ({ preferredToolEntries, toolShortcutMatch }): void => {
      setProgressMessage('Planning workflow...');
      showToast('planning', 'Planning workflow...');
      appendCommandHistoryTrace(historyEntryId, 'Planning workflow');

      if (!preferredToolEntries.length) {
        appendCommandHistoryTrace(historyEntryId, 'No strong tool match; using normal planner behavior');
      } else {
        for (const preferredTool of preferredToolEntries) {
          appendCommandHistoryTrace(historyEntryId, `Preferred tool candidate: ${preferredTool.id}`);
          if (!preferredTool.currentRouteMatches && preferredTool.routes.length) {
            appendCommandHistoryTrace(
              historyEntryId,
              `Preferred tool is off-route: ${preferredTool.routes.join(', ')}`
            );
          }
        }
      }

      if (toolShortcutMatch?.type === 'planner_only') {
        appendCommandHistoryTrace(
          historyEntryId,
          toolShortcutMatch.reason === 'route_mismatch'
            ? `Matched route-scoped app-native tool: ${toolShortcutMatch.tool.id}; planner will navigate first`
            : `Matched app-native tool: ${toolShortcutMatch.tool.id}; planner will supply arguments`
        );
      }
    },
    requestClarification: (question, traceLabel): true => {
      setResolutionStatus(() => 'executed');
      setIsResolving(() => false);
      setProgressMessage(question);
      showPreview(question);
      dismissToast();
      appendCommandHistoryTrace(historyEntryId, traceLabel);
      appendCommandHistoryTrace(historyEntryId, `Clarification asked: ${question}`);
      updateCommandHistoryEntry(historyEntryId, 'planning', 'Clarification requested');
      setPendingClarification({
        question,
        baseCommand,
        historyEntryId
      });

      if (inputMethod === 'voice') {
        setVoiceClarificationQuestion(question);
      } else {
        setVoiceClarificationQuestion(null);
        setIsPanelOpen(true);
      }

      return true;
    },
    finishStopped: (): false => {
      setIsResolving(false);
      setResolutionStatus('failed');
      setProgressMessage('Stopped');
      showPreview('Stopped');
      dismissToast();
      appendCommandHistoryTrace(historyEntryId, 'Stopped by user');
      updateCommandHistoryEntry(historyEntryId, 'failed', 'Stopped');
      return false;
    },
    finishUnavailable: (message): false => {
      setIsResolving(false);
      setResolutionStatus('unresolved');
      setProgressMessage(message);
      showPreview(message);
      showToast('failed', message);
      appendCommandHistoryTrace(historyEntryId, message);
      updateCommandHistoryEntry(historyEntryId, 'failed', message);
      return false;
    },
    finishUnresolved: (progressMessage, previewMessage): false => {
      setIsResolving(false);
      setResolutionStatus('unresolved');
      setProgressMessage(progressMessage);
      showPreview(previewMessage);
      showToast('failed', progressMessage);
      appendCommandHistoryTrace(historyEntryId, progressMessage);
      updateCommandHistoryEntry(historyEntryId, 'failed', progressMessage);
      restoreVoiceInput();
      return false;
    },
    finishFailure: (message): false => {
      if (message === 'Stopped by user.') {
        return false;
      }

      setIsResolving(false);
      setResolutionStatus('failed');
      setProgressMessage(`Failed: ${message}`);
      showPreview(message);
      showToast('failed', message);
      appendCommandHistoryTrace(historyEntryId, `Failed: ${message}`);
      updateCommandHistoryEntry(historyEntryId, 'failed', message);
      restoreVoiceInput();
      return false;
    },
    finishSuccess: (result): true => {
      setProgressMessage(`Done ✓ ${result.successDescription || ''}`.trim());
      setResolutionStatus('executed');
      showPreview(`Done ✓ ${result.successDescription || `completed ${result.completedSteps} steps`}`);
      showToast('done', `Done ✓ ${result.successDescription || `completed ${result.completedSteps} steps`}`, 2000);
      appendCommandHistoryTrace(
        historyEntryId,
        `Completed ${result.completedSteps} step${result.completedSteps === 1 ? '' : 's'}`
      );
      updateCommandHistoryEntry(historyEntryId, 'done', result.successDescription);
      setIsResolving(false);
      return true;
    }
  };
}
