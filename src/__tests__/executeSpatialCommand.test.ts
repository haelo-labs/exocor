import { describe, expect, it, vi } from 'vitest';
import type { CommandHistoryItem } from '../components/ChatPanel';
import { executeSpatialCommand } from '../components/spatial-provider/executeSpatialCommand';
import { EMPTY_GAZE_STATE, EMPTY_GESTURE_STATE, emptyMap } from '../components/spatial-provider/shared';
import type { AppMap, DOMCapabilityMap, IntentAction, ResolutionStatus } from '../types';

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

describe('executeSpatialCommand', () => {
  it('fails closed when remote resolution is disabled and no local path matches', async () => {
    const domMap: DOMCapabilityMap = {
      ...emptyMap,
      currentRoute: '/tickets',
      pageTitle: 'Tickets'
    };
    const lastIntentState = createStateRecorder<IntentAction | null>(null);
    const isResolvingState = createStateRecorder(false);
    const resolutionStatusState = createStateRecorder<ResolutionStatus>('idle');
    const progressMessageState = createStateRecorder<string | null>(null);
    const chatInputState = createStateRecorder('');
    const panelOpenState = createStateRecorder(false);
    const domMapState = createStateRecorder(domMap);
    const updateCommandHistoryEntry = vi.fn();
    const appendCommandHistoryTrace = vi.fn();

    const result = await executeSpatialCommand({
      command: 'assign ticket to alex',
      inputMethod: 'text',
      resolvingRef: { current: false },
      domMapRef: { current: domMap },
      gazeRef: { current: EMPTY_GAZE_STATE },
      gestureRef: { current: EMPTY_GESTURE_STATE },
      appMapRef: { current: null as AppMap | null },
      discoveryPromiseRef: { current: null as Promise<AppMap | null> | null },
      domScannerRef: {
        current: {
          refresh: () => domMap
        } as any
      },
      resolverRef: { current: null },
      deterministicResolverRef: {
        current: {
          resolve: () => null
        } as any
      },
      executorRef: {
        current: {} as any
      },
      activeCommandAbortRef: { current: null },
      activeCommandHistoryIdRef: { current: null },
      routerNavigateRef: { current: null },
      lastHostFocusedElementRef: { current: null },
      lastHostTextEntryElementRef: { current: null },
      domScannerPolicy: {
        reactHints: true,
        routerHints: true,
        excludedSelectors: [],
        captureElements: true
      },
      resolvedTrustPolicy: {
        features: {
          remoteResolver: false,
          appMapDiscovery: false,
          liveDomScanning: false,
          reactHints: true,
          routerHints: true,
          tools: true
        },
        neverScan: [],
        neverSend: [],
        redact: []
      },
      toolRegistry: {
        tools: [],
        hasTools: () => false,
        getTool: () => null,
        buildCapabilityMap: () => ({
          currentRoute: '/tickets',
          preferredToolIds: [],
          tools: []
        }),
        resolveDirectToolShortcut: () => null,
        validateArgs: () => ({ ok: false, tool: null, reason: 'not used' })
      },
      pendingClarification: null,
      addCommandHistoryEntry: () => 'cmd-1',
      updateCommandHistoryEntry,
      appendCommandHistoryTrace,
      awaitBootstrappedAppMap: async () => null,
      runAppMapDiscovery: vi.fn(async () => null),
      saveFallbackAppMapToCache: vi.fn(),
      setPendingClarification: vi.fn(),
      setVoiceClarificationQuestion: vi.fn(),
      setLastIntent: lastIntentState.set,
      setIsResolving: isResolvingState.set,
      setResolutionStatus: resolutionStatusState.set,
      setProgressMessage: progressMessageState.set,
      setChatInput: chatInputState.set,
      setIsPanelOpen: panelOpenState.set,
      setDomMap: domMapState.set,
      showPreview: vi.fn(),
      showToast: vi.fn(),
      dismissToast: vi.fn(),
      shapeRemoteResolverPayload: (input, runtimeContext) => ({
        input,
        runtimeContext,
        report: {
          requestKind: 'plan',
          profile: 'general',
          targetTokens: 5000,
          estimatedTokens: 500,
          includedSections: [],
          droppedSections: [],
          filteredByNeverSend: 0,
          redactedFields: 0,
          budgetAdjusted: false
        }
      })
    });

    expect(result).toBe(false);
    expect(isResolvingState.value).toBe(false);
    expect(resolutionStatusState.value).toBe('unresolved');
    expect(progressMessageState.value).toBe('Remote resolver is disabled and no local plan matched');
    expect(lastIntentState.value).toBeNull();
    expect(chatInputState.value).toBe('');
    expect(panelOpenState.value).toBe(false);
    expect(updateCommandHistoryEntry).toHaveBeenCalledWith(
      'cmd-1',
      'failed',
      'Remote resolver is disabled and no local plan matched'
    );
    expect(appendCommandHistoryTrace).toHaveBeenCalledWith(
      'cmd-1',
      'Remote resolver is disabled and no local plan matched'
    );
  });
});
