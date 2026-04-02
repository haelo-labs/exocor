import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { ActionExecutor } from '../../core/ActionExecutor';
import { DOMScanner, getRouterNavigateFromFiber, type DOMScannerPolicy } from '../../core/DOMScanner';
import type {
  AppMap,
  CommandInputMethod,
  DOMCapabilityMap,
  IntentStep,
  ResolutionPriority,
  SequenceExecutionResult
} from '../../types';
import type { ToolRegistry } from '../../core/ToolRegistry';
import { formatProgress } from './commandExecutionPresentation';

interface CommandExecutionRuntimeOptions {
  historyEntryId: string;
  inputMethod: CommandInputMethod;
  resolutionCommand: string;
  domScannerRef: MutableRefObject<DOMScanner | null>;
  domMapRef: MutableRefObject<DOMCapabilityMap>;
  routerNavigateRef: MutableRefObject<((path: string) => void | Promise<unknown>) | null>;
  domScannerPolicy: DOMScannerPolicy;
  executor: ActionExecutor;
  toolRegistry: ToolRegistry;
  signal: AbortSignal;
  setDomMap: Dispatch<SetStateAction<DOMCapabilityMap>>;
  setProgressMessage: Dispatch<SetStateAction<string | null>>;
  showToast: (variant: 'planning' | 'executing' | 'done' | 'failed', message: string, autoDismissMs?: number) => void;
  updateCommandHistoryEntry: (id: string, status: 'planning' | 'executing' | 'done' | 'failed' | 'clarification', message?: string) => void;
  appendCommandHistoryTrace: (id: string, label: string) => void;
}

interface SequenceExecutionContext {
  appMap: AppMap | null;
  resolutionPriority: ResolutionPriority;
}

export interface CommandExecutionRuntime {
  refreshMapForExecution: () => DOMCapabilityMap;
  navigateWithFiberDriver: (path: string) => Promise<boolean>;
  executeSequence: (
    steps: IntentStep[],
    executionMap: DOMCapabilityMap,
    context: SequenceExecutionContext
  ) => Promise<SequenceExecutionResult>;
  executeStreamedSequence: (
    steps: AsyncIterable<IntentStep>,
    executionMap: DOMCapabilityMap,
    context: SequenceExecutionContext
  ) => Promise<SequenceExecutionResult>;
}

export function createCommandExecutionRuntime({
  historyEntryId,
  inputMethod,
  resolutionCommand,
  domScannerRef,
  domMapRef,
  routerNavigateRef,
  domScannerPolicy,
  executor,
  toolRegistry,
  signal,
  setDomMap,
  setProgressMessage,
  showToast,
  updateCommandHistoryEntry,
  appendCommandHistoryTrace
}: CommandExecutionRuntimeOptions): CommandExecutionRuntime {
  const refreshMapForExecution = (): DOMCapabilityMap => {
    const refreshed = domScannerRef.current?.refresh() || domMapRef.current;
    routerNavigateRef.current = getRouterNavigateFromFiber(domScannerPolicy);
    setDomMap(refreshed);
    return refreshed;
  };

  const navigateWithFiberDriver = async (path: string): Promise<boolean> => {
    const navigate = routerNavigateRef.current || getRouterNavigateFromFiber(domScannerPolicy);
    routerNavigateRef.current = navigate;
    if (!navigate) {
      return false;
    }

    try {
      await navigate(path);
      return true;
    } catch {
      return false;
    }
  };

  const handleStepProgress = (_message: string, step: IntentStep): void => {
    const stepMessage = formatProgress(step);
    setProgressMessage(stepMessage);
    showToast('executing', stepMessage);
    updateCommandHistoryEntry(historyEntryId, 'executing');
    appendCommandHistoryTrace(historyEntryId, stepMessage);
  };

  const buildSequenceOptions = ({ appMap, resolutionPriority }: SequenceExecutionContext) => ({
    refreshMap: refreshMapForExecution,
    appMap,
    navigate: navigateWithFiberDriver,
    resolutionPriority,
    toolRegistry,
    signal,
    onProgress: handleStepProgress,
    defaultDelayMs: inputMethod === 'voice' ? 0 : 150,
    originalIntent: resolutionCommand
  });

  return {
    refreshMapForExecution,
    navigateWithFiberDriver,
    executeSequence: (steps, executionMap, context) =>
      executor.executeSequence(steps, executionMap, buildSequenceOptions(context)),
    executeStreamedSequence: (steps, executionMap, context) =>
      executor.executeStreamedSequence(steps, executionMap, buildSequenceOptions(context))
  };
}
