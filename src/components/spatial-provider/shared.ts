import { isSubmitLikeCompletionStep } from '../../core/ActionExecutor';
import * as DOMScannerModule from '../../core/DOMScanner';
import { APP_MAP_VERSION, type DOMScannerPolicy } from '../../core/DOMScanner';
import { isSdkUiElement } from '../../core/sdkUi';
import type {
  AppMap,
  CommandInputMethod,
  DOMCapabilityMap,
  DOMElementDescriptor,
  GazeState,
  GestureState,
  IntentAction,
  IntentPlan,
  IntentStep,
  Modality,
  ToolCapabilityEntry,
  ToolCapabilityMap
} from '../../types';
import type {
  CommandHistoryItem,
  CommandInputMethod as CommandHistoryInputMethod
} from '../ChatPanel';

export const DEFAULT_MODALITIES: Array<'voice' | 'gaze' | 'gesture'> = ['voice', 'gaze', 'gesture'];
export const SILENCE_TIMEOUT_MS = 1200;
export const APP_MAP_BOOTSTRAP_GRACE_MS = 0;
export const HISTORY_STORAGE_KEY = 'exocor.command-history.v1';
export const ACTIVE_MODALITIES_STORAGE_KEY = 'exocor.active-modalities.v1';
export const LEGACY_HISTORY_STORAGE_KEY = 'haelo.command-history.v1';
export const HISTORY_SESSION_STORAGE_KEY = LEGACY_HISTORY_STORAGE_KEY;

export type VoiceGazeSnapshot = GazeState;
export type ActiveModalities = Record<Modality, boolean>;

export interface PendingClarificationState {
  question: string;
  baseCommand: string;
  historyEntryId: string;
}

export const emptyMap: DOMCapabilityMap = {
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

export const EMPTY_GAZE_STATE: GazeState = {
  gazeTarget: null,
  gazeX: 0,
  gazeY: 0,
  isCalibrated: false
};

export const EMPTY_GESTURE_STATE: GestureState = {
  gesture: 'none',
  hand: 'unknown',
  confidence: 0
};

export function normalizeActiveModalities(
  availableModalities: readonly Modality[],
  activeModalities: ActiveModalities
): ActiveModalities {
  const available = new Set<Modality>(availableModalities);
  const next: ActiveModalities = {
    voice: available.has('voice') ? activeModalities.voice : false,
    gaze: available.has('gaze') ? activeModalities.gaze : false,
    gesture: available.has('gesture') ? activeModalities.gesture : false
  };

  if (available.has('gaze') && next.gesture) {
    next.gaze = true;
  }

  return next;
}

export function defaultActiveModalities(availableModalities: readonly Modality[]): ActiveModalities {
  const available = new Set<Modality>(availableModalities);
  return normalizeActiveModalities(availableModalities, {
    voice: false,
    gaze: available.has('gaze'),
    gesture: available.has('gesture')
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function sanitizePersistedActiveModalities(raw: unknown): Partial<ActiveModalities> | null {
  if (!isRecord(raw)) {
    return null;
  }

  const next: Partial<ActiveModalities> = {};
  for (const modality of DEFAULT_MODALITIES) {
    const value = raw[modality];
    if (typeof value === 'boolean') {
      next[modality] = value;
    }
  }

  return next;
}

export function readPersistedActiveModalities(storageKey: string): Partial<ActiveModalities> | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  try {
    return sanitizePersistedActiveModalities(JSON.parse(raw) as unknown);
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

export function createActiveModalities(
  availableModalities: readonly Modality[],
  ...sources: Array<Partial<ActiveModalities> | null | undefined>
): ActiveModalities {
  const defaults = defaultActiveModalities(availableModalities);
  const available = new Set<Modality>(availableModalities);
  const next = { ...defaults };

  for (const modality of DEFAULT_MODALITIES) {
    if (!available.has(modality)) {
      next[modality] = false;
      continue;
    }

    for (const source of sources) {
      if (typeof source?.[modality] === 'boolean') {
        next[modality] = source[modality] as boolean;
        break;
      }
    }
  }

  return normalizeActiveModalities(availableModalities, next);
}

export function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function createAbortError(): DOMException {
  return new DOMException('Stopped by user.', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === 'AbortError') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

export function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
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

export function buildFallbackAppMapFromDom(map: DOMCapabilityMap): AppMap {
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

export function commandExplicitlyRequestsNavigation(command: string): boolean {
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

export function sanitizePlanStepsForUnrequestedPostSubmitNavigation(
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

export function createStreamingStepSanitizer(command: string): (step: IntentStep) => IntentStep | null {
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

export interface AsyncStepQueue {
  iterable: AsyncIterable<IntentStep>;
  push: (step: IntentStep) => void;
  close: () => void;
}

export function createAsyncStepQueue(): AsyncStepQueue {
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

export function resolveSelectorForElement(element: Element | null): string | null {
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

export function stepToIntent(
  step: IntentStep,
  source: IntentAction['source'],
  rawCommand: string
): IntentAction | null {
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

export function formatProgress(step: IntentStep): string {
  if (step.action === 'tool') {
    const toolId = step.toolId || step.target || 'unknown-tool';
    return `Used app-native tool: ${toolId}`;
  }
  const reason = step.reason || step.action;
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}...`;
}

export function buildDirectToolPlan(command: string, toolId: string): IntentPlan {
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

export function buildAuthoritativePreferredToolPlan(
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

export function getPreferredToolEntries(toolCapabilityMap: ToolCapabilityMap | null): ToolCapabilityEntry[] {
  if (!toolCapabilityMap?.preferredToolIds?.length) {
    return [];
  }

  return toolCapabilityMap.tools.filter((tool) => toolCapabilityMap.preferredToolIds.includes(tool.id));
}

export function getStrongPreferredTool(toolCapabilityMap: ToolCapabilityMap | null): ToolCapabilityEntry | null {
  const preferredTools = getPreferredToolEntries(toolCapabilityMap);
  return preferredTools.length === 1 ? preferredTools[0] : null;
}

export function planUsesTool(plan: IntentPlan, toolId: string): boolean {
  return plan.steps.some((step) => step.action === 'tool' && (step.toolId || step.target) === toolId);
}

export function isNavigateThenToolPlan(plan: IntentPlan, toolId: string): boolean {
  const steps = plan.steps.filter((step) => step.action !== 'wait');
  const toolIndex = steps.findIndex((step) => step.action === 'tool' && (step.toolId || step.target) === toolId);
  if (toolIndex <= 0) {
    return false;
  }

  return steps.slice(0, toolIndex).some((step) => step.action === 'navigate' && step.target?.startsWith('/'));
}

export function toHistoryInputMethod(inputMethod: CommandInputMethod): CommandHistoryInputMethod {
  if (inputMethod === 'voice') {
    return 'voice';
  }
  if (inputMethod === 'text') {
    return 'typed';
  }
  return 'gaze';
}

export function statusFromFailureMessage(_message: string): CommandHistoryItem['status'] {
  return 'failed';
}

const HISTORY_STATUSES = new Set<CommandHistoryItem['status']>([
  'planning',
  'executing',
  'done',
  'failed',
  'clarification'
]);

const HISTORY_INPUT_METHODS = new Set<CommandHistoryInputMethod>(['voice', 'typed', 'gaze']);

export function sanitizePersistedHistory(raw: unknown): CommandHistoryItem[] {
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

export function normalizeHistoryStoragePath(pathname: string): string {
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

export function normalizeHistoryStorageTitle(value: string): string {
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

export function buildStableHistoryStorageKey(routePath: string, title: string, baseKey = HISTORY_STORAGE_KEY): string {
  const origin = typeof window === 'undefined' ? 'server' : window.location.origin || 'unknown-origin';
  const normalizedRoute = normalizeHistoryStoragePath(routePath);
  const normalizedTitle = normalizeHistoryStorageTitle(title);
  const signature = `${origin}||route:${normalizedRoute}||title:${normalizedTitle}`;
  return `${baseKey}::scope-${hashHistoryStorageSignature(signature)}`;
}

export function getAllHistoryStorageKeys(stableRoutePath: string, stableTitle: string): string[] {
  return [buildStableHistoryStorageKey(stableRoutePath, stableTitle)];
}

export function getLegacyHistoryStorageKeys(stableRoutePath: string, stableTitle: string): string[] {
  return [buildStableHistoryStorageKey(stableRoutePath, stableTitle, LEGACY_HISTORY_STORAGE_KEY)];
}

export function isTextEntryElement(element: HTMLElement | null): boolean {
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

export function findElementByNode(node: HTMLElement, elements: DOMElementDescriptor[]): DOMElementDescriptor | null {
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

export function resolveFocusedElement(
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

export function resolveGazeTarget(
  map: DOMCapabilityMap,
  gazeState: GazeState,
  scannerPolicy?: DOMScannerPolicy
): { elementId: string | null; componentName: string | null; text: string } | null {
  if (gazeState.gazeTarget) {
    const matchedElement =
      map.elements.find((element) => element.id === gazeState.gazeTarget) ||
      map.elements.find((element) => element.selector === gazeState.gazeTarget) ||
      DOMScannerModule.scanDOM(scannerPolicy).elements.find(
        (element) => element.id === gazeState.gazeTarget || element.selector === gazeState.gazeTarget
      );
    return {
      elementId: matchedElement?.id || gazeState.gazeTarget,
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

export function buildEnrichedContext(
  inputMethod: CommandInputMethod,
  map: DOMCapabilityMap,
  gazeState: GazeState,
  preferredFocusedElement: HTMLElement | null = null,
  preferredTextEntryElement: HTMLElement | null = null,
  scannerPolicy?: DOMScannerPolicy
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
    gazeTarget: resolveGazeTarget(map, gazeState, scannerPolicy),
    gazePosition: {
      x: gazeState.gazeX,
      y: gazeState.gazeY
    }
  };
}
