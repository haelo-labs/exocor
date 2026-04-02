import { shapeResolverNewElementsForTransport, type ResolverRequestKind, type ShapedResolverContext } from '../../core/ResolverContextShaper';
import type { ResolvedExocorTrustPolicy } from '../../core/contextPolicy';
import { RemoteIntentResolver } from '../../core/RemoteIntentResolver';
import type {
  AppMap,
  DOMCapabilityMap,
  GazeState,
  IntentAction,
  IntentStep,
  ResolutionPriority,
  SequenceExecutionResult
} from '../../types';
import { sanitizePlanStepsForUnrequestedPostSubmitNavigation } from './shared';

type BuildRemoteResolutionPayload = (
  map: DOMCapabilityMap,
  commandText: string,
  completedSteps?: IntentStep[],
  runtimeContext?: Record<string, unknown>,
  requestKind?: ResolverRequestKind
) => ShapedResolverContext;

interface CommandExecutionRecoveryOptions {
  historyEntryId: string;
  baseCommand: string;
  resolutionCommand: string;
  commandGazeState: GazeState;
  result: SequenceExecutionResult;
  plannedSteps: IntentStep[];
  completedStepsHistory: IntentStep[];
  latestIntentSource: IntentAction['source'];
  availableAppMap: AppMap | null;
  resolutionPriority: ResolutionPriority;
  allowDynamicReplan: boolean;
  resolvedTrustPolicy: ResolvedExocorTrustPolicy;
  remoteResolverAvailable: boolean;
  enrichedContext?: Record<string, unknown>;
  signal: AbortSignal;
  resolver: RemoteIntentResolver | null;
  runAppMapDiscovery: (options: {
    showOverlay: boolean;
    reason: string;
    forceRefresh?: boolean;
  }) => Promise<AppMap | null>;
  refreshMapForExecution: () => DOMCapabilityMap;
  executeSequence: (
    steps: IntentStep[],
    executionMap: DOMCapabilityMap,
    context: {
      appMap: AppMap | null;
      resolutionPriority: ResolutionPriority;
    }
  ) => Promise<SequenceExecutionResult>;
  setProgressMessage: (message: string | null) => void;
  showToast: (variant: 'planning' | 'executing' | 'done' | 'failed', message: string, autoDismissMs?: number) => void;
  appendCommandHistoryTrace: (id: string, label: string) => void;
  buildRemoteResolutionPayload: BuildRemoteResolutionPayload;
}

export interface CommandExecutionRecoveryResult {
  result: SequenceExecutionResult;
  completedStepsHistory: IntentStep[];
  latestIntentSource: IntentAction['source'];
  availableAppMap: AppMap | null;
}

export async function recoverCommandExecution({
  historyEntryId,
  baseCommand,
  resolutionCommand,
  commandGazeState,
  result,
  plannedSteps,
  completedStepsHistory,
  latestIntentSource,
  availableAppMap,
  resolutionPriority,
  allowDynamicReplan,
  resolvedTrustPolicy,
  remoteResolverAvailable,
  enrichedContext,
  signal,
  resolver,
  runAppMapDiscovery,
  refreshMapForExecution,
  executeSequence,
  setProgressMessage,
  showToast,
  appendCommandHistoryTrace,
  buildRemoteResolutionPayload
}: CommandExecutionRecoveryOptions): Promise<CommandExecutionRecoveryResult> {
  let nextResult = result;
  let nextAvailableAppMap = availableAppMap;
  let nextLatestIntentSource = latestIntentSource;
  const nextCompletedStepsHistory = [...completedStepsHistory];

  const shouldAttemptScopedAppMapRefresh =
    !nextResult.executed &&
    Boolean(nextAvailableAppMap) &&
    resolutionPriority !== 'dom_only' &&
    nextResult.failedStep &&
    nextResult.failedStepReason?.toLowerCase().includes('target not found');

  if (shouldAttemptScopedAppMapRefresh) {
    setProgressMessage('Refreshing cached app map...');
    showToast('planning', 'Refreshing cached app map...');
    appendCommandHistoryTrace(historyEntryId, 'Refreshing cached app map after target lookup failed');

    const refreshedAppMap = await runAppMapDiscovery({
      showOverlay: false,
      reason: 'stale_target_not_found',
      forceRefresh: true
    });

    if (refreshedAppMap) {
      nextAvailableAppMap = refreshedAppMap;
    }

    const remainingSteps = plannedSteps.slice(nextResult.completedSteps);
    if (remainingSteps.length) {
      const refreshedExecutionMap = refreshMapForExecution();
      nextResult = await executeSequence(remainingSteps, refreshedExecutionMap, {
        appMap: nextAvailableAppMap,
        resolutionPriority
      });
      nextCompletedStepsHistory.push(...remainingSteps.slice(0, nextResult.completedSteps));
    }
  }

  const failureReasonLower = nextResult.failedStepReason?.toLowerCase() || '';
  const shouldRetryFailedStepWithPlanner =
    !nextResult.executed &&
    Boolean(nextResult.failedStep) &&
    Boolean(resolver) &&
    (failureReasonLower.includes('target not found') ||
      (nextResult.failedStep?.action === 'tool' && failureReasonLower.includes('current route')));

  if (shouldRetryFailedStepWithPlanner && nextResult.failedStep && remoteResolverAvailable && resolver) {
    setProgressMessage('Retrying failed step with updated context...');
    showToast('planning', 'Retrying failed step with updated context...');
    appendCommandHistoryTrace(historyEntryId, 'Retrying failed step with updated context');
    const retryMap = refreshMapForExecution();
    const retryResolutionPayload = buildRemoteResolutionPayload(
      retryMap,
      resolutionCommand,
      undefined,
      enrichedContext,
      'failed_step'
    );

    const retrySteps = await resolver.resolveForFailedStep(
      retryResolutionPayload.input,
      nextResult.failedStep,
      nextResult.failedStepReason || nextResult.reason || 'Execution failed',
      signal
    );

    const sanitizedRetrySteps = sanitizePlanStepsForUnrequestedPostSubmitNavigation(retrySteps, baseCommand);

    if (sanitizedRetrySteps.length) {
      nextLatestIntentSource = 'claude';
      nextResult = await executeSequence(sanitizedRetrySteps, retryMap, {
        appMap: nextAvailableAppMap,
        resolutionPriority
      });
      nextCompletedStepsHistory.push(...sanitizedRetrySteps.slice(0, nextResult.completedSteps));
    }
  }

  if (
    !nextResult.executed &&
    allowDynamicReplan &&
    Boolean(nextResult.newElementsAfterWait?.length) &&
    remoteResolverAvailable &&
    resolver
  ) {
    setProgressMessage('Planning dynamic follow-up steps...');
    showToast('planning', 'Planning dynamic follow-up steps...');
    appendCommandHistoryTrace(historyEntryId, 'Planning dynamic follow-up steps');

    const followUpMap = refreshMapForExecution();
    const followUpResolutionPayload = buildRemoteResolutionPayload(
      followUpMap,
      resolutionCommand,
      nextCompletedStepsHistory,
      enrichedContext,
      'new_elements'
    );
    const shapedNewElements = shapeResolverNewElementsForTransport({
      command: resolutionCommand,
      elements: nextResult.newElementsAfterWait || [],
      gazeTarget: commandGazeState.gazeTarget ?? null,
      trustPolicy: resolvedTrustPolicy
    });

    const followUpSteps = await resolver.resolveForNewElements(
      followUpResolutionPayload.input,
      shapedNewElements,
      nextCompletedStepsHistory,
      signal
    );

    const sanitizedFollowUpSteps = sanitizePlanStepsForUnrequestedPostSubmitNavigation(
      followUpSteps,
      baseCommand
    );

    if (sanitizedFollowUpSteps.length) {
      nextLatestIntentSource = 'claude';
      nextResult = await executeSequence(sanitizedFollowUpSteps, followUpMap, {
        appMap: nextAvailableAppMap,
        resolutionPriority
      });
      nextCompletedStepsHistory.push(...sanitizedFollowUpSteps.slice(0, nextResult.completedSteps));
    }
  }

  return {
    result: nextResult,
    completedStepsHistory: nextCompletedStepsHistory,
    latestIntentSource: nextLatestIntentSource,
    availableAppMap: nextAvailableAppMap
  };
}
