import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { ActionExecutor, isSubmitLikeCompletionStep } from '../core/ActionExecutor';
import * as DOMScannerModule from '../core/DOMScanner';
import {
  APP_MAP_VERSION,
  clearAppMapCache,
  DOMScanner,
  getRouterNavigateFromFiber,
  readCachedAppMap,
  readCachedAppMapWithReason,
  resolveCurrentAppCacheScope,
  saveAppMapToCache
} from '../core/DOMScanner';
import { DeterministicIntentResolver } from '../core/DeterministicIntentResolver';
import { RemoteIntentResolver } from '../core/RemoteIntentResolver';
import { createToolRegistry, normalizeToolRoutePath } from '../core/ToolRegistry';
import {
  ChatPanel,
  type CommandHistoryItem,
  type CommandInputMethod as CommandHistoryInputMethod
} from './ChatPanel';
import { EntryPointButton } from './EntryPointButton';
import { FloatingClarification } from './FloatingClarification';
import { GazeOverlay } from './GazeOverlay';
import { LearningOverlay } from './LearningOverlay';
import { SdkShadowHost } from './SdkShadowHost';
import { StatusToast, type StatusToastVariant } from './StatusToast';
import { type StatusIndicatorState } from './StatusIndicator';
import { VoiceTranscriptBubble } from './VoiceTranscriptBubble';
import { isSdkUiElement, SDK_UI_MARKER } from '../core/sdkUi';
import { resolveSdkTheme, useSdkThemeMode } from '../core/sdkTheme';
import { useFaceNoseCursor } from '../utils/mediapipe';
import { createSpeechController, type SpeechController } from '../utils/speech';
import type {
  AppMap,
  CommandInputMethod,
  DOMCapabilityMap,
  DOMElementDescriptor,
  DOMMapState,
  GazeState,
  GestureState,
  IntentAction,
  IntentState,
  IntentStep,
  IntentPlan,
  ResolutionStatus,
  ResolutionPriority,
  SpatialProviderProps,
  ToolCapabilityEntry,
  ToolCapabilityMap,
  VoiceState
} from '../types';

const DEFAULT_MODALITIES: Array<'voice' | 'gaze' | 'gesture'> = ['voice', 'gaze', 'gesture'];
const EMPTY_TOOLS: NonNullable<SpatialProviderProps['tools']> = [];
const SILENCE_TIMEOUT_MS = 1200;
const APP_MAP_BOOTSTRAP_GRACE_MS = 0;
const HISTORY_STORAGE_KEY = 'exocor.command-history.v1';
const LEGACY_HISTORY_STORAGE_KEY = 'haelo.command-history.v1';
const HISTORY_SESSION_STORAGE_KEY = LEGACY_HISTORY_STORAGE_KEY;
type VoiceGazeSnapshot = GazeState;

interface PendingClarificationState {
  question: string;
  baseCommand: string;
  historyEntryId: string;
}

interface SpatialContextValue {
  voice: VoiceState;
  gaze: GazeState;
  gesture: GestureState;
  intent: IntentState;
  domMap: DOMMapState;
}

const emptyMap: DOMCapabilityMap = {
  elements: [],
  routes: [],
  currentRoute: '/',
  currentUrl: '',
  routeParams: {},
  pageTitle: '',
  headings: [],
  navigation: [],
  formState: [],
  buttonsState: [],
  visibleErrors: [],
  dialogs: [],
  tableRows: [],
  listItems: [],
  cards: [],
  statusBadges: [],
  stateHints: [],
  activeItems: [],
  countBadges: [],
  compressed: {
    pageSummary: '',
    currentRoute: '/',
    currentUrl: '',
    routes: [],
    gazeTargetId: null,
    elements: [],
    selectorMap: {},
    tableSummary: '',
    listSummary: '',
    tokenEstimate: 0
  },
  updatedAt: Date.now()
};

const SpatialContext = createContext<SpatialContextValue | null>(null);

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createAbortError(): DOMException {
  return new DOMException('Stopped by user.', 'AbortError');
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return promise;
  }

  if (signal.aborted) {
    return Promise.reject(createAbortError());
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      }
    );
  });
}

function toLabelKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildFallbackAppMapFromDom(map: DOMCapabilityMap): AppMap {
  const path = map.currentRoute || window.location.pathname || '/';
  const visibleSurface = map.dialogs.find((dialog) => dialog.isOpen);
  const routeTitle = map.pageTitle || document.title || path;
  const formFields = map.formState.map((field) => ({
    elementId: field.selector,
    label: field.label || field.name || field.selector,
    type: field.type || 'input',
    required: false,
    selectorCandidates: [field.selector]
  }));
  const buttons = map.buttonsState.map((button) => ({
    elementId: button.selector,
    label: button.label || button.selector,
    selectorCandidates: [button.selector]
  }));
  const locators = [
    ...map.navigation.map((entry) => ({
      id: `${path}::navigation::${toLabelKey(entry.label || entry.href || 'navigate')}::${toLabelKey(entry.selector)}`,
      kind: 'navigation' as const,
      label: entry.label || entry.href || 'Navigate',
      labelKey: toLabelKey(entry.label || entry.href || 'navigate'),
      selectorCandidates: [entry.selector],
      path: entry.href || path,
      clickable: true,
      tagName: 'a',
      role: 'link'
    })),
    ...formFields.map((field) => ({
      id: `${path}::formField::${toLabelKey(field.label)}::${toLabelKey(field.elementId)}`,
      kind: 'formField' as const,
      label: field.label,
      labelKey: toLabelKey(field.label),
      selectorCandidates: field.selectorCandidates || [],
      fillable: true
    })),
    ...buttons.map((button) => ({
      id: `${path}::${
        /\b(create|save|submit|add|confirm|apply|finish|complete)\b/i.test(button.label) ? 'submit' : 'button'
      }::${toLabelKey(button.label)}::${toLabelKey(button.elementId)}`,
      kind: /\b(create|save|submit|add|confirm|apply|finish|complete)\b/i.test(button.label)
        ? ('submit' as const)
        : ('button' as const),
      label: button.label,
      labelKey: toLabelKey(button.label),
      selectorCandidates: button.selectorCandidates || [],
      clickable: true,
      tagName: 'button',
      role: 'button'
    }))
  ];

  return {
    version: APP_MAP_VERSION,
    discoveredAt: Date.now(),
    routeCount: 1,
    routes: [
      {
        path,
        componentName: 'FallbackRoute',
        title: routeTitle,
        navigationLinks: map.navigation.map((entry) => ({
          label: entry.label || entry.href || 'Navigate',
          path: entry.href || path,
          elementId: entry.selector,
          selectorCandidates: [entry.selector]
        })),
        modalTriggers:
          visibleSurface && (formFields.length || buttons.length)
            ? [
                {
                  elementId: visibleSurface.selector,
                  label: visibleSurface.label || `${routeTitle} Form`,
                  selectorCandidates: [visibleSurface.selector],
                  modalContents: {
                    formFields: formFields.map((field) => ({
                      label: field.label,
                      type: field.type,
                      required: field.required,
                      elementId: field.elementId,
                      selectorCandidates: field.selectorCandidates
                    })),
                    buttons
                  }
                }
              ]
            : [],
        formFields,
        buttons,
        filters: [],
        tabs: [],
        locators,
        headings: map.headings.map((heading) => heading.text).filter(Boolean)
      }
    ]
  };
}

function commandExplicitlyRequestsNavigation(command: string): boolean {
  const normalized = normalizeCommand(command).toLowerCase();
  if (!normalized) {
    return false;
  }

  if (/\/[a-z0-9/_-]+/.test(normalized)) {
    return true;
  }

  return /\b(navigate|go to|take me to|bring me to|switch to|open page|open route|visit|show page|show screen)\b/.test(
    normalized
  );
}

function sanitizePlanStepsForUnrequestedPostSubmitNavigation(
  steps: IntentStep[],
  command: string
): IntentStep[] {
  if (!steps.length) {
    return steps;
  }
  const sanitizeStep = createStreamingStepSanitizer(command);
  const sanitized: IntentStep[] = [];
  for (const step of steps) {
    const accepted = sanitizeStep(step);
    if (accepted) {
      sanitized.push(accepted);
    }
  }
  return sanitized;
}

function createStreamingStepSanitizer(command: string): (step: IntentStep) => IntentStep | null {
  if (commandExplicitlyRequestsNavigation(command)) {
    return (step: IntentStep) => step;
  }

  let submitLikeCompletionSeen = false;
  return (step: IntentStep): IntentStep | null => {
    if (
      submitLikeCompletionSeen &&
      step.action === 'navigate' &&
      step.target &&
      step.target.startsWith('/')
    ) {
      return null;
    }

    if (
      isSubmitLikeCompletionStep({
        step,
        resolvedTargetLabel: step.target || ''
      })
    ) {
      submitLikeCompletionSeen = true;
    }

    return step;
  };
}

interface AsyncStepQueue {
  iterable: AsyncIterable<IntentStep>;
  push: (step: IntentStep) => void;
  close: () => void;
}

function createAsyncStepQueue(): AsyncStepQueue {
  const values: IntentStep[] = [];
  const waiting: Array<(result: IteratorResult<IntentStep>) => void> = [];
  let closed = false;

  const iterable: AsyncIterable<IntentStep> = {
    [Symbol.asyncIterator](): AsyncIterator<IntentStep> {
      return {
        next(): Promise<IteratorResult<IntentStep>> {
          if (values.length) {
            const value = values.shift() as IntentStep;
            return Promise.resolve({ value, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            waiting.push(resolve);
          });
        },
        return(): Promise<IteratorResult<IntentStep>> {
          closed = true;
          while (waiting.length) {
            const resolve = waiting.shift();
            resolve?.({ value: undefined, done: true });
          }
          return Promise.resolve({ value: undefined, done: true });
        }
      };
    }
  };

  return {
    iterable,
    push: (step: IntentStep): void => {
      if (closed) {
        return;
      }
      if (waiting.length) {
        const resolve = waiting.shift();
        resolve?.({ value: step, done: false });
        return;
      }
      values.push(step);
    },
    close: (): void => {
      if (closed) {
        return;
      }
      closed = true;
      while (waiting.length) {
        const resolve = waiting.shift();
        resolve?.({ value: undefined, done: true });
      }
    }
  };
}

function escapeCss(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function resolveSelectorForElement(element: Element | null): string | null {
  if (!element) {
    return null;
  }

  const htmlElement = element as HTMLElement;
  if (htmlElement.id) {
    return `#${escapeCss(htmlElement.id)}`;
  }

  const testId = htmlElement.getAttribute('data-testid') || htmlElement.getAttribute('data-test-id');
  if (testId) {
    return `[data-testid="${escapeCss(testId)}"]`;
  }

  const name = htmlElement.getAttribute('name');
  if (name) {
    return `${htmlElement.tagName.toLowerCase()}[name="${escapeCss(name)}"]`;
  }

  return htmlElement.tagName.toLowerCase();
}

function stepToIntent(step: IntentStep, source: IntentAction['source'], rawCommand: string): IntentAction | null {
  if (step.action === 'wait') {
    return null;
  }

  const toolId = step.toolId || step.target || '';
  return {
    action: step.action,
    target: step.target || toolId,
    value: step.value ?? null,
    ...(toolId ? { toolId } : {}),
    ...(step.args ? { args: step.args } : {}),
    confidence: 0.9,
    source,
    rawCommand
  };
}

function formatProgress(step: IntentStep): string {
  if (step.action === 'tool') {
    const toolId = step.toolId || step.target || 'unknown-tool';
    return `Used app-native tool: ${toolId}`;
  }
  const reason = step.reason || step.action;
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}...`;
}

function buildDirectToolPlan(command: string, toolId: string): IntentPlan {
  return {
    source: 'deterministic',
    rawCommand: normalizeCommand(command),
    confidence: 0.99,
    steps: [
      {
        action: 'tool',
        toolId,
        args: {},
        reason: 'use explicit app-native tool'
      }
    ]
  };
}

function buildAuthoritativePreferredToolPlan(
  command: string,
  preferredTool: ToolCapabilityEntry,
  args: Record<string, unknown>
): IntentPlan {
  const steps: IntentStep[] = [];

  if (!preferredTool.isGlobal && !preferredTool.currentRouteMatches && preferredTool.routes[0]) {
    steps.push({
      action: 'navigate',
      target: preferredTool.routes[0],
      value: null,
      waitForDOM: true,
      reason: `navigate to ${preferredTool.routes[0]} for app-native tool`
    });
  }

  steps.push({
    action: 'tool',
    toolId: preferredTool.id,
    args,
    reason: 'use preferred app-native tool'
  });

  return {
    source: 'deterministic',
    rawCommand: normalizeCommand(command),
    confidence: 0.99,
    steps
  };
}

function getPreferredToolEntries(toolCapabilityMap: ToolCapabilityMap | null): ToolCapabilityEntry[] {
  if (!toolCapabilityMap?.preferredToolIds?.length) {
    return [];
  }

  return toolCapabilityMap.tools.filter((tool) => toolCapabilityMap.preferredToolIds.includes(tool.id));
}

function getStrongPreferredTool(toolCapabilityMap: ToolCapabilityMap | null): ToolCapabilityEntry | null {
  const preferredTools = getPreferredToolEntries(toolCapabilityMap);
  return preferredTools.length === 1 ? preferredTools[0] : null;
}

function planUsesTool(plan: IntentPlan, toolId: string): boolean {
  return plan.steps.some((step) => step.action === 'tool' && (step.toolId || step.target) === toolId);
}

function isNavigateThenToolPlan(plan: IntentPlan, toolId: string): boolean {
  const steps = plan.steps.filter((step) => step.action !== 'wait');
  const toolIndex = steps.findIndex((step) => step.action === 'tool' && (step.toolId || step.target) === toolId);
  if (toolIndex <= 0) {
    return false;
  }

  return steps.slice(0, toolIndex).some((step) => step.action === 'navigate' && step.target?.startsWith('/'));
}

function toHistoryInputMethod(inputMethod: CommandInputMethod): CommandHistoryInputMethod {
  if (inputMethod === 'voice') {
    return 'voice';
  }
  if (inputMethod === 'text') {
    return 'typed';
  }
  return 'gaze';
}

function statusFromFailureMessage(message: string): CommandHistoryItem['status'] {
  return 'failed';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

const HISTORY_STATUSES = new Set<CommandHistoryItem['status']>([
  'planning',
  'executing',
  'done',
  'failed',
  'clarification'
]);

const HISTORY_INPUT_METHODS = new Set<CommandHistoryInputMethod>(['voice', 'typed', 'gaze']);

function sanitizePersistedHistory(raw: unknown): CommandHistoryItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const now = Date.now();
  const fallbackTraceAt = now;

  return raw
    .map((entry, index) => {
      if (!isRecord(entry)) {
        return null;
      }

      const rawStatus = typeof entry.status === 'string' ? entry.status : '';
      const status = HISTORY_STATUSES.has(rawStatus as CommandHistoryItem['status'])
        ? (rawStatus as CommandHistoryItem['status'])
        : 'failed';

      const rawInputMethod = typeof entry.inputMethod === 'string' ? entry.inputMethod : '';
      const inputMethod = HISTORY_INPUT_METHODS.has(rawInputMethod as CommandHistoryInputMethod)
        ? (rawInputMethod as CommandHistoryInputMethod)
        : 'typed';

      const traces = Array.isArray(entry.traces)
        ? entry.traces
            .map((trace, traceIndex) => {
              if (!isRecord(trace)) {
                return null;
              }
              const label = typeof trace.label === 'string' ? trace.label : '';
              if (!label) {
                return null;
              }

              return {
                id:
                  typeof trace.id === 'string' && trace.id
                    ? trace.id
                    : `trace-${fallbackTraceAt}-${index}-${traceIndex}`,
                label,
                at: typeof trace.at === 'number' && Number.isFinite(trace.at) ? trace.at : fallbackTraceAt
              };
            })
            .filter((trace): trace is CommandHistoryItem['traces'][number] => Boolean(trace))
        : [];

      return {
        id:
          typeof entry.id === 'string' && entry.id
            ? entry.id
            : `cmd-${fallbackTraceAt}-${index}`,
        command: typeof entry.command === 'string' ? entry.command : '',
        status,
        inputMethod,
        createdAt:
          typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
            ? entry.createdAt
            : fallbackTraceAt,
        traces,
        ...(typeof entry.message === 'string' ? { message: entry.message } : {})
      };
    })
    .filter((entry): entry is CommandHistoryItem => Boolean(entry));
}

function normalizeHistoryStoragePath(pathname: string): string {
  const trimmed = pathname.trim();
  if (!trimmed) {
    return '/';
  }

  const withoutQuery = trimmed.split('?')[0]?.split('#')[0] || '';
  const prefixed = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  const collapsed = prefixed.replace(/\/{2,}/g, '/');
  if (collapsed.length > 1 && collapsed.endsWith('/')) {
    return collapsed.slice(0, -1);
  }

  return collapsed || '/';
}

function normalizeHistoryStorageTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase() || 'untitled';
}

function hashHistoryStorageSignature(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildStableHistoryStorageKey(routePath: string, title: string, baseKey = HISTORY_STORAGE_KEY): string {
  const origin = typeof window === 'undefined' ? 'server' : window.location.origin || 'unknown-origin';
  const normalizedRoute = normalizeHistoryStoragePath(routePath);
  const normalizedTitle = normalizeHistoryStorageTitle(title);
  const signature = `${origin}||route:${normalizedRoute}||title:${normalizedTitle}`;
  return `${baseKey}::scope-${hashHistoryStorageSignature(signature)}`;
}

function getAllHistoryStorageKeys(stableRoutePath: string, stableTitle: string): string[] {
  return [buildStableHistoryStorageKey(stableRoutePath, stableTitle)];
}

function getLegacyHistoryStorageKeys(stableRoutePath: string, stableTitle: string): string[] {
  return [buildStableHistoryStorageKey(stableRoutePath, stableTitle, LEGACY_HISTORY_STORAGE_KEY)];
}

function isTextEntryElement(element: HTMLElement | null): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === 'textarea' || tagName === 'select') {
    return true;
  }

  if (tagName !== 'input') {
    return false;
  }

  const inputType = ((element as HTMLInputElement).type || '').toLowerCase();
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'image'].includes(
    inputType
  );
}

function findElementByNode(node: HTMLElement, elements: DOMElementDescriptor[]): DOMElementDescriptor | null {
  for (const element of elements) {
    if (!element.selector) {
      continue;
    }

    try {
      if (node.matches(element.selector)) {
        return element;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function resolveFocusedElement(
  map: DOMCapabilityMap,
  preferredFocusedElement: HTMLElement | null = null,
  preferredTextEntryElement: HTMLElement | null = null
): { elementId: string | null; componentName: string | null; type: string | null } | null {
  const activeElement = document.activeElement;
  const fallbackFocusedElement =
    preferredFocusedElement instanceof HTMLElement && preferredFocusedElement.isConnected ? preferredFocusedElement : null;
  const fallbackTextEntryElement =
    preferredTextEntryElement instanceof HTMLElement && preferredTextEntryElement.isConnected
      ? preferredTextEntryElement
      : null;
  const resolvedElement =
    activeElement instanceof HTMLElement && !isSdkUiElement(activeElement)
      ? activeElement
      : fallbackTextEntryElement || fallbackFocusedElement;

  if (!(resolvedElement instanceof HTMLElement) || isSdkUiElement(resolvedElement)) {
    return null;
  }

  const matchedElement = findElementByNode(resolvedElement, map.elements);
  return {
    elementId: matchedElement?.id || null,
    componentName: matchedElement?.componentName || null,
    type:
      (resolvedElement as HTMLInputElement).type ||
      resolvedElement.getAttribute('role') ||
      resolvedElement.tagName.toLowerCase()
  };
}

function resolveGazeTarget(
  map: DOMCapabilityMap,
  gazeState: GazeState
): { elementId: string | null; componentName: string | null; text: string } | null {
  if (gazeState.gazeTarget) {
    const matchedElement = map.elements.find((element) => element.id === gazeState.gazeTarget);
    return {
      elementId: gazeState.gazeTarget,
      componentName: matchedElement?.componentName || null,
      text: matchedElement?.text || matchedElement?.label || ''
    };
  }

  if (!gazeState.isCalibrated) {
    return null;
  }

  const { gazeX, gazeY } = gazeState;
  if (!Number.isFinite(gazeX) || !Number.isFinite(gazeY)) {
    return null;
  }

  const atPoint = map.elements
    .filter((element) => element.visible !== false)
    .filter((element) => {
      const { x, y, width, height } = element.rect;
      return gazeX >= x && gazeX <= x + width && gazeY >= y && gazeY <= y + height;
    })
    .sort((a, b) => a.rect.width * a.rect.height - (b.rect.width * b.rect.height));

  const fallback = atPoint[0];
  if (!fallback) {
    return null;
  }

  return {
    elementId: fallback.id,
    componentName: fallback.componentName || null,
    text: fallback.text || fallback.label || ''
  };
}

function buildEnrichedContext(
  inputMethod: CommandInputMethod,
  map: DOMCapabilityMap,
  gazeState: GazeState,
  preferredFocusedElement: HTMLElement | null = null,
  preferredTextEntryElement: HTMLElement | null = null
): Record<string, unknown> {
  if (inputMethod === 'text') {
    return {
      inputMethod: 'typed',
      focusedElement: resolveFocusedElement(map, preferredFocusedElement, preferredTextEntryElement),
      selectedText: window.getSelection?.()?.toString() || ''
    };
  }

  return {
    inputMethod,
    gazeTarget: resolveGazeTarget(map, gazeState),
    gazePosition: {
      x: gazeState.gazeX,
      y: gazeState.gazeY
    }
  };
}

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
  onAppMapped
}: SpatialProviderProps): JSX.Element {
  const themeMode = useSdkThemeMode();
  const theme = useMemo(() => resolveSdkTheme(themeMode), [themeMode]);
  const [domMap, setDomMap] = useState<DOMCapabilityMap>(emptyMap);
  const [voice, setVoice] = useState<VoiceState>({ transcript: '', isListening: false, confidence: 0 });
  const [gaze, setGaze] = useState<GazeState>({ gazeTarget: null, gazeX: 0, gazeY: 0, isCalibrated: false });
  const [gesture, setGesture] = useState<GestureState>({ gesture: 'none', hand: 'unknown', confidence: 0 });
  const [lastIntent, setLastIntent] = useState<IntentAction | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [resolutionStatus, setResolutionStatus] = useState<ResolutionStatus>('idle');
  const [resolvedIntentPreview, setResolvedIntentPreview] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState('');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [isMicrophoneEnabled, setIsMicrophoneEnabled] = useState(false);
  const [isAudioCapturing, setIsAudioCapturing] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [commandHistory, setCommandHistory] = useState<CommandHistoryItem[]>([]);
  const [pendingClarification, setPendingClarification] = useState<PendingClarificationState | null>(null);
  const [voiceClarificationQuestion, setVoiceClarificationQuestion] = useState<string | null>(null);
  const [appMap, setAppMap] = useState<AppMap | null>(null);
  const [toastState, setToastState] = useState<{
    open: boolean;
    variant: StatusToastVariant;
    message: string;
  }>({
    open: false,
    variant: 'planning',
    message: ''
  });

  const domScannerRef = useRef<DOMScanner | null>(null);
  const speechControllerRef = useRef<SpeechController | null>(null);
  const resolverRef = useRef<RemoteIntentResolver | null>(null);
  const deterministicResolverRef = useRef<DeterministicIntentResolver | null>(null);
  const executorRef = useRef<ActionExecutor | null>(null);
  const silenceTimerRef = useRef<number | null>(null);
  const audioCaptureTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const historyCounterRef = useRef(0);
  const historyTraceCounterRef = useRef(0);
  const lastVoiceSubmissionRef = useRef<string>('');
  const voiceGazeSnapshotRef = useRef<VoiceGazeSnapshot | null>(null);
  const microphoneEnabledRef = useRef(isMicrophoneEnabled);
  const resolvingRef = useRef(false);
  const domMapRef = useRef<DOMCapabilityMap>(domMap);
  const gazeRef = useRef(gaze);
  const gestureRef = useRef(gesture);
  const appMapRef = useRef<AppMap | null>(null);
  const discoveryPromiseRef = useRef<Promise<AppMap | null> | null>(null);
  const routerNavigateRef = useRef<((path: string) => void | Promise<unknown>) | null>(null);
  const lastHostFocusedElementRef = useRef<HTMLElement | null>(null);
  const lastHostTextEntryElementRef = useRef<HTMLElement | null>(null);
  const isMountedRef = useRef(true);
  const initialHistoryRouteRef = useRef(
    typeof window === 'undefined' ? '/' : window.location.pathname || '/'
  );
  const initialHistoryTitleRef = useRef(
    typeof document === 'undefined' ? 'untitled' : document.title || 'untitled'
  );
  const [isHistoryHydrated, setIsHistoryHydrated] = useState(false);
  const activeCommandAbortRef = useRef<AbortController | null>(null);
  const activeCommandHistoryIdRef = useRef<string | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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
    gazeRef.current = gaze;
  }, [gaze]);

  useEffect(() => {
    gestureRef.current = gesture;
  }, [gesture]);

  useEffect(() => {
    appMapRef.current = appMap;
  }, [appMap]);

  useEffect(() => {
    resolvingRef.current = isResolving;
  }, [isResolving]);

  useEffect(() => {
    microphoneEnabledRef.current = isMicrophoneEnabled;
  }, [isMicrophoneEnabled]);

  const resolver = useMemo(
    () =>
      new RemoteIntentResolver({
        backendUrl,
        debug
      }),
    [backendUrl, debug]
  );
  const toolRegistry = useMemo(() => createToolRegistry(tools || EMPTY_TOOLS), [tools]);

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

  const showPreview = useCallback((value: string | null) => {
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
    }

    setResolvedIntentPreview(value);

    if (value) {
      previewTimerRef.current = window.setTimeout(() => {
        setResolvedIntentPreview(null);
      }, 2800);
    }
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
      toastTimerRef.current = null;
    }
    setToastState((previous) => ({ ...previous, open: false }));
  }, []);

  const showToast = useCallback(
    (variant: StatusToastVariant, message: string, autoDismissMs?: number) => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
        toastTimerRef.current = null;
      }

      setToastState({
        open: true,
        variant,
        message
      });

      if (autoDismissMs) {
        toastTimerRef.current = window.setTimeout(() => {
          setToastState((previous) => ({ ...previous, open: false }));
        }, autoDismissMs);
      }
    },
    []
  );

  const setAndNotifyAppMap = useCallback(
    (nextAppMap: AppMap | null) => {
      appMapRef.current = nextAppMap;
      setAppMap(nextAppMap);
      if (nextAppMap) {
        onAppMapped?.(nextAppMap);
      }
    },
    [onAppMapped]
  );

  const runAppMapDiscovery = useCallback(
    async ({
      showOverlay,
      reason,
      forceRefresh = false
    }: {
      showOverlay: boolean;
      reason: string;
      forceRefresh?: boolean;
    }): Promise<AppMap | null> => {
      if (discoveryPromiseRef.current) {
        return discoveryPromiseRef.current;
      }

      const scope = resolveCurrentAppCacheScope();
      if (forceRefresh) {
        clearAppMapCache(scope);
      }

      // eslint-disable-next-line no-console
      console.log(showOverlay ? '[Exocor Discovery] mount bootstrap reason:' : '[Exocor Discovery] refresh reason:', reason);

      if (showOverlay) {
        setAndNotifyAppMap(null);
        setIsDiscovering(true);
      }

      discoveryPromiseRef.current = (async () => {
        try {
          const discovered = await DOMScannerModule.discoverAppMap();
          if (isMountedRef.current) {
            setAndNotifyAppMap(discovered);
          }
          return discovered;
        } catch {
          if (isMountedRef.current && showOverlay) {
            setAndNotifyAppMap(null);
          }
          return null;
        } finally {
          if (isMountedRef.current && showOverlay) {
            setIsDiscovering(false);
          }
          discoveryPromiseRef.current = null;
        }
      })();

      return discoveryPromiseRef.current;
    },
    [setAndNotifyAppMap]
  );

  const awaitBootstrappedAppMap = useCallback(async (): Promise<AppMap | null> => {
    if (appMapRef.current) {
      return appMapRef.current;
    }
    if (discoveryPromiseRef.current) {
      return discoveryPromiseRef.current;
    }
    return appMapRef.current;
  }, []);

  const addCommandHistoryEntry = useCallback((command: string, inputMethod: CommandInputMethod): string => {
    const id = `cmd-${Date.now()}-${historyCounterRef.current++}`;
    const startedAt = Date.now();
    const nextEntry: CommandHistoryItem = {
      id,
      command,
      status: 'planning',
      inputMethod: toHistoryInputMethod(inputMethod),
      createdAt: startedAt,
      traces: [
        {
          id: `trace-${startedAt}-${historyTraceCounterRef.current++}`,
          label: `Command received from ${toHistoryInputMethod(inputMethod)}`,
          at: startedAt
        }
      ]
    };
    setCommandHistory((previous) => [nextEntry, ...previous]);
    return id;
  }, []);

  const updateCommandHistoryEntry = useCallback(
    (id: string, status: CommandHistoryItem['status'], message?: string) => {
      setCommandHistory((previous) => previous.map((entry) => (entry.id === id ? { ...entry, status, message } : entry)));
    },
    []
  );

  const clearCommandHistory = useCallback(() => {
    setCommandHistory([]);
    setPendingClarification(null);
    setVoiceClarificationQuestion(null);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setIsHistoryHydrated(true);
      return;
    }

    const availableHistoryKeys = [
      ...getAllHistoryStorageKeys(initialHistoryRouteRef.current, initialHistoryTitleRef.current),
      ...getLegacyHistoryStorageKeys(initialHistoryRouteRef.current, initialHistoryTitleRef.current)
    ];
    const scopedEntry = availableHistoryKeys
      .map((key) => ({ key, raw: window.localStorage.getItem(key) }))
      .find((entry) => Boolean(entry.raw));

    if (scopedEntry?.raw) {
      try {
        const parsed = JSON.parse(scopedEntry.raw) as unknown;
        const sanitized = sanitizePersistedHistory(parsed);
        setCommandHistory(sanitized);
        for (const key of getAllHistoryStorageKeys(initialHistoryRouteRef.current, initialHistoryTitleRef.current)) {
          window.localStorage.setItem(key, JSON.stringify(sanitized));
        }
        if (scopedEntry.key.includes(LEGACY_HISTORY_STORAGE_KEY)) {
          window.localStorage.removeItem(scopedEntry.key);
        }
        setIsHistoryHydrated(true);
        return;
      } catch {
        window.localStorage.removeItem(scopedEntry.key);
      }
    }

    const legacyRaw = window.sessionStorage.getItem(HISTORY_SESSION_STORAGE_KEY);
    if (!legacyRaw) {
      setIsHistoryHydrated(true);
      return;
    }

    try {
      const parsed = JSON.parse(legacyRaw) as unknown;
      const sanitized = sanitizePersistedHistory(parsed);
      setCommandHistory(sanitized);
      for (const key of getAllHistoryStorageKeys(initialHistoryRouteRef.current, initialHistoryTitleRef.current)) {
        window.localStorage.setItem(key, JSON.stringify(sanitized));
      }
      window.sessionStorage.removeItem(HISTORY_SESSION_STORAGE_KEY);
    } catch {
      window.sessionStorage.removeItem(HISTORY_SESSION_STORAGE_KEY);
    } finally {
      setIsHistoryHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHistoryHydrated || typeof window === 'undefined') {
      return;
    }

    for (const key of getAllHistoryStorageKeys(initialHistoryRouteRef.current, initialHistoryTitleRef.current)) {
      window.localStorage.setItem(key, JSON.stringify(commandHistory));
    }
  }, [commandHistory, isHistoryHydrated]);

  useEffect(() => {
    const scope = resolveCurrentAppCacheScope();
    const cached = readCachedAppMapWithReason(scope);

    if (cached.appMap) {
      setAndNotifyAppMap(cached.appMap);
      setIsDiscovering(false);
      return;
    }

    void runAppMapDiscovery({
      showOverlay: true,
      reason: cached.reason
    });
  }, [runAppMapDiscovery, setAndNotifyAppMap]);

  const appendCommandHistoryTrace = useCallback((id: string, label: string) => {
    const now = Date.now();
    setCommandHistory((previous) =>
      previous.map((entry) => {
        if (entry.id !== id) {
          return entry;
        }
        const lastTrace = entry.traces[entry.traces.length - 1];
        if (lastTrace?.label === label) {
          return entry;
        }
        return {
          ...entry,
          traces: [
            ...entry.traces,
            {
              id: `trace-${now}-${historyTraceCounterRef.current++}`,
              label,
              at: now
            }
          ]
        };
      })
    );
  }, []);

  const stopActiveCommand = useCallback(() => {
    const controller = activeCommandAbortRef.current;
    if (!controller || controller.signal.aborted) {
      return false;
    }

    controller.abort(createAbortError());
    setProgressMessage('Stopping...');
    const activeHistoryEntryId = activeCommandHistoryIdRef.current;
    if (activeHistoryEntryId) {
      appendCommandHistoryTrace(activeHistoryEntryId, 'Stop requested');
      updateCommandHistoryEntry(activeHistoryEntryId, 'executing', 'Stopping...');
    }
    return true;
  }, [appendCommandHistoryTrace, updateCommandHistoryEntry]);

  const onFaceGaze = useCallback((sample: { x: number; y: number; target: HTMLElement | null; isCalibrated: boolean }) => {
    const targetSelector = sample.target ? resolveSelectorForElement(sample.target) : null;
    const targetMatch = targetSelector
      ? domMapRef.current.elements.find((element) => element.selector === targetSelector)
      : null;
    const targetId = targetMatch?.id || null;
    setGaze({
      gazeTarget: targetId,
      gazeX: sample.x,
      gazeY: sample.y,
      isCalibrated: sample.isCalibrated
    });
  }, []);

  const onPinchState = useCallback((sample: { isPinching: boolean }) => {
    setGesture({
      gesture: sample.isPinching ? 'pinch' : 'none',
      hand: 'unknown',
      confidence: sample.isPinching ? 0.9 : 0
    });
  }, []);

  const onPinchClick = useCallback(
    (sample: { target: Element | null; x: number; y: number }) => {
      const targetSelector =
        sample.target && !isSdkUiElement(sample.target) ? resolveSelectorForElement(sample.target) : null;

      if (!targetSelector) {
        return;
      }

      const pinchIntent: IntentAction = {
        action: 'click',
        target: targetSelector,
        value: null,
        confidence: 0.9,
        source: 'manual',
        rawCommand: 'pinch click'
      };

      setLastIntent(pinchIntent);
      setResolutionStatus('executed');
      setProgressMessage('Pinch click executed');
      showPreview('Pinch click executed');
    },
    [showPreview]
  );

  const faceCursorOptions = useMemo(
    () => ({
      onGaze: onFaceGaze,
      onPinchState,
      onPinchClick
    }),
    [onFaceGaze, onPinchState, onPinchClick]
  );

  const faceCursor = useFaceNoseCursor(faceCursorOptions);

  const clearSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
  }, []);

  const captureVoiceGazeSnapshot = useCallback((): VoiceGazeSnapshot => {
    const snapshot: VoiceGazeSnapshot = {
      gazeTarget: gazeRef.current.gazeTarget,
      gazeX: gazeRef.current.gazeX,
      gazeY: gazeRef.current.gazeY,
      isCalibrated: gazeRef.current.isCalibrated
    };
    voiceGazeSnapshotRef.current = snapshot;
    return snapshot;
  }, []);

  const resetVoiceGazeSnapshot = useCallback(() => {
    voiceGazeSnapshotRef.current = null;
  }, []);

  const clearVoiceTranscript = useCallback(() => {
    setVoice((previous) => {
      if (!previous.transcript && previous.confidence === 0) {
        return previous;
      }

      return {
        ...previous,
        transcript: '',
        confidence: 0
      };
    });
  }, []);

  const resetVoiceUtteranceState = useCallback(() => {
    clearSilenceTimer();
    resetVoiceGazeSnapshot();
  }, [clearSilenceTimer, resetVoiceGazeSnapshot]);

  const executeCommand = useCallback(
    async (
      command: string,
      inputMethod: CommandInputMethod = 'text',
      voiceGazeSnapshot: VoiceGazeSnapshot | null = null
    ): Promise<boolean> => {
      const normalizedCommand = normalizeCommand(command);
      if (!normalizedCommand || resolvingRef.current || !executorRef.current) {
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
        lastHostTextEntryElementRef.current
      );
      const cachedAppMap = readCachedAppMap();
      const mountDiscoveryPromise = discoveryPromiseRef.current;
      const latestCachedAppMap = readCachedAppMap();
      let availableAppMap =
        appMapRef.current ||
        cachedAppMap ||
        (await Promise.race([
          awaitBootstrappedAppMap(),
          sleep(APP_MAP_BOOTSTRAP_GRACE_MS).then(() => null)
        ])) ||
        appMapRef.current ||
        latestCachedAppMap;
      const shouldAwaitMountDiscoveryBeforeExecution =
        !appMapRef.current && !cachedAppMap && Boolean(mountDiscoveryPromise);
      if (!availableAppMap) {
        availableAppMap = buildFallbackAppMapFromDom(resolutionMap);
        saveAppMapToCache(availableAppMap);
        setAndNotifyAppMap(availableAppMap);
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
      ) => ({
        command: commandText,
        inputMethod,
        map,
        appMap: availableAppMap,
        toolCapabilityMap: buildToolCapabilityMap(map),
        gazeTarget: commandGazeState.gazeTarget ?? null,
        gesture: gestureRef.current.gesture || 'none',
        ...(completedSteps ? { completedSteps } : {})
      });

      const toolShortcutMatch =
        activePendingClarification || !toolRegistry.hasTools()
          ? null
          : toolRegistry.resolveDirectToolShortcut(
              resolutionCommand,
              normalizeToolRoutePath(resolutionMap.currentRoute || window.location.pathname || '/')
            );
      const deterministicResolution =
        activePendingClarification || !deterministicResolverRef.current
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
      if (!deterministicResolution && !resolverRef.current) {
        return false;
      }

      const abortController = new AbortController();
      const signal = abortController.signal;
      activeCommandAbortRef.current = abortController;
      activeCommandHistoryIdRef.current = historyEntryId;
      const handleStoppedCommand = (): boolean => {
        setIsResolving(false);
        setResolutionStatus('failed');
        setProgressMessage('Stopped');
        showPreview('Stopped');
        dismissToast();
        appendCommandHistoryTrace(historyEntryId, 'Stopped by user');
        updateCommandHistoryEntry(historyEntryId, 'failed', 'Stopped');
        return false;
      };

      setIsResolving(true);
      setResolutionStatus('resolving');
      try {
        if (deterministicResolution) {
          setProgressMessage('Executing instant action...');
          showToast('executing', 'Executing instant action...');
          appendCommandHistoryTrace(historyEntryId, 'Executing instant action');
          updateCommandHistoryEntry(historyEntryId, 'executing', 'Instant action matched');
        } else {
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
        }

        setDomMap(resolutionMap);

        let resolvedPlan: IntentPlan | null = null;
        let resolutionPriority: ResolutionPriority = 'dom_only';
        let latestIntentSource: IntentAction['source'] = deterministicResolution ? 'deterministic' : 'claude';
        let initialExecutionResult = null as Awaited<ReturnType<ActionExecutor['executeSequence']>> | null;
        let usedAuthoritativePreferredTool = false;
        const refreshMapForExecution = (): DOMCapabilityMap => {
          const refreshed = domScannerRef.current?.refresh() || domMapRef.current;
          routerNavigateRef.current = getRouterNavigateFromFiber();
          setDomMap(refreshed);
          return refreshed;
        };
        const navigateWithFiberDriver = async (path: string): Promise<boolean> => {
          const navigate = routerNavigateRef.current || getRouterNavigateFromFiber();
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
        const handleClarificationRequest = (question: string, traceLabel: string): boolean => {
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
        };
        if (deterministicResolution) {
          resolvedPlan = deterministicResolution.plan;
          resolutionPriority = deterministicResolution.resolutionPriority;
          if (toolShortcutMatch?.type === 'direct_execute') {
            appendCommandHistoryTrace(historyEntryId, `Matched app-native tool shortcut: ${toolShortcutMatch.tool.id}`);
          } else {
            appendCommandHistoryTrace(
              historyEntryId,
              `Matched deterministic instant action (${resolvedPlan.steps.length} step${resolvedPlan.steps.length === 1 ? '' : 's'})`
            );
          }
        }
        if (!resolvedPlan && strongPreferredTool && resolverRef.current) {
          if (!strongPreferredTool.parameters.length) {
            resolvedPlan = buildAuthoritativePreferredToolPlan(resolutionCommand, strongPreferredTool, {});
            resolutionPriority = 'app_map_only';
            latestIntentSource = 'deterministic';
            usedAuthoritativePreferredTool = true;
            if (strongPreferredTool.currentRouteMatches || strongPreferredTool.isGlobal) {
              appendCommandHistoryTrace(
                historyEntryId,
                `Using authoritative preferred tool directly: ${strongPreferredTool.id}`
              );
            } else {
              appendCommandHistoryTrace(
                historyEntryId,
                `Using authoritative navigate -> tool path: ${strongPreferredTool.id}`
              );
            }
          } else {
            appendCommandHistoryTrace(historyEntryId, `Resolving arguments for preferred tool: ${strongPreferredTool.id}`);
            const preferredToolIntent = await resolverRef.current.resolvePreferredToolIntent(
              buildResolutionInput(resolutionMap, resolutionCommand),
              strongPreferredTool.id,
              strongPreferredTool.preferredReason || 'strong semantic match',
              signal
            );

            if (preferredToolIntent.status === 'clarification') {
              return handleClarificationRequest(
                preferredToolIntent.question,
                `Preferred tool requires clarification: ${strongPreferredTool.id}`
              );
            }

            if (preferredToolIntent.status === 'ready') {
              const validation = toolRegistry.validateArgs(strongPreferredTool.id, preferredToolIntent.args);
              if (validation.ok) {
                resolvedPlan = buildAuthoritativePreferredToolPlan(resolutionCommand, strongPreferredTool, validation.args);
                resolutionPriority = 'app_map_only';
                latestIntentSource = 'deterministic';
                usedAuthoritativePreferredTool = true;
                if (strongPreferredTool.currentRouteMatches || strongPreferredTool.isGlobal) {
                  appendCommandHistoryTrace(
                    historyEntryId,
                    `Using authoritative preferred tool directly: ${strongPreferredTool.id}`
                  );
                } else {
                  appendCommandHistoryTrace(
                    historyEntryId,
                    `Using authoritative navigate -> tool path: ${strongPreferredTool.id}`
                  );
                }
              } else {
                appendCommandHistoryTrace(
                  historyEntryId,
                  `Preferred tool arguments failed validation; using normal planner behavior: ${validation.reason}`
                );
              }
            } else {
              appendCommandHistoryTrace(
                historyEntryId,
                `Preferred tool could not cover the full intent authoritatively; using normal planner behavior: ${preferredToolIntent.reason}`
              );
            }
          }
        }

        if (!resolvedPlan && resolverRef.current) {
          const useStreamExecution = inputMethod !== 'voice' && !shouldAwaitMountDiscoveryBeforeExecution;
          const streamSanitizer = createStreamingStepSanitizer(baseCommand);
          const streamedSteps: IntentStep[] = [];
          const streamQueueRef: { current: AsyncStepQueue | null } = { current: null };
          const streamExecutionRef: {
            current: Promise<Awaited<ReturnType<ActionExecutor['executeSequence']>>> | null;
          } = { current: null };
          let didStartStreamExecution = false;

          const beginStreamingExecution = (): void => {
            if (!streamQueueRef.current || streamExecutionRef.current || !executorRef.current) {
              return;
            }
            if (!didStartStreamExecution) {
              didStartStreamExecution = true;
              updateCommandHistoryEntry(historyEntryId, 'executing');
              appendCommandHistoryTrace(historyEntryId, 'Streaming plan and executing steps...');
            }

            const executionMap = resolutionPriority === 'dom_only' ? refreshMapForExecution() : resolutionMap;
            streamExecutionRef.current = executorRef.current.executeStreamedSequence(
              streamQueueRef.current.iterable,
              executionMap,
              {
                refreshMap: refreshMapForExecution,
                appMap: availableAppMap,
                navigate: navigateWithFiberDriver,
                resolutionPriority,
                toolRegistry,
                signal,
                onProgress: (_message, step) => {
                  const stepMessage = formatProgress(step);
                  setProgressMessage(stepMessage);
                  showToast('executing', stepMessage);
                  updateCommandHistoryEntry(historyEntryId, 'executing');
                  appendCommandHistoryTrace(historyEntryId, stepMessage);
                },
                defaultDelayMs: 0,
                originalIntent: resolutionCommand
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

          const streamResolutionInput = buildResolutionInput(resolutionMap, resolutionCommandForContext);
          let resolvedIntent;
          try {
            resolvedIntent = await resolverRef.current.resolveWithContextStreamInternal(
              streamResolutionInput,
              enrichedContext,
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

            return handleClarificationRequest(resolvedIntent.text, 'Returned text response');
          } else if (resolvedIntent?.type === 'dom_steps') {
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
            resolvedPlan = {
              ...resolvedIntent.plan,
              steps: resolvedSteps
            };
            if (useStreamExecution && streamExecutionRef.current && streamedSteps.length > 0) {
              initialExecutionResult = await streamExecutionRef.current;
            }
          }
        }

        if (!resolvedPlan) {
          appendCommandHistoryTrace(historyEntryId, 'Falling back to DOM-only resolution');
          const fallbackMap = refreshMapForExecution();
          const fallbackResolutionInput = buildResolutionInput(fallbackMap, resolutionCommand);
          resolutionPriority = 'dom_only';
          resolvedPlan = await resolverRef.current!.resolve(fallbackResolutionInput, signal);
          if (resolvedPlan) {
            resolvedPlan = {
              ...resolvedPlan,
              steps: sanitizePlanStepsForUnrequestedPostSubmitNavigation(resolvedPlan.steps, baseCommand)
            };
          }
        }

        if (!resolvedPlan || !resolvedPlan.steps.length) {
          setIsResolving(false);
          setResolutionStatus('unresolved');
          const unresolvedMessage = 'Unable to resolve intent';
          setProgressMessage(unresolvedMessage);
          showPreview('No steps returned by resolver');
          showToast('failed', unresolvedMessage);
          appendCommandHistoryTrace(historyEntryId, unresolvedMessage);
          updateCommandHistoryEntry(historyEntryId, statusFromFailureMessage(unresolvedMessage), unresolvedMessage);

          if (inputMethod === 'voice') {
            setChatInput(normalizedCommand);
          }

          return false;
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
        let didAttemptScopedAppMapRefresh = false;
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
          const sequenceOptions = {
            refreshMap: refreshMapForExecution,
            appMap: availableAppMap,
            navigate: navigateWithFiberDriver,
            resolutionPriority,
            toolRegistry,
            signal,
            onProgress: (_message: string, step: IntentStep) => {
              const stepMessage = formatProgress(step);
              setProgressMessage(stepMessage);
              showToast('executing', stepMessage);
              updateCommandHistoryEntry(historyEntryId, 'executing');
              appendCommandHistoryTrace(historyEntryId, stepMessage);
            },
            defaultDelayMs: inputMethod === 'voice' ? 0 : 150,
            originalIntent: resolutionCommand
          };
          result = await executorRef.current.executeSequence(resolvedPlan.steps, executionMap, sequenceOptions);
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

        const shouldAttemptScopedAppMapRefresh =
          !result.executed &&
          !didAttemptScopedAppMapRefresh &&
          Boolean(availableAppMap) &&
          resolutionPriority !== 'dom_only' &&
          result.failedStep &&
          result.failedStepReason?.toLowerCase().includes('target not found');

        if (shouldAttemptScopedAppMapRefresh) {
          didAttemptScopedAppMapRefresh = true;
          setProgressMessage('Refreshing cached app map...');
          showToast('planning', 'Refreshing cached app map...');
          appendCommandHistoryTrace(historyEntryId, 'Refreshing cached app map after target lookup failed');

          const refreshedAppMap = await awaitWithAbort(
            runAppMapDiscovery({
              showOverlay: false,
              reason: 'stale_target_not_found',
              forceRefresh: true
            }),
            signal
          );

          if (refreshedAppMap) {
            availableAppMap = refreshedAppMap;
          }

          const remainingSteps = resolvedPlan.steps.slice(result.completedSteps);
          if (remainingSteps.length) {
            const refreshedExecutionMap = refreshMapForExecution();
            result = await executorRef.current.executeSequence(remainingSteps, refreshedExecutionMap, {
              refreshMap: refreshMapForExecution,
              appMap: availableAppMap,
              navigate: navigateWithFiberDriver,
              resolutionPriority,
              toolRegistry,
              signal,
              onProgress: (_message: string, step: IntentStep) => {
                const stepMessage = formatProgress(step);
                setProgressMessage(stepMessage);
                showToast('executing', stepMessage);
                updateCommandHistoryEntry(historyEntryId, 'executing');
                appendCommandHistoryTrace(historyEntryId, stepMessage);
              },
              defaultDelayMs: inputMethod === 'voice' ? 0 : 150,
              originalIntent: resolutionCommand
            });
            completedStepsHistory.push(...remainingSteps.slice(0, result.completedSteps));
          }
        }

        const failureReasonLower = result.failedStepReason?.toLowerCase() || '';
        const shouldRetryFailedStepWithPlanner =
          !result.executed &&
          Boolean(result.failedStep) &&
          Boolean(resolverRef.current) &&
          (failureReasonLower.includes('target not found') ||
            (result.failedStep?.action === 'tool' && failureReasonLower.includes('current route')));

        if (shouldRetryFailedStepWithPlanner && result.failedStep && resolverRef.current) {
          setProgressMessage('Retrying failed step with updated context...');
          showToast('planning', 'Retrying failed step with updated context...');
          appendCommandHistoryTrace(historyEntryId, 'Retrying failed step with updated context');
          const retryMap = refreshMapForExecution();

          const retrySteps = await resolverRef.current.resolveForFailedStep(
            buildResolutionInput(retryMap, resolutionCommand),
            result.failedStep,
            result.failedStepReason || result.reason || 'Execution failed',
            signal
          );

          const sanitizedRetrySteps = sanitizePlanStepsForUnrequestedPostSubmitNavigation(retrySteps, baseCommand);

          if (sanitizedRetrySteps.length) {
            latestIntentSource = 'claude';
            result = await executorRef.current.executeSequence(sanitizedRetrySteps, retryMap, {
              refreshMap: refreshMapForExecution,
              appMap: availableAppMap,
              navigate: navigateWithFiberDriver,
              resolutionPriority,
              toolRegistry,
              signal,
              onProgress: (_message, step) => {
                const stepMessage = formatProgress(step);
                setProgressMessage(stepMessage);
                showToast('executing', stepMessage);
                updateCommandHistoryEntry(historyEntryId, 'executing');
                appendCommandHistoryTrace(historyEntryId, stepMessage);
              },
              defaultDelayMs: inputMethod === 'voice' ? 0 : 150,
              originalIntent: resolutionCommand
            });
            completedStepsHistory.push(...sanitizedRetrySteps.slice(0, result.completedSteps));
          }
        }

        if (
          !result.executed &&
          allowDynamicReplan &&
          Boolean(result.newElementsAfterWait?.length) &&
          resolverRef.current
        ) {
          setProgressMessage('Planning dynamic follow-up steps...');
          showToast('planning', 'Planning dynamic follow-up steps...');
          appendCommandHistoryTrace(historyEntryId, 'Planning dynamic follow-up steps');

          const followUpMap = refreshMapForExecution();

          const followUpSteps = await resolverRef.current.resolveForNewElements(
            buildResolutionInput(followUpMap, resolutionCommand, completedStepsHistory),
            result.newElementsAfterWait || [],
            completedStepsHistory,
            signal
          );

          const sanitizedFollowUpSteps = sanitizePlanStepsForUnrequestedPostSubmitNavigation(
            followUpSteps,
            baseCommand
          );

          if (sanitizedFollowUpSteps.length) {
            latestIntentSource = 'claude';
            result = await executorRef.current.executeSequence(sanitizedFollowUpSteps, followUpMap, {
              refreshMap: refreshMapForExecution,
              appMap: availableAppMap,
              navigate: navigateWithFiberDriver,
              resolutionPriority,
              toolRegistry,
              signal,
              onProgress: (_message, step) => {
                const stepMessage = formatProgress(step);
                setProgressMessage(stepMessage);
                showToast('executing', stepMessage);
                updateCommandHistoryEntry(historyEntryId, 'executing');
                appendCommandHistoryTrace(historyEntryId, stepMessage);
              },
              defaultDelayMs: inputMethod === 'voice' ? 0 : 150,
              originalIntent: resolutionCommand
            });
            completedStepsHistory.push(...sanitizedFollowUpSteps.slice(0, result.completedSteps));
          }
        }

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

          setIsResolving(false);
          setResolutionStatus('failed');
          setProgressMessage(`Failed: ${failureMessage}`);
          showPreview(failureMessage);
          showToast('failed', failureMessage);
          appendCommandHistoryTrace(historyEntryId, `Failed: ${failureMessage}`);
          updateCommandHistoryEntry(historyEntryId, statusFromFailureMessage(failureMessage), failureMessage);

          if (inputMethod === 'voice') {
            setChatInput(normalizedCommand);
          }

          return false;
        }

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
    },
    [
      addCommandHistoryEntry,
      appendCommandHistoryTrace,
      awaitBootstrappedAppMap,
      dismissToast,
      pendingClarification,
      runAppMapDiscovery,
      setAndNotifyAppMap,
      showPreview,
      showToast,
      toolRegistry,
      updateCommandHistoryEntry
    ]
  );

  const submitVoiceCommand = useCallback(
    (normalized: string, gazeSnapshot: VoiceGazeSnapshot) => {
      if (normalized === lastVoiceSubmissionRef.current) {
        return;
      }

      clearSilenceTimer();
      resetVoiceGazeSnapshot();
      lastVoiceSubmissionRef.current = normalized;
      clearVoiceTranscript();
      speechControllerRef.current?.restart();
      const pendingExecution = executeCommand(normalized, 'voice', gazeSnapshot);
      void pendingExecution.then((accepted) => {
        if (!accepted && lastVoiceSubmissionRef.current === normalized) {
          lastVoiceSubmissionRef.current = '';
        }
      });
    },
    [clearSilenceTimer, clearVoiceTranscript, executeCommand, resetVoiceGazeSnapshot]
  );

  useEffect(() => {
    const scanner = new DOMScanner((map) => {
      setDomMap(map);
    });

    domScannerRef.current = scanner;
    scanner.start();

    return () => {
      scanner.stop();
      domScannerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!modalities.includes('voice')) {
      speechControllerRef.current?.destroy();
      speechControllerRef.current = null;
      resetVoiceUtteranceState();
      clearVoiceTranscript();
      lastVoiceSubmissionRef.current = '';
      if (audioCaptureTimerRef.current) {
        window.clearTimeout(audioCaptureTimerRef.current);
        audioCaptureTimerRef.current = null;
      }
      setIsMicrophoneEnabled(false);
      setIsAudioCapturing(false);
      setVoice((previous) => ({
        ...previous,
        transcript: '',
        isListening: false,
        confidence: 0
      }));
      return;
    }

    const speech = createSpeechController({
      continuous: true,
      lang: 'en-US',
      onTranscript: ({ transcript, confidence, isFinal }) => {
        setVoice((previous) => ({
          ...previous,
          transcript,
          confidence
        }));

        const hasAudio = Boolean(transcript.trim());
        if (hasAudio && microphoneEnabledRef.current) {
          setIsAudioCapturing(true);
          if (audioCaptureTimerRef.current) {
            window.clearTimeout(audioCaptureTimerRef.current);
          }
          audioCaptureTimerRef.current = window.setTimeout(() => {
            setIsAudioCapturing(false);
          }, 450);
        }

        const normalized = normalizeCommand(transcript);
        if (!normalized) {
          return;
        }

        const gazeSnapshot = voiceGazeSnapshotRef.current || captureVoiceGazeSnapshot();
        if (isFinal) {
          submitVoiceCommand(normalized, gazeSnapshot);
          return;
        }

        clearSilenceTimer();
        silenceTimerRef.current = window.setTimeout(() => {
          submitVoiceCommand(normalized, gazeSnapshot);
        }, SILENCE_TIMEOUT_MS);
      },
      onListening: (isListening) => {
        if (isListening) {
          lastVoiceSubmissionRef.current = '';
        }
        setVoice((previous) => ({
          ...previous,
          isListening
        }));
        if (!isListening) {
          resetVoiceUtteranceState();
          clearVoiceTranscript();
          if (audioCaptureTimerRef.current) {
            window.clearTimeout(audioCaptureTimerRef.current);
            audioCaptureTimerRef.current = null;
          }
          setIsAudioCapturing(false);
        }
      },
      onError: () => {
        lastVoiceSubmissionRef.current = '';
        setVoice((previous) => ({
          ...previous,
          transcript: '',
          isListening: false,
          confidence: 0
        }));
        resetVoiceUtteranceState();
        if (audioCaptureTimerRef.current) {
          window.clearTimeout(audioCaptureTimerRef.current);
          audioCaptureTimerRef.current = null;
        }
        setIsAudioCapturing(false);
      }
    });

    speechControllerRef.current = speech;
    if (microphoneEnabledRef.current && speech.isSupported) {
      speech.start();
    }

    return () => {
      resetVoiceUtteranceState();
      clearVoiceTranscript();
      lastVoiceSubmissionRef.current = '';
      if (audioCaptureTimerRef.current) {
        window.clearTimeout(audioCaptureTimerRef.current);
        audioCaptureTimerRef.current = null;
      }
      speech.destroy();
      speechControllerRef.current = null;
    };
  }, [
    captureVoiceGazeSnapshot,
    clearSilenceTimer,
    clearVoiceTranscript,
    modalities,
    resetVoiceUtteranceState,
    submitVoiceCommand
  ]);

  useEffect(() => {
    if (!modalities.includes('voice')) {
      return;
    }

    const speech = speechControllerRef.current;
    if (!speech?.isSupported) {
      return;
    }

    if (isMicrophoneEnabled) {
      speech.start();
      return;
    }

    resetVoiceUtteranceState();
    if (audioCaptureTimerRef.current) {
      window.clearTimeout(audioCaptureTimerRef.current);
      audioCaptureTimerRef.current = null;
    }
    speech.stop();
    setIsAudioCapturing(false);
    clearVoiceTranscript();
    lastVoiceSubmissionRef.current = '';
    setVoice((previous) => ({
      ...previous,
      transcript: '',
      isListening: false,
      confidence: 0
    }));
  }, [clearVoiceTranscript, isMicrophoneEnabled, modalities, resetVoiceUtteranceState]);

  useEffect(() => {
    const needsVision = modalities.includes('gaze') || modalities.includes('gesture');
    if (!needsVision) {
      faceCursor.stopTracking();
      setGaze((previous) => (previous.isCalibrated ? { ...previous, isCalibrated: false } : previous));
      setGesture((previous) =>
        previous.gesture !== 'none' || previous.hand !== 'unknown' || previous.confidence !== 0
          ? { gesture: 'none', hand: 'unknown', confidence: 0 }
          : previous
      );
      return;
    }

    void faceCursor.startTracking();

    return () => {
      faceCursor.stopTracking();
    };
  }, [modalities]);

  useEffect(() => {
    return () => {
      activeCommandAbortRef.current?.abort(createAbortError());
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
      }
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (audioCaptureTimerRef.current) {
        window.clearTimeout(audioCaptureTimerRef.current);
      }
    };
  }, []);

  const entryPointStatus = useMemo<StatusIndicatorState>(() => {
    if (isResolving) {
      return 'executing';
    }

    if (modalities.includes('voice') && isMicrophoneEnabled && voice.isListening && isAudioCapturing) {
      return 'listening';
    }

    return 'idle';
  }, [isAudioCapturing, isMicrophoneEnabled, isResolving, modalities, voice.isListening]);

  const showVoiceTranscriptBubble =
    modalities.includes('voice') &&
    (modalities.includes('gaze') || modalities.includes('gesture')) &&
    isMicrophoneEnabled &&
    voice.isListening &&
    isAudioCapturing &&
    faceCursor.showCursor &&
    Boolean(voice.transcript.trim());

  const modalStatus = useMemo(
    () => ({
      voice: modalities.includes('voice') && isMicrophoneEnabled,
      gaze: modalities.includes('gaze') && faceCursor.isTracking,
      gesture: modalities.includes('gesture') && faceCursor.isTracking
    }),
    [faceCursor.isTracking, isMicrophoneEnabled, modalities]
  );

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
      voice,
      gaze,
      gesture,
      lastIntent,
      isResolving,
      resolutionStatus,
      resolvedIntentPreview,
      progressMessage,
      executeCommand,
      domMap,
      refreshMap
    ]
  );

  return (
    <SpatialContext.Provider value={contextValue}>
      {children}
      <SdkShadowHost>
        <LearningOverlay open={isDiscovering} themeMode={theme.mode} />
        <GazeOverlay
          videoRef={faceCursor.videoRef}
          cursorRef={faceCursor.cursorRef}
          dragCursorRef={faceCursor.dragCursorRef}
          visible={
            !isDiscovering &&
            (modalities.includes('gaze') || modalities.includes('gesture')) &&
            faceCursor.showCursor
          }
          isPinching={faceCursor.isPinching}
          showDragCursor={faceCursor.isDragging}
          gazeTarget={gaze.gazeTarget}
          isDragging={faceCursor.isDragging}
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
        <FloatingClarification
          open={Boolean(voiceClarificationQuestion)}
          question={voiceClarificationQuestion}
          themeMode={themeMode}
        />
        <ChatPanel
          open={isPanelOpen}
          input={chatInput}
          history={commandHistory}
          canToggleMicrophone={modalities.includes('voice')}
          microphoneEnabled={isMicrophoneEnabled}
          isResolving={isResolving}
          onInputChange={setChatInput}
          onMicrophoneToggle={() => setIsMicrophoneEnabled((previous) => !previous)}
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
          modalitiesStatus={modalStatus}
          themeMode={themeMode}
        />
        <EntryPointButton
          open={isPanelOpen}
          status={entryPointStatus}
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
