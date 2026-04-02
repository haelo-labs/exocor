import { describe, expect, it, vi } from 'vitest';
import { recoverCommandExecution } from '../components/spatial-provider/commandExecutionRecovery';
import { EMPTY_GAZE_STATE, emptyMap } from '../components/spatial-provider/shared';
import type { AppMap, IntentStep, SequenceExecutionResult } from '../types';

describe('recoverCommandExecution', () => {
  it('retries a failed step with the planner when the target is no longer available', async () => {
    const completedStep: IntentStep = {
      action: 'click',
      target: 'row-1',
      reason: 'Open the ticket'
    };
    const failedStep: IntentStep = {
      action: 'tool',
      toolId: 'assignTicket',
      args: {
        assignee: 'alex'
      },
      reason: 'Assign the ticket'
    };
    const retryStep: IntentStep = {
      action: 'click',
      target: 'row-1-refresh',
      reason: 'Retry with the refreshed target'
    };
    const initialResult: SequenceExecutionResult = {
      executed: false,
      completedSteps: 1,
      failedStep,
      failedStepReason: 'target not found'
    };
    const retriedResult: SequenceExecutionResult = {
      executed: true,
      completedSteps: 1,
      successDescription: 'ticket assigned'
    };
    const resolver = {
      resolveForFailedStep: vi.fn(async () => [retryStep]),
      resolveForNewElements: vi.fn(async () => [])
    };
    const executeSequence = vi.fn(async () => retriedResult);

    const result = await recoverCommandExecution({
      historyEntryId: 'cmd-3',
      baseCommand: 'assign this ticket to alex',
      resolutionCommand: 'assign this ticket to alex',
      commandGazeState: EMPTY_GAZE_STATE,
      result: initialResult,
      plannedSteps: [completedStep, failedStep],
      completedStepsHistory: [completedStep],
      latestIntentSource: 'deterministic',
      availableAppMap: null as AppMap | null,
      resolutionPriority: 'route_then_dom',
      allowDynamicReplan: true,
      resolvedTrustPolicy: {
        features: {
          remoteResolver: true,
          appMapDiscovery: true,
          liveDomScanning: true,
          reactHints: true,
          routerHints: true,
          tools: true
        },
        neverScan: [],
        neverSend: [],
        redact: []
      },
      remoteResolverAvailable: true,
      enrichedContext: { inputMethod: 'text' },
      signal: new AbortController().signal,
      resolver: resolver as any,
      runAppMapDiscovery: vi.fn(async () => null),
      refreshMapForExecution: () => ({
        ...emptyMap,
        currentRoute: '/tickets'
      }),
      executeSequence,
      setProgressMessage: vi.fn(),
      showToast: vi.fn(),
      appendCommandHistoryTrace: vi.fn(),
      buildRemoteResolutionPayload: (map, _commandText, _completedSteps, runtimeContext) => ({
        input: {
          command: 'assign this ticket to alex',
          inputMethod: 'text',
          map,
          appMap: null,
          toolCapabilityMap: null,
          gazeTarget: null,
          gesture: 'none'
        },
        runtimeContext,
        report: {
          requestKind: 'failed_step',
          profile: 'tool_first',
          targetTokens: 3000,
          estimatedTokens: 700,
          includedSections: [],
          droppedSections: [],
          filteredByNeverSend: 0,
          redactedFields: 0,
          budgetAdjusted: false
        }
      })
    });

    expect(resolver.resolveForFailedStep).toHaveBeenCalledTimes(1);
    expect(executeSequence).toHaveBeenCalledWith(
      [retryStep],
      expect.objectContaining({ currentRoute: '/tickets' }),
      expect.objectContaining({
        appMap: null,
        resolutionPriority: 'route_then_dom'
      })
    );
    expect(result.latestIntentSource).toBe('claude');
    expect(result.result).toEqual(retriedResult);
    expect(result.completedStepsHistory).toEqual([completedStep, retryStep]);
  });
});
