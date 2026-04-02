import { describe, expect, it, vi } from 'vitest';
import { resolveCommandPlan } from '../components/spatial-provider/commandPlanResolution';
import { emptyMap } from '../components/spatial-provider/shared';
import type { AppMap, IntentStep, ToolCapabilityEntry } from '../types';

describe('resolveCommandPlan', () => {
  it('requests clarification when the preferred tool needs more information', async () => {
    const requestClarification = vi.fn((_question: string, _traceLabel: string): true => true);
    const resolver = {
      resolvePreferredToolIntent: vi.fn(async () => ({
        status: 'clarification' as const,
        question: 'Which assignee should I use?'
      }))
    };
    const strongPreferredTool: ToolCapabilityEntry = {
      id: 'assignTicket',
      description: 'Assign the current ticket',
      parameters: [
        {
          name: 'assignee',
          description: 'Ticket assignee',
          required: true
        }
      ],
      routes: ['/tickets'],
      safety: 'write',
      isGlobal: false,
      currentRouteMatches: true,
      requiresNavigation: false,
      semanticScore: 0.98,
      preferredForCommand: true,
      preferredReason: 'strong semantic match'
    };

    const result = await resolveCommandPlan({
      historyEntryId: 'cmd-1',
      baseCommand: 'assign this ticket',
      inputMethod: 'text',
      resolutionCommand: 'assign this ticket',
      resolutionCommandForContext: 'assign this ticket',
      resolutionMap: {
        ...emptyMap,
        currentRoute: '/tickets'
      },
      availableAppMap: null as AppMap | null,
      toolShortcutMatch: null,
      strongPreferredTool,
      deterministicResolution: null,
      remoteResolverAvailable: true,
      shouldAwaitMountDiscoveryBeforeExecution: false,
      enrichedContext: { inputMethod: 'text' },
      signal: new AbortController().signal,
      resolver: resolver as any,
      toolRegistry: {
        validateArgs: vi.fn(() => ({ ok: false, tool: null, reason: 'unused' }))
      } as any,
      appendCommandHistoryTrace: vi.fn(),
      updateCommandHistoryEntry: vi.fn(),
      buildRemoteResolutionPayload: (map, _commandText, _completedSteps, runtimeContext) => ({
        input: {
          command: 'assign this ticket',
          inputMethod: 'text',
          map,
          appMap: null,
          toolCapabilityMap: null,
          gazeTarget: null,
          gesture: 'none'
        },
        runtimeContext,
        report: {
          requestKind: 'preferred_tool_intent',
          profile: 'tool_first',
          targetTokens: 3000,
          estimatedTokens: 300,
          includedSections: [],
          droppedSections: [],
          filteredByNeverSend: 0,
          redactedFields: 0,
          budgetAdjusted: false
        }
      }),
      streamExecutionRuntime: {
        refreshMapForExecution: () => emptyMap,
        executeStreamedSequence: vi.fn()
      },
      requestClarification
    });

    expect(result).toEqual({
      status: 'clarification_requested'
    });
    expect(requestClarification).toHaveBeenCalledWith(
      'Which assignee should I use?',
      'Preferred tool requires clarification: assignTicket'
    );
    expect(resolver.resolvePreferredToolIntent).toHaveBeenCalledTimes(1);
  });

  it('returns a streamed remote plan when no deterministic or authoritative tool path matches', async () => {
    const plannedStep: IntentStep = {
      action: 'click',
      target: 'submit-ticket',
      reason: 'Submit the form'
    };
    const resolver = {
      resolveWithContextStreamInternal: vi.fn(async (_input, _runtimeContext, callbacks) => {
        callbacks?.onResolutionPriority?.('route_then_dom');
        callbacks?.onStep?.(plannedStep);
        return {
          type: 'dom_steps' as const,
          resolutionPriority: 'route_then_dom' as const,
          plan: {
            source: 'claude' as const,
            rawCommand: 'submit the form',
            confidence: 0.92,
            steps: [plannedStep]
          }
        };
      })
    };
    const streamedExecutionResult = {
      executed: true,
      completedSteps: 1,
      successDescription: 'submitted form'
    };

    const result = await resolveCommandPlan({
      historyEntryId: 'cmd-2',
      baseCommand: 'submit the form',
      inputMethod: 'text',
      resolutionCommand: 'submit the form',
      resolutionCommandForContext: 'submit the form',
      resolutionMap: {
        ...emptyMap,
        currentRoute: '/tickets'
      },
      availableAppMap: null as AppMap | null,
      toolShortcutMatch: null,
      strongPreferredTool: null,
      deterministicResolution: null,
      remoteResolverAvailable: true,
      shouldAwaitMountDiscoveryBeforeExecution: false,
      enrichedContext: { inputMethod: 'text' },
      signal: new AbortController().signal,
      resolver: resolver as any,
      toolRegistry: {} as any,
      appendCommandHistoryTrace: vi.fn(),
      updateCommandHistoryEntry: vi.fn(),
      buildRemoteResolutionPayload: (map, _commandText, _completedSteps, runtimeContext) => ({
        input: {
          command: 'submit the form',
          inputMethod: 'text',
          map,
          appMap: null,
          toolCapabilityMap: null,
          gazeTarget: null,
          gesture: 'none'
        },
        runtimeContext,
        report: {
          requestKind: 'plan',
          profile: 'form',
          targetTokens: 5000,
          estimatedTokens: 800,
          includedSections: [],
          droppedSections: [],
          filteredByNeverSend: 0,
          redactedFields: 0,
          budgetAdjusted: false
        }
      }),
      streamExecutionRuntime: {
        refreshMapForExecution: () => emptyMap,
        executeStreamedSequence: vi.fn(async () => streamedExecutionResult)
      },
      requestClarification: vi.fn((_question: string, _traceLabel: string): true => true)
    });

    expect(result.status).toBe('planned');
    if (result.status !== 'planned') {
      throw new Error('Expected a planned result');
    }

    expect(result.resolutionPriority).toBe('route_then_dom');
    expect(result.plan.steps).toEqual([plannedStep]);
    expect(result.initialExecutionResult).toEqual(streamedExecutionResult);
  });
});
