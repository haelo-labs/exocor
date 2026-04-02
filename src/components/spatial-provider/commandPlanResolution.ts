import type { DirectToolShortcutMatch, ToolRegistry } from '../../core/ToolRegistry';
import { type ResolverRequestKind, type ShapedResolverContext } from '../../core/ResolverContextShaper';
import { RemoteIntentResolver } from '../../core/RemoteIntentResolver';
import type {
  AppMap,
  CommandInputMethod,
  DOMCapabilityMap,
  IntentAction,
  IntentPlan,
  IntentResolutionInput,
  IntentStep,
  ResolutionPriority,
  SequenceExecutionResult,
  ToolCapabilityEntry
} from '../../types';
import {
  buildAuthoritativePreferredToolPlan,
  createAsyncStepQueue,
  createStreamingStepSanitizer,
  sanitizePlanStepsForUnrequestedPostSubmitNavigation
} from './commandPlanning';

type DeterministicResolution = {
  plan: IntentPlan;
  resolutionPriority: ResolutionPriority;
};

type BuildRemoteResolutionPayload = (
  map: DOMCapabilityMap,
  commandText: string,
  completedSteps?: IntentStep[],
  runtimeContext?: Record<string, unknown>,
  requestKind?: ResolverRequestKind
) => ShapedResolverContext;

interface StreamExecutionRuntime {
  refreshMapForExecution: () => DOMCapabilityMap;
  executeStreamedSequence: (
    steps: AsyncIterable<IntentStep>,
    executionMap: DOMCapabilityMap,
    context: {
      appMap: AppMap | null;
      resolutionPriority: ResolutionPriority;
    }
  ) => Promise<SequenceExecutionResult>;
}

interface CommandPlanResolutionOptions {
  historyEntryId: string;
  baseCommand: string;
  inputMethod: CommandInputMethod;
  resolutionCommand: string;
  resolutionCommandForContext: string;
  resolutionMap: DOMCapabilityMap;
  availableAppMap: AppMap | null;
  toolShortcutMatch: DirectToolShortcutMatch | null;
  strongPreferredTool: ToolCapabilityEntry | null;
  deterministicResolution: DeterministicResolution | null;
  remoteResolverAvailable: boolean;
  shouldAwaitMountDiscoveryBeforeExecution: boolean;
  enrichedContext?: Record<string, unknown>;
  signal: AbortSignal;
  resolver: RemoteIntentResolver | null;
  toolRegistry: ToolRegistry;
  appendCommandHistoryTrace: (id: string, label: string) => void;
  updateCommandHistoryEntry: (
    id: string,
    status: 'planning' | 'executing' | 'done' | 'failed' | 'clarification',
    message?: string
  ) => void;
  buildRemoteResolutionPayload: BuildRemoteResolutionPayload;
  streamExecutionRuntime: StreamExecutionRuntime;
  requestClarification: (question: string, traceLabel: string) => true;
}

interface PlannedCommandResult {
  status: 'planned';
  plan: IntentPlan;
  resolutionPriority: ResolutionPriority;
  latestIntentSource: IntentAction['source'];
  initialExecutionResult: SequenceExecutionResult | null;
  usedAuthoritativePreferredTool: boolean;
}

interface PendingCommandResult {
  status: 'not_resolved';
  resolutionPriority: ResolutionPriority;
  latestIntentSource: IntentAction['source'];
  usedAuthoritativePreferredTool: boolean;
}

interface ClarificationRequestedResult {
  status: 'clarification_requested';
}

export type CommandPlanResolutionResult =
  | PlannedCommandResult
  | PendingCommandResult
  | ClarificationRequestedResult;

interface PreferredToolResolutionResult {
  status: 'clarification_requested' | 'resolved' | 'fallback';
  plan?: IntentPlan;
  resolutionPriority?: ResolutionPriority;
  latestIntentSource?: IntentAction['source'];
  usedAuthoritativePreferredTool?: boolean;
}

export async function resolveCommandPlan({
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
  resolver,
  toolRegistry,
  appendCommandHistoryTrace,
  updateCommandHistoryEntry,
  buildRemoteResolutionPayload,
  streamExecutionRuntime,
  requestClarification
}: CommandPlanResolutionOptions): Promise<CommandPlanResolutionResult> {
  let resolvedPlan = deterministicResolution?.plan ?? null;
  let resolutionPriority = deterministicResolution?.resolutionPriority ?? 'dom_only';
  let latestIntentSource: IntentAction['source'] = deterministicResolution ? 'deterministic' : 'claude';
  let initialExecutionResult: SequenceExecutionResult | null = null;
  let usedAuthoritativePreferredTool = false;

  if (deterministicResolution) {
    if (toolShortcutMatch?.type === 'direct_execute') {
      appendCommandHistoryTrace(historyEntryId, `Matched app-native tool shortcut: ${toolShortcutMatch.tool.id}`);
    } else {
      appendCommandHistoryTrace(
        historyEntryId,
        `Matched deterministic instant action (${deterministicResolution.plan.steps.length} step${deterministicResolution.plan.steps.length === 1 ? '' : 's'})`
      );
    }
  }

  if (!resolvedPlan && strongPreferredTool) {
    const preferredToolResult = await resolvePreferredToolPlan({
      historyEntryId,
      resolutionCommand,
      resolutionMap,
      strongPreferredTool,
      remoteResolverAvailable,
      enrichedContext,
      signal,
      resolver,
      toolRegistry,
      appendCommandHistoryTrace,
      buildRemoteResolutionPayload,
      requestClarification
    });

    if (preferredToolResult.status === 'clarification_requested') {
      return {
        status: 'clarification_requested'
      };
    }

    if (preferredToolResult.status === 'resolved') {
      resolvedPlan = preferredToolResult.plan ?? null;
      resolutionPriority = preferredToolResult.resolutionPriority ?? resolutionPriority;
      latestIntentSource = preferredToolResult.latestIntentSource ?? latestIntentSource;
      usedAuthoritativePreferredTool = Boolean(preferredToolResult.usedAuthoritativePreferredTool);
    }
  }

  if (!resolvedPlan && remoteResolverAvailable && resolver) {
    const remotePlanResult = await resolveRemoteCommandPlan({
      historyEntryId,
      baseCommand,
      inputMethod,
      resolutionCommand,
      resolutionCommandForContext,
      resolutionMap,
      availableAppMap,
      shouldAwaitMountDiscoveryBeforeExecution,
      enrichedContext,
      signal,
      resolver,
      appendCommandHistoryTrace,
      updateCommandHistoryEntry,
      buildRemoteResolutionPayload,
      streamExecutionRuntime,
      requestClarification
    });

    if (remotePlanResult.status === 'clarification_requested') {
      return remotePlanResult;
    }

    if (remotePlanResult.status === 'planned') {
      resolvedPlan = remotePlanResult.plan;
      resolutionPriority = remotePlanResult.resolutionPriority;
      initialExecutionResult = remotePlanResult.initialExecutionResult;
    }
  }

  if (!resolvedPlan) {
    return {
      status: 'not_resolved',
      resolutionPriority,
      latestIntentSource,
      usedAuthoritativePreferredTool
    };
  }

  return {
    status: 'planned',
    plan: resolvedPlan,
    resolutionPriority,
    latestIntentSource,
    initialExecutionResult,
    usedAuthoritativePreferredTool
  };
}

async function resolvePreferredToolPlan({
  historyEntryId,
  resolutionCommand,
  resolutionMap,
  strongPreferredTool,
  remoteResolverAvailable,
  enrichedContext,
  signal,
  resolver,
  toolRegistry,
  appendCommandHistoryTrace,
  buildRemoteResolutionPayload,
  requestClarification
}: {
  historyEntryId: string;
  resolutionCommand: string;
  resolutionMap: DOMCapabilityMap;
  strongPreferredTool: ToolCapabilityEntry;
  remoteResolverAvailable: boolean;
  enrichedContext?: Record<string, unknown>;
  signal: AbortSignal;
  resolver: RemoteIntentResolver | null;
  toolRegistry: ToolRegistry;
  appendCommandHistoryTrace: (id: string, label: string) => void;
  buildRemoteResolutionPayload: BuildRemoteResolutionPayload;
  requestClarification: (question: string, traceLabel: string) => true;
}): Promise<PreferredToolResolutionResult> {
  if (!strongPreferredTool.parameters.length) {
    const plan = buildAuthoritativePreferredToolPlan(resolutionCommand, strongPreferredTool, {});
    appendAuthoritativeToolTrace(historyEntryId, strongPreferredTool, appendCommandHistoryTrace);
    return {
      status: 'resolved',
      plan,
      resolutionPriority: 'app_map_only',
      latestIntentSource: 'deterministic',
      usedAuthoritativePreferredTool: true
    };
  }

  if (!remoteResolverAvailable || !resolver) {
    appendCommandHistoryTrace(
      historyEntryId,
      `Preferred tool requires remote argument planning, but remote resolver is disabled: ${strongPreferredTool.id}`
    );
    return {
      status: 'fallback'
    };
  }

  appendCommandHistoryTrace(historyEntryId, `Resolving arguments for preferred tool: ${strongPreferredTool.id}`);
  const shapedPreferredToolPayload = buildRemoteResolutionPayload(
    resolutionMap,
    resolutionCommand,
    undefined,
    enrichedContext,
    'preferred_tool_intent'
  );
  const preferredToolIntent = await resolver.resolvePreferredToolIntent(
    shapedPreferredToolPayload.input,
    strongPreferredTool.id,
    strongPreferredTool.preferredReason || 'strong semantic match',
    signal
  );

  if (preferredToolIntent.status === 'clarification') {
    requestClarification(
      preferredToolIntent.question,
      `Preferred tool requires clarification: ${strongPreferredTool.id}`
    );
    return {
      status: 'clarification_requested'
    };
  }

  if (preferredToolIntent.status === 'ready') {
    const validation = toolRegistry.validateArgs(strongPreferredTool.id, preferredToolIntent.args);
    if (validation.ok) {
      const plan = buildAuthoritativePreferredToolPlan(resolutionCommand, strongPreferredTool, validation.args);
      appendAuthoritativeToolTrace(historyEntryId, strongPreferredTool, appendCommandHistoryTrace);
      return {
        status: 'resolved',
        plan,
        resolutionPriority: 'app_map_only',
        latestIntentSource: 'deterministic',
        usedAuthoritativePreferredTool: true
      };
    }

    appendCommandHistoryTrace(
      historyEntryId,
      `Preferred tool arguments failed validation; using normal planner behavior: ${validation.reason}`
    );
    return {
      status: 'fallback'
    };
  }

  appendCommandHistoryTrace(
    historyEntryId,
    `Preferred tool could not cover the full intent authoritatively; using normal planner behavior: ${preferredToolIntent.reason}`
  );
  return {
    status: 'fallback'
  };
}

async function resolveRemoteCommandPlan({
  historyEntryId,
  baseCommand,
  inputMethod,
  resolutionCommand,
  resolutionCommandForContext,
  resolutionMap,
  availableAppMap,
  shouldAwaitMountDiscoveryBeforeExecution,
  enrichedContext,
  signal,
  resolver,
  appendCommandHistoryTrace,
  updateCommandHistoryEntry,
  buildRemoteResolutionPayload,
  streamExecutionRuntime,
  requestClarification
}: {
  historyEntryId: string;
  baseCommand: string;
  inputMethod: CommandInputMethod;
  resolutionCommand: string;
  resolutionCommandForContext: string;
  resolutionMap: DOMCapabilityMap;
  availableAppMap: AppMap | null;
  shouldAwaitMountDiscoveryBeforeExecution: boolean;
  enrichedContext?: Record<string, unknown>;
  signal: AbortSignal;
  resolver: RemoteIntentResolver;
  appendCommandHistoryTrace: (id: string, label: string) => void;
  updateCommandHistoryEntry: (
    id: string,
    status: 'planning' | 'executing' | 'done' | 'failed' | 'clarification',
    message?: string
  ) => void;
  buildRemoteResolutionPayload: BuildRemoteResolutionPayload;
  streamExecutionRuntime: StreamExecutionRuntime;
  requestClarification: (question: string, traceLabel: string) => true;
}): Promise<CommandPlanResolutionResult> {
  const useStreamExecution = inputMethod !== 'voice' && !shouldAwaitMountDiscoveryBeforeExecution;
  const streamSanitizer = createStreamingStepSanitizer(baseCommand);
  const streamedSteps: IntentStep[] = [];
  const streamQueueRef: { current: ReturnType<typeof createAsyncStepQueue> | null } = { current: null };
  const streamExecutionRef: {
    current: Promise<SequenceExecutionResult> | null;
  } = { current: null };
  let didStartStreamExecution = false;
  let resolutionPriority: ResolutionPriority = 'dom_only';

  const beginStreamingExecution = (): void => {
    if (!streamQueueRef.current || streamExecutionRef.current) {
      return;
    }

    if (!didStartStreamExecution) {
      didStartStreamExecution = true;
      updateCommandHistoryEntry(historyEntryId, 'executing');
      appendCommandHistoryTrace(historyEntryId, 'Streaming plan and executing steps...');
    }

    const executionMap =
      resolutionPriority === 'dom_only' ? streamExecutionRuntime.refreshMapForExecution() : resolutionMap;
    streamExecutionRef.current = streamExecutionRuntime.executeStreamedSequence(
      streamQueueRef.current.iterable,
      executionMap,
      {
        appMap: availableAppMap,
        resolutionPriority
      }
    );
  };

  const pushStreamedStep = (step: IntentStep): void => {
    const sanitizedStep = streamSanitizer(step);
    if (!sanitizedStep) {
      return;
    }

    streamedSteps.push(sanitizedStep);
    if (!streamQueueRef.current) {
      streamQueueRef.current = createAsyncStepQueue();
    }

    streamQueueRef.current.push(sanitizedStep);
    beginStreamingExecution();
  };

  const streamResolutionPayload = buildRemoteResolutionPayload(
    resolutionMap,
    resolutionCommandForContext,
    undefined,
    enrichedContext,
    'plan'
  );
  let resolvedIntent;
  try {
    resolvedIntent = await resolver.resolveWithContextStreamInternal(
      streamResolutionPayload.input,
      streamResolutionPayload.runtimeContext,
      {
        onResolutionPriority: (priority) => {
          resolutionPriority = priority;
        },
        ...(useStreamExecution ? { onStep: pushStreamedStep } : {})
      },
      signal
    );
  } finally {
    streamQueueRef.current?.close();
  }

  if (resolvedIntent?.type === 'text_response') {
    if (streamExecutionRef.current) {
      try {
        await streamExecutionRef.current;
      } catch {
        // Ignore stream-execution teardown errors in text-response mode.
      }
    }

    requestClarification(resolvedIntent.text, 'Returned text response');
    return {
      status: 'clarification_requested'
    };
  }

  if (resolvedIntent?.type !== 'dom_steps') {
    return {
      status: 'not_resolved',
      resolutionPriority,
      latestIntentSource: 'claude',
      usedAuthoritativePreferredTool: false
    };
  }

  const sanitizedResolvedSteps = sanitizePlanStepsForUnrequestedPostSubmitNavigation(
    resolvedIntent.plan.steps,
    baseCommand
  );
  const resolvedSteps = useStreamExecution && streamedSteps.length > 0 ? streamedSteps : sanitizedResolvedSteps;
  appendCommandHistoryTrace(
    historyEntryId,
    `Planned ${resolvedSteps.length} step${resolvedSteps.length === 1 ? '' : 's'}`
  );
  resolutionPriority = resolvedIntent.resolutionPriority;

  return {
    status: 'planned',
    plan: {
      ...resolvedIntent.plan,
      steps: resolvedSteps
    },
    resolutionPriority,
    latestIntentSource: 'claude',
    initialExecutionResult:
      useStreamExecution && streamExecutionRef.current && streamedSteps.length > 0
        ? await streamExecutionRef.current
        : null,
    usedAuthoritativePreferredTool: false
  };
}

function appendAuthoritativeToolTrace(
  historyEntryId: string,
  strongPreferredTool: ToolCapabilityEntry,
  appendCommandHistoryTrace: (id: string, label: string) => void
): void {
  if (strongPreferredTool.currentRouteMatches || strongPreferredTool.isGlobal) {
    appendCommandHistoryTrace(historyEntryId, `Using authoritative preferred tool directly: ${strongPreferredTool.id}`);
    return;
  }

  appendCommandHistoryTrace(historyEntryId, `Using authoritative navigate -> tool path: ${strongPreferredTool.id}`);
}
