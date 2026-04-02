import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { ActionExecutor } from '../../core/ActionExecutor';
import { DOMScanner, readCachedAppMap, saveAppMapToCache, type DOMScannerPolicy } from '../../core/DOMScanner';
import { DeterministicIntentResolver } from '../../core/DeterministicIntentResolver';
import { RemoteIntentResolver } from '../../core/RemoteIntentResolver';
import { type ResolverRequestKind, type ShapedResolverContext } from '../../core/ResolverContextShaper';
import type { ResolvedExocorTrustPolicy } from '../../core/contextPolicy';
import { normalizeToolRoutePath, type ToolRegistry } from '../../core/ToolRegistry';
import type { CommandHistoryItem } from '../ChatPanel';
import type {
  AppMap,
  CommandInputMethod,
  DOMCapabilityMap,
  GazeState,
  GestureState,
  IntentAction,
  IntentResolutionInput,
  IntentPlan,
  IntentStep,
  ResolutionPriority,
  ResolutionStatus
} from '../../types';
import type { StatusToastVariant } from '../StatusToast';
import type { PendingClarificationState, VoiceGazeSnapshot } from './shared';
import {
  APP_MAP_BOOTSTRAP_GRACE_MS,
  awaitWithAbort,
  buildDirectToolPlan,
  buildEnrichedContext,
  buildFallbackAppMapFromDom,
  getPreferredToolEntries,
  getStrongPreferredTool,
  isAbortError,
  isNavigateThenToolPlan,
  normalizeCommand,
  planUsesTool,
  sanitizePlanStepsForUnrequestedPostSubmitNavigation,
  sleep,
  stepToIntent
} from './shared';
import { createCommandExecutionFeedback } from './commandExecutionFeedback';
import { recoverCommandExecution } from './commandExecutionRecovery';
import { resolveCommandPlan } from './commandPlanResolution';
import { createCommandExecutionRuntime } from './commandExecutionRuntime';

interface ExecuteSpatialCommandOptions {
  command: string;
  inputMethod?: CommandInputMethod;
  voiceGazeSnapshot?: VoiceGazeSnapshot | null;
  resolvingRef: MutableRefObject<boolean>;
  domMapRef: MutableRefObject<DOMCapabilityMap>;
  gazeRef: MutableRefObject<GazeState>;
  gestureRef: MutableRefObject<GestureState>;
  appMapRef: MutableRefObject<AppMap | null>;
  discoveryPromiseRef: MutableRefObject<Promise<AppMap | null> | null>;
  domScannerRef: MutableRefObject<DOMScanner | null>;
  resolverRef: MutableRefObject<RemoteIntentResolver | null>;
  deterministicResolverRef: MutableRefObject<DeterministicIntentResolver | null>;
  executorRef: MutableRefObject<ActionExecutor | null>;
  activeCommandAbortRef: MutableRefObject<AbortController | null>;
  activeCommandHistoryIdRef: MutableRefObject<string | null>;
  routerNavigateRef: MutableRefObject<((path: string) => void | Promise<unknown>) | null>;
  lastHostFocusedElementRef: MutableRefObject<HTMLElement | null>;
  lastHostTextEntryElementRef: MutableRefObject<HTMLElement | null>;
  domScannerPolicy: DOMScannerPolicy;
  resolvedTrustPolicy: ResolvedExocorTrustPolicy;
  toolRegistry: ToolRegistry;
  pendingClarification: PendingClarificationState | null;
  addCommandHistoryEntry: (command: string, inputMethod: CommandInputMethod) => string;
  updateCommandHistoryEntry: (id: string, status: CommandHistoryItem['status'], message?: string) => void;
  appendCommandHistoryTrace: (id: string, label: string) => void;
  awaitBootstrappedAppMap: () => Promise<AppMap | null>;
  runAppMapDiscovery: (options: {
    showOverlay: boolean;
    reason: string;
    forceRefresh?: boolean;
  }) => Promise<AppMap | null>;
  saveFallbackAppMapToCache: (nextAppMap: AppMap) => void;
  setPendingClarification: Dispatch<SetStateAction<PendingClarificationState | null>>;
  setVoiceClarificationQuestion: Dispatch<SetStateAction<string | null>>;
  setLastIntent: Dispatch<SetStateAction<IntentAction | null>>;
  setIsResolving: Dispatch<SetStateAction<boolean>>;
  setResolutionStatus: Dispatch<SetStateAction<ResolutionStatus>>;
  setProgressMessage: Dispatch<SetStateAction<string | null>>;
  setChatInput: Dispatch<SetStateAction<string>>;
  setIsPanelOpen: Dispatch<SetStateAction<boolean>>;
  setDomMap: Dispatch<SetStateAction<DOMCapabilityMap>>;
  showPreview: (value: string | null) => void;
  showToast: (variant: StatusToastVariant, message: string, autoDismissMs?: number) => void;
  dismissToast: () => void;
  shapeRemoteResolverPayload: (
    input: IntentResolutionInput,
    runtimeContext?: Record<string, unknown>,
    requestKind?: ResolverRequestKind
  ) => ShapedResolverContext;
}

export async function executeSpatialCommand({
  command,
  inputMethod = 'text',
  voiceGazeSnapshot = null,
  resolvingRef,
  domMapRef,
  gazeRef,
  gestureRef,
  appMapRef,
  discoveryPromiseRef,
  domScannerRef,
  resolverRef,
  deterministicResolverRef,
  executorRef,
  activeCommandAbortRef,
  activeCommandHistoryIdRef,
  routerNavigateRef,
  lastHostFocusedElementRef,
  lastHostTextEntryElementRef,
  domScannerPolicy,
  resolvedTrustPolicy,
  toolRegistry,
  pendingClarification,
  addCommandHistoryEntry,
  updateCommandHistoryEntry,
  appendCommandHistoryTrace,
  awaitBootstrappedAppMap,
  runAppMapDiscovery,
  saveFallbackAppMapToCache,
  setPendingClarification,
  setVoiceClarificationQuestion,
  setLastIntent,
  setIsResolving,
  setResolutionStatus,
  setProgressMessage,
  setChatInput,
  setIsPanelOpen,
  setDomMap,
  showPreview,
  showToast,
  dismissToast,
  shapeRemoteResolverPayload
}: ExecuteSpatialCommandOptions): Promise<boolean> {
  const normalizedCommand = normalizeCommand(command);
  const executor = executorRef.current;
  if (!normalizedCommand || resolvingRef.current || !executor) {
    return false;
  }

  const commandGazeState = inputMethod === 'voice' ? voiceGazeSnapshot || gazeRef.current : gazeRef.current;
  const initialMap = domMapRef.current;
  const resolutionMap =
    inputMethod === 'voice' && commandGazeState.gazeTarget
      ? initialMap
      : domScannerRef.current?.refresh() || initialMap;
  const enrichedContext = buildEnrichedContext(
    inputMethod,
    resolutionMap,
    commandGazeState,
    lastHostFocusedElementRef.current,
    lastHostTextEntryElementRef.current,
    domScannerPolicy
  );
  const cachedAppMap = resolvedTrustPolicy.features.appMapDiscovery ? readCachedAppMap() : null;
  const mountDiscoveryPromise = discoveryPromiseRef.current;
  const latestCachedAppMap = resolvedTrustPolicy.features.appMapDiscovery ? readCachedAppMap() : null;
  let availableAppMap =
    (resolvedTrustPolicy.features.appMapDiscovery ? appMapRef.current : null) ||
    cachedAppMap ||
    (await Promise.race([
      awaitBootstrappedAppMap(),
      sleep(APP_MAP_BOOTSTRAP_GRACE_MS).then(() => null)
    ])) ||
    (resolvedTrustPolicy.features.appMapDiscovery ? appMapRef.current : null) ||
    latestCachedAppMap;
  const shouldAwaitMountDiscoveryBeforeExecution =
    resolvedTrustPolicy.features.appMapDiscovery && !appMapRef.current && !cachedAppMap && Boolean(mountDiscoveryPromise);
  if (!availableAppMap) {
    availableAppMap = buildFallbackAppMapFromDom(resolutionMap);
    if (resolvedTrustPolicy.features.appMapDiscovery) {
      saveAppMapToCache(availableAppMap);
      saveFallbackAppMapToCache(availableAppMap);
    }
  }

  const activePendingClarification = pendingClarification;
  const baseCommand = activePendingClarification?.baseCommand || normalizedCommand;
  const resolutionCommand = activePendingClarification
    ? `Original intent: ${baseCommand}\nClarification answer: ${normalizedCommand}`
    : normalizedCommand;
  const resolutionCommandForContext = activePendingClarification
    ? `${resolutionCommand}|||clarified|||`
    : resolutionCommand;
  const semanticCommand = activePendingClarification
    ? normalizeCommand(`${baseCommand} ${normalizedCommand}`)
    : normalizedCommand;
  const historyEntryId =
    activePendingClarification?.historyEntryId || addCommandHistoryEntry(normalizedCommand, inputMethod);
  if (activePendingClarification) {
    setPendingClarification(null);
    setVoiceClarificationQuestion(null);
    appendCommandHistoryTrace(historyEntryId, `Clarification given: ${normalizedCommand}`);
    updateCommandHistoryEntry(historyEntryId, 'planning', 'Clarification received');
  }

  const buildToolCapabilityMap = (map: DOMCapabilityMap) =>
    toolRegistry.hasTools()
      ? toolRegistry.buildCapabilityMap(
          normalizeToolRoutePath(map.currentRoute || window.location.pathname || '/'),
          semanticCommand
        )
      : null;
  const initialToolCapabilityMap = buildToolCapabilityMap(resolutionMap);
  const preferredToolEntries = getPreferredToolEntries(initialToolCapabilityMap);
  const strongPreferredTool = getStrongPreferredTool(initialToolCapabilityMap);

  const buildResolutionInput = (
    map: DOMCapabilityMap,
    commandText: string,
    completedSteps?: IntentStep[]
  ): IntentResolutionInput => ({
    command: commandText,
    inputMethod,
    map,
    appMap: availableAppMap,
    toolCapabilityMap: buildToolCapabilityMap(map),
    gazeTarget: commandGazeState.gazeTarget ?? null,
    gesture: gestureRef.current.gesture || 'none',
    ...(completedSteps ? { completedSteps } : {})
  });
  const buildRemoteResolutionPayload = (
    map: DOMCapabilityMap,
    commandText: string,
    completedSteps?: IntentStep[],
    runtimeContext?: Record<string, unknown>,
    requestKind?: ResolverRequestKind
  ) => shapeRemoteResolverPayload(buildResolutionInput(map, commandText, completedSteps), runtimeContext, requestKind);

  const toolShortcutMatch =
    activePendingClarification || !toolRegistry.hasTools()
      ? null
      : toolRegistry.resolveDirectToolShortcut(
          resolutionCommand,
          normalizeToolRoutePath(resolutionMap.currentRoute || window.location.pathname || '/')
        );
  const deterministicResolution =
    activePendingClarification || !deterministicResolverRef.current || !resolvedTrustPolicy.features.liveDomScanning
      ? null
      : toolShortcutMatch?.type === 'direct_execute'
        ? {
            plan: buildDirectToolPlan(resolutionCommand, toolShortcutMatch.tool.id),
            resolutionPriority: 'app_map_only' as const
          }
        : toolShortcutMatch?.type === 'planner_only'
          ? null
          : deterministicResolverRef.current.resolve(
              buildResolutionInput(
                resolutionMap,
                resolutionCommand
              )
            );
  const remoteResolverAvailable = resolvedTrustPolicy.features.remoteResolver && Boolean(resolverRef.current);

  const abortController = new AbortController();
  const signal = abortController.signal;
  activeCommandAbortRef.current = abortController;
  activeCommandHistoryIdRef.current = historyEntryId;
  const feedback = createCommandExecutionFeedback({
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
  });
  const handleStoppedCommand = feedback.finishStopped;
  const commandExecutionRuntime = createCommandExecutionRuntime({
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
  });
  const { refreshMapForExecution, navigateWithFiberDriver, executeSequence, executeStreamedSequence } =
    commandExecutionRuntime;

  setIsResolving(true);
  setResolutionStatus('resolving');
  try {
    if (deterministicResolution) {
      feedback.beginInstantExecution(toolShortcutMatch);
    } else {
      feedback.beginPlanning({
        preferredToolEntries,
        toolShortcutMatch
      });
    }

    setDomMap(resolutionMap);

    let resolvedPlan: IntentPlan | null = null;
    let resolutionPriority: ResolutionPriority = deterministicResolution ? deterministicResolution.resolutionPriority : 'dom_only';
    let latestIntentSource: IntentAction['source'] = deterministicResolution ? 'deterministic' : 'claude';
    let initialExecutionResult = null as Awaited<ReturnType<ActionExecutor['executeSequence']>> | null;
    let usedAuthoritativePreferredTool = false;
    const handleClarificationRequest = (question: string, traceLabel: string): true => {
      return feedback.requestClarification(question, traceLabel);
    };
    const planResolution = await resolveCommandPlan({
      historyEntryId,
      baseCommand,
      inputMethod,
      resolutionCommand,
      resolutionCommandForContext,
      resolutionMap,
      availableAppMap,
      toolShortcutMatch,
      strongPreferredTool,
      deterministicResolution,
      remoteResolverAvailable,
      shouldAwaitMountDiscoveryBeforeExecution,
      enrichedContext,
      signal,
      resolver: resolverRef.current,
      toolRegistry,
      appendCommandHistoryTrace,
      updateCommandHistoryEntry,
      buildRemoteResolutionPayload,
      streamExecutionRuntime: {
        refreshMapForExecution,
        executeStreamedSequence
      },
      requestClarification: handleClarificationRequest
    });

    if (planResolution.status === 'clarification_requested') {
      return true;
    }

    if (planResolution.status === 'planned') {
      resolvedPlan = planResolution.plan;
      resolutionPriority = planResolution.resolutionPriority;
      latestIntentSource = planResolution.latestIntentSource;
      initialExecutionResult = planResolution.initialExecutionResult;
      usedAuthoritativePreferredTool = planResolution.usedAuthoritativePreferredTool;
    } else {
      resolutionPriority = planResolution.resolutionPriority;
      latestIntentSource = planResolution.latestIntentSource;
      usedAuthoritativePreferredTool = planResolution.usedAuthoritativePreferredTool;
    }

    if (!resolvedPlan && !remoteResolverAvailable) {
      const unavailableMessage = 'Remote resolver is disabled and no local plan matched';
      return feedback.finishUnavailable(unavailableMessage);
    }

    if (!resolvedPlan) {
      appendCommandHistoryTrace(historyEntryId, 'Falling back to DOM-only resolution');
      const fallbackMap = refreshMapForExecution();
      const fallbackResolutionInput = buildRemoteResolutionPayload(
        fallbackMap,
        resolutionCommand,
        undefined,
        enrichedContext,
        'resolve'
      );
      resolutionPriority = 'dom_only';
      resolvedPlan = await resolverRef.current!.resolve(fallbackResolutionInput.input, signal);
      if (resolvedPlan) {
        resolvedPlan = {
          ...resolvedPlan,
          steps: sanitizePlanStepsForUnrequestedPostSubmitNavigation(resolvedPlan.steps, baseCommand)
        };
      }
    }

    if (!resolvedPlan || !resolvedPlan.steps.length) {
      const unresolvedMessage = 'Unable to resolve intent';
      return feedback.finishUnresolved(unresolvedMessage, 'No steps returned by resolver');
    }

    if (
      latestIntentSource === 'claude' &&
      !usedAuthoritativePreferredTool &&
      strongPreferredTool &&
      planUsesTool(resolvedPlan, strongPreferredTool.id)
    ) {
      if (isNavigateThenToolPlan(resolvedPlan, strongPreferredTool.id)) {
        appendCommandHistoryTrace(historyEntryId, `Planner used navigate -> tool: ${strongPreferredTool.id}`);
      } else {
        appendCommandHistoryTrace(historyEntryId, `Planner used preferred tool directly: ${strongPreferredTool.id}`);
      }
    }

    const allowDynamicReplan = resolutionPriority !== 'app_map_only';
    const completedStepsHistory: IntentStep[] = [];
    let result = initialExecutionResult;
    if (!result) {
      if (shouldAwaitMountDiscoveryBeforeExecution && mountDiscoveryPromise) {
        const bootstrappedAppMap =
          (await awaitWithAbort(mountDiscoveryPromise, signal)) || appMapRef.current || readCachedAppMap();
        if (bootstrappedAppMap) {
          availableAppMap = bootstrappedAppMap;
        }
      }
      appendCommandHistoryTrace(historyEntryId, `Executing ${resolvedPlan.steps.length} planned steps`);
      updateCommandHistoryEntry(historyEntryId, 'executing');
      const executionMap = resolutionPriority === 'dom_only' ? refreshMapForExecution() : resolutionMap;
      result = await executeSequence(resolvedPlan.steps, executionMap, {
        appMap: availableAppMap,
        resolutionPriority
      });
    }
    completedStepsHistory.push(...resolvedPlan.steps.slice(0, result.completedSteps));
    const shouldTreatDeterministicCompletionAsTerminal =
      Boolean(deterministicResolution) &&
      result.completedSteps >= resolvedPlan.steps.length &&
      !result.failedStep;

    if (shouldTreatDeterministicCompletionAsTerminal && !result.executed) {
      result = {
        ...result,
        executed: true,
        successDescription: result.successDescription || 'instant action executed'
      };
    }

    const recoveryResult = await recoverCommandExecution({
      historyEntryId,
      baseCommand,
      resolutionCommand,
      commandGazeState,
      result,
      plannedSteps: resolvedPlan.steps,
      completedStepsHistory,
      latestIntentSource,
      availableAppMap,
      resolutionPriority,
      allowDynamicReplan,
      resolvedTrustPolicy,
      remoteResolverAvailable,
      enrichedContext,
      signal,
      resolver: resolverRef.current,
      runAppMapDiscovery: (options) => awaitWithAbort(runAppMapDiscovery(options), signal),
      refreshMapForExecution,
      executeSequence,
      setProgressMessage,
      showToast,
      appendCommandHistoryTrace,
      buildRemoteResolutionPayload
    });
    result = recoveryResult.result;
    availableAppMap = recoveryResult.availableAppMap;
    latestIntentSource = recoveryResult.latestIntentSource;
    completedStepsHistory.splice(0, completedStepsHistory.length, ...recoveryResult.completedStepsHistory);

    const latestStep = completedStepsHistory.at(-1);
    const latestIntent = latestStep ? stepToIntent(latestStep, latestIntentSource, resolutionCommand) : null;
    if (latestIntent) {
      setLastIntent(latestIntent);
    }

    if (!result.executed) {
      const failureMessage = result.failedStepReason || result.reason || 'Execution failed';
      if (failureMessage === 'Stopped by user.') {
        return handleStoppedCommand();
      }

      return feedback.finishFailure(failureMessage);
    }

    return feedback.finishSuccess(result);
  } catch (error) {
    if (isAbortError(error)) {
      return handleStoppedCommand();
    }
    throw error;
  } finally {
    if (activeCommandAbortRef.current === abortController) {
      activeCommandAbortRef.current = null;
    }
    if (activeCommandHistoryIdRef.current === historyEntryId) {
      activeCommandHistoryIdRef.current = null;
    }
  }
}
