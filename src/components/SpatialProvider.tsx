import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { ActionExecutor } from '../core/ActionExecutor';
import {
  buildScopedStorageKey,
  DOMScanner,
  type DOMScannerPolicy,
  resolveCurrentAppCacheScope
} from '../core/DOMScanner';
import { DeterministicIntentResolver } from '../core/DeterministicIntentResolver';
import { RemoteIntentResolver } from '../core/RemoteIntentResolver';
import { shapeResolverContext } from '../core/ResolverContextShaper';
import { createToolRegistry } from '../core/ToolRegistry';
import { resolveTrustPolicy } from '../core/contextPolicy';
import { isSdkUiElement } from '../core/sdkUi';
import { resolveSdkTheme, useSdkThemeMode } from '../core/sdkTheme';
import type {
  CommandInputMethod,
  DOMMapState,
  GazeState,
  GestureState,
  IntentAction,
  IntentState,
  SpatialProviderProps,
  VoiceState
} from '../types';
import { ChatPanel } from './ChatPanel';
import { LauncherButton } from './LauncherButton';
import { ClarificationPrompt } from './ClarificationPrompt';
import { DiscoveryOverlay } from './DiscoveryOverlay';
import { GazeOverlay } from './GazeOverlay';
import { SdkShadowHost } from './SdkShadowHost';
import { StatusToast } from './StatusToast';
import type { StatusIndicatorState } from './StatusIndicator';
import { VoiceTranscriptBubble } from './VoiceTranscriptBubble';
import { normalizeCommand } from './spatial-provider/commandRuntime';
import { executeSpatialCommand } from './spatial-provider/executeSpatialCommand';
import { isTextEntryElement } from './spatial-provider/hostDomUtils';
import { ACTIVE_MODALITIES_STORAGE_KEY, DEFAULT_MODALITIES } from './spatial-provider/modalityPreferences';
import { EMPTY_GAZE_STATE, EMPTY_GESTURE_STATE, emptyMap, type VoiceGazeSnapshot } from './spatial-provider/runtimeState';
import { useAppMapRuntime } from './spatial-provider/useAppMapRuntime';
import { useCommandHistoryRuntime } from './spatial-provider/useCommandHistoryRuntime';
import { useModalityRuntime } from './spatial-provider/useModalityRuntime';
import { useProviderUiRuntime } from './spatial-provider/useProviderUiRuntime';

const EMPTY_TOOLS: NonNullable<SpatialProviderProps['tools']> = [];

interface SpatialContextValue {
  voice: VoiceState;
  gaze: GazeState;
  gesture: GestureState;
  intent: IntentState;
  domMap: DOMMapState;
}

const SpatialContext = createContext<SpatialContextValue | null>(null);

/**
 * Mounts the SDK around a host React tree and orchestrates discovery, intent
 * resolution, and multimodal input.
 */
export function SpatialProvider({
  children,
  backendUrl,
  modalities = DEFAULT_MODALITIES,
  debug = Boolean(false),
  tools,
  trustPolicy,
  onAppMapped
}: SpatialProviderProps): JSX.Element {
  const themeMode = useSdkThemeMode();
  const theme = useMemo(() => resolveSdkTheme(themeMode), [themeMode]);
  const availableModalities = useMemo(
    () => DEFAULT_MODALITIES.filter((modality) => modalities.includes(modality)),
    [modalities]
  );
  const resolvedTrustPolicy = useMemo(() => resolveTrustPolicy(trustPolicy), [trustPolicy]);
  const domScannerPolicy = useMemo<DOMScannerPolicy>(
    () => ({
      reactHints: resolvedTrustPolicy.features.reactHints,
      routerHints: resolvedTrustPolicy.features.routerHints,
      excludedSelectors: resolvedTrustPolicy.neverScan,
      captureElements: resolvedTrustPolicy.features.liveDomScanning
    }),
    [resolvedTrustPolicy]
  );
  const initialModalityScopeRef = useRef(resolveCurrentAppCacheScope());
  const modalityStorageKey = useMemo(
    () => buildScopedStorageKey(ACTIVE_MODALITIES_STORAGE_KEY, initialModalityScopeRef.current),
    []
  );

  const [domMap, setDomMap] = useState(emptyMap);
  const [lastIntent, setLastIntent] = useState<IntentAction | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionStatus, setResolutionStatus] = useState<'idle' | 'resolving' | 'executed' | 'failed' | 'unresolved'>('idle');
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const {
    chatInput,
    isPanelOpen,
    resolvedIntentPreview,
    toastState,
    setChatInput,
    setIsPanelOpen,
    showPreview,
    dismissToast,
    showToast
  } = useProviderUiRuntime();

  const domScannerRef = useRef<DOMScanner | null>(null);
  const resolverRef = useRef<RemoteIntentResolver | null>(null);
  const deterministicResolverRef = useRef<DeterministicIntentResolver | null>(null);
  const executorRef = useRef<ActionExecutor | null>(null);
  const resolvingRef = useRef(false);
  const domMapRef = useRef(domMap);
  const gazeRef = useRef<GazeState>(EMPTY_GAZE_STATE);
  const gestureRef = useRef<GestureState>(EMPTY_GESTURE_STATE);
  const routerNavigateRef = useRef<((path: string) => void | Promise<unknown>) | null>(null);
  const lastHostFocusedElementRef = useRef<HTMLElement | null>(null);
  const lastHostTextEntryElementRef = useRef<HTMLElement | null>(null);
  const initialHistoryRouteRef = useRef(typeof window === 'undefined' ? '/' : window.location.pathname || '/');
  const initialHistoryTitleRef = useRef(typeof document === 'undefined' ? 'untitled' : document.title || 'untitled');
  const activeCommandAbortRef = useRef<AbortController | null>(null);
  const activeCommandHistoryIdRef = useRef<string | null>(null);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || isSdkUiElement(target)) {
        return;
      }
      lastHostFocusedElementRef.current = target;
      if (isTextEntryElement(target)) {
        lastHostTextEntryElementRef.current = target;
      }
    };

    document.addEventListener('focusin', onFocusIn, true);
    return () => {
      document.removeEventListener('focusin', onFocusIn, true);
    };
  }, []);

  useEffect(() => {
    domMapRef.current = domMap;
  }, [domMap]);

  useEffect(() => {
    resolvingRef.current = isResolving;
  }, [isResolving]);

  const resolver = useMemo(
    () =>
      new RemoteIntentResolver({
        backendUrl,
        debug
      }),
    [backendUrl, debug]
  );
  const effectiveTools = useMemo(
    () => (resolvedTrustPolicy.features.tools ? tools || EMPTY_TOOLS : EMPTY_TOOLS),
    [resolvedTrustPolicy.features.tools, tools]
  );
  const toolRegistry = useMemo(() => createToolRegistry(effectiveTools), [effectiveTools]);

  useEffect(() => {
    resolverRef.current = resolver;
  }, [resolver]);

  if (!executorRef.current) {
    executorRef.current = new ActionExecutor(debug);
  }

  if (!deterministicResolverRef.current) {
    deterministicResolverRef.current = new DeterministicIntentResolver();
  }

  const refreshMap = useCallback(() => {
    if (!domScannerRef.current) {
      return;
    }

    const nextMap = domScannerRef.current.refresh();
    setDomMap(nextMap);
  }, []);

  const {
    commandHistory,
    pendingClarification,
    voiceClarificationQuestion,
    addCommandHistoryEntry,
    updateCommandHistoryEntry,
    appendCommandHistoryTrace,
    clearCommandHistory,
    setPendingClarification,
    setVoiceClarificationQuestion
  } = useCommandHistoryRuntime({
    initialRoutePath: initialHistoryRouteRef.current,
    initialTitle: initialHistoryTitleRef.current
  });

  const {
    appMapRef,
    discoveryPromiseRef,
    isDiscovering,
    runAppMapDiscovery,
    awaitBootstrappedAppMap,
    saveFallbackAppMapToCache
  } = useAppMapRuntime({
    appMapDiscoveryEnabled: resolvedTrustPolicy.features.appMapDiscovery,
    domMap,
    domMapRef,
    domScannerPolicy,
    onAppMapped
  });

  const stopActiveCommand = useCallback(() => {
    const controller = activeCommandAbortRef.current;
    if (!controller || controller.signal.aborted) {
      return false;
    }

    controller.abort(new DOMException('Stopped by user.', 'AbortError'));
    setProgressMessage('Stopping...');
    const activeHistoryEntryId = activeCommandHistoryIdRef.current;
    if (activeHistoryEntryId) {
      appendCommandHistoryTrace(activeHistoryEntryId, 'Stop requested');
      updateCommandHistoryEntry(activeHistoryEntryId, 'executing', 'Stopping...');
    }
    return true;
  }, [appendCommandHistoryTrace, updateCommandHistoryEntry]);

  const shapeRemoteResolverPayload = useCallback(
    (
      input: Parameters<typeof shapeResolverContext>[0]['input'],
      runtimeContext?: Record<string, unknown>,
      requestKind?: Parameters<typeof shapeResolverContext>[0]['requestKind']
    ) => {
      const shaped = shapeResolverContext({
        input,
        runtimeContext,
        trustPolicy: resolvedTrustPolicy,
        requestKind
      });

      if (debug) {
        // eslint-disable-next-line no-console
        console.log('[Exocor] Resolver context report:', shaped.report);
      }

      return shaped;
    },
    [debug, resolvedTrustPolicy]
  );

  const executeCommand = useCallback(
    async (
      command: string,
      inputMethod: CommandInputMethod = 'text',
      voiceGazeSnapshot: VoiceGazeSnapshot | null = null
    ) =>
      executeSpatialCommand({
        command,
        inputMethod,
        voiceGazeSnapshot,
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
      }),
    [
      addCommandHistoryEntry,
      appendCommandHistoryTrace,
      appMapRef,
      awaitBootstrappedAppMap,
      discoveryPromiseRef,
      dismissToast,
      domScannerPolicy,
      pendingClarification,
      resolvedTrustPolicy,
      runAppMapDiscovery,
      saveFallbackAppMapToCache,
      shapeRemoteResolverPayload,
      showPreview,
      showToast,
      toolRegistry
    ]
  );

  const {
    voice,
    gaze,
    gesture,
    activeModalities,
    isAudioCapturing,
    isMicrophoneEnabled,
    canToggleModalities,
    handleModalityToggle,
    pointerTracker
  } = useModalityRuntime({
    availableModalities,
    modalityStorageKey,
    domMapRef,
    domScannerPolicy,
    setDomMap,
    executeCommand,
    setLastIntent,
    setResolutionStatus,
    setProgressMessage,
    showPreview
  });

  useEffect(() => {
    gazeRef.current = gaze;
  }, [gaze]);

  useEffect(() => {
    gestureRef.current = gesture;
  }, [gesture]);

  useEffect(() => {
    const scanner = new DOMScanner((map) => {
      setDomMap(map);
    }, () => domScannerPolicy);

    domScannerRef.current = scanner;
    scanner.start();

    return () => {
      scanner.stop();
      domScannerRef.current = null;
    };
  }, [domScannerPolicy]);

  useEffect(() => {
    return () => {
      activeCommandAbortRef.current?.abort(new DOMException('Stopped by user.', 'AbortError'));
    };
  }, []);

  const launcherStatus = useMemo<StatusIndicatorState>(() => {
    if (isResolving) {
      return 'executing';
    }

    if (availableModalities.includes('voice') && isMicrophoneEnabled && voice.isListening && isAudioCapturing) {
      return 'listening';
    }

    return 'idle';
  }, [availableModalities, isAudioCapturing, isMicrophoneEnabled, isResolving, voice.isListening]);

  const showVoiceTranscriptBubble =
    activeModalities.voice &&
    (activeModalities.gaze || activeModalities.gesture) &&
    isMicrophoneEnabled &&
    voice.isListening &&
    isAudioCapturing &&
    pointerTracker.showCursor &&
    Boolean(voice.transcript.trim());

  const hoveredElementRect = useMemo(() => {
    if (!gaze.gazeTarget) {
      return null;
    }
    const matchedElement = domMap.elements.find((element) => element.id === gaze.gazeTarget);
    return matchedElement?.rect || null;
  }, [domMap.elements, gaze.gazeTarget]);

  const contextValue = useMemo<SpatialContextValue>(
    () => ({
      voice,
      gaze,
      gesture,
      intent: {
        lastIntent,
        isResolving,
        resolutionStatus,
        resolvedIntentPreview,
        progressMessage,
        execute: executeCommand
      },
      domMap: {
        elements: domMap.elements,
        routes: domMap.routes,
        refresh: refreshMap
      }
    }),
    [
      domMap.elements,
      domMap.routes,
      executeCommand,
      gaze,
      gesture,
      isResolving,
      lastIntent,
      progressMessage,
      refreshMap,
      resolvedIntentPreview,
      resolutionStatus,
      voice
    ]
  );

  return (
    <SpatialContext.Provider value={contextValue}>
      {children}
      <SdkShadowHost>
        <DiscoveryOverlay open={isDiscovering} themeMode={theme.mode} />
        <GazeOverlay
          videoRef={pointerTracker.videoRef}
          cursorRef={pointerTracker.cursorRef}
          dragCursorRef={pointerTracker.dragCursorRef}
          visible={!isDiscovering && (activeModalities.gaze || activeModalities.gesture) && pointerTracker.showCursor}
          isPinching={pointerTracker.isPinching}
          showDragCursor={pointerTracker.isDragging}
          gazeTarget={gaze.gazeTarget}
          isDragging={pointerTracker.isDragging}
          isCalibrated={gaze.isCalibrated}
          hoverRect={hoveredElementRect}
          themeMode={themeMode}
        />
        <VoiceTranscriptBubble
          visible={showVoiceTranscriptBubble}
          transcript={voice.transcript}
          x={gaze.gazeX}
          y={gaze.gazeY}
          themeMode={themeMode}
        />
        <StatusToast
          open={toastState.open}
          message={toastState.message}
          variant={toastState.variant}
          onDismiss={dismissToast}
          themeMode={themeMode}
        />
        <ClarificationPrompt
          open={Boolean(voiceClarificationQuestion)}
          question={voiceClarificationQuestion}
          themeMode={themeMode}
        />
        <ChatPanel
          open={isPanelOpen}
          input={chatInput}
          history={commandHistory}
          canToggle={canToggleModalities}
          isResolving={isResolving}
          onInputChange={setChatInput}
          onModalityToggle={handleModalityToggle}
          onOpenChange={setIsPanelOpen}
          onStop={stopActiveCommand}
          onSubmit={(value) => {
            const normalized = normalizeCommand(value);
            if (!normalized) {
              return;
            }
            setChatInput('');
            void executeCommand(normalized, 'text');
          }}
          onClearHistory={clearCommandHistory}
          pendingClarificationQuestion={voiceClarificationQuestion ? null : pendingClarification?.question ?? null}
          modalitiesStatus={activeModalities}
          themeMode={themeMode}
        />
        <LauncherButton
          open={isPanelOpen}
          status={launcherStatus}
          onToggle={() => setIsPanelOpen((previous) => !previous)}
          themeMode={themeMode}
        />
      </SdkShadowHost>
    </SpatialContext.Provider>
  );
}

/** Returns all SpatialProvider state and actions for internal hooks. */
export function useSpatialContext(): SpatialContextValue {
  const context = useContext(SpatialContext);

  if (!context) {
    throw new Error('SpatialProvider is missing. Wrap your app in <SpatialProvider>.');
  }

  return context;
}
