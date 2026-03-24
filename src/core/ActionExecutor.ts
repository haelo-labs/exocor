import type {
  AppMap,
  AppMapLocatorKind,
  AppMapLocatorRef,
  DOMCapabilityMap,
  DOMElementDescriptor,
  ExecutionResult,
  IntentAction,
  IntentStep,
  ResolutionPriority,
  SequenceExecutionResult
} from '../types';
import { isSdkUiElement, SDK_UI_SELECTOR } from './sdkUi';
import type { ToolRegistry } from './ToolRegistry';
import { normalizeToolRoutePath, toolMatchesCurrentRoute } from './ToolRegistry';

interface ExecuteOptions {
  refreshMap?: () => DOMCapabilityMap;
  appMap?: AppMap | null;
  navigate?: (path: string) => boolean | Promise<boolean>;
  resolutionPriority?: ResolutionPriority;
  toolRegistry?: ToolRegistry;
  signal?: AbortSignal;
}

interface ExecuteSequenceOptions extends ExecuteOptions {
  onProgress?: (message: string, step: IntentStep, stepIndex: number) => void;
  defaultDelayMs?: number;
  originalIntent?: string;
}

type UiSettleMode = 'quiet-only' | 'mutation-required';

interface StepResult extends ExecutionResult {
  targetNotFound?: boolean;
  valueChanged?: boolean;
  submitLikeCompletionExecuted?: boolean;
  trustedCompletionExecuted?: boolean;
  settleMode?: UiSettleMode;
}

interface ResolutionContext {
  liveSelectorMap: Record<string, string>;
  aliasSelectorMap: Record<string, string>;
  aliasLocatorKindMap: Record<string, AppMapLocatorKind>;
  appMapSelectorIndex: AppMapRouteSelectorIndex[];
}

interface AppMapRouteSelectorIndex {
  routePattern: string;
  exactLabelLocators: Map<string, AppMapLocatorRef[]>;
  labelKeyLocators: Map<string, AppMapLocatorRef[]>;
  navigationLocatorsByPath: Map<string, AppMapLocatorRef[]>;
}

interface DOMSnapshot {
  path: string;
  elementCount: number;
  openDialogs: number;
  formsVisible: number;
  listItems: string[];
  notificationTexts: string[];
  fieldValues: Record<string, string>;
}

type IntentKind = 'create' | 'navigate' | 'fill' | 'generic';

const DEFAULT_STEP_DELAY_MS = 300;
const WAIT_FOR_UI_SETTLED_TIMEOUT_MS = 2000;
const WAIT_FOR_UI_SETTLED_POLL_MS = 50;
const UI_SETTLED_QUIET_WINDOW_MS = 180;
const UI_SETTLED_RENDER_FRAMES = 2;
const WAIT_FOR_ROUTE_TIMEOUT_MS = 2200;
const WAIT_FOR_ROUTE_POLL_MS = 80;
const DROPDOWN_INTERACTION_DELAY_MS = 150;
const DROPDOWN_EVENT_SEQUENCE = [
  'pointerover',
  'mouseover',
  'pointerenter',
  'mouseenter',
  'pointerdown',
  'mousedown',
  'focus',
  'pointerup',
  'mouseup',
  'click'
] as const;
const TOKEN_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'up',
  'with'
]);
const SUBMIT_LIKE_KEYWORDS = [
  'create',
  'save',
  'confirm',
  'add',
  'done',
  'submit',
  'apply',
  'finish',
  'complete',
  'send'
] as const;

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

interface SubmitLikeCompletionContext {
  step: IntentStep;
  locatorKind?: AppMapLocatorKind;
  resolvedTargetLabel?: string | null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timeoutId = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      window.clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onAbort);
      reject(createAbortError());
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    window.setTimeout(resolve, 16);
  });
}

async function waitForRenderFrames(frameCount: number): Promise<void> {
  for (let frame = 0; frame < frameCount; frame += 1) {
    await nextAnimationFrame();
  }
}

function isVisible(element: Element): boolean {
  if ((element as HTMLElement).hidden || element.getAttribute('aria-hidden') === 'true') {
    return false;
  }

  const style = window.getComputedStyle(element as HTMLElement);
  const opacity = style.opacity?.trim();
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.visibility === 'collapse' ||
    (opacity !== '' && Number.isFinite(Number(opacity)) && Number(opacity) === 0)
  ) {
    return false;
  }

  const userAgent = (window.navigator?.userAgent || '').toLowerCase();
  const isJsDom = userAgent.includes('jsdom');
  if (isJsDom) {
    return true;
  }

  const rect = (element as HTMLElement).getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  return rect.right >= 0 && rect.left <= window.innerWidth && rect.bottom >= 0 && rect.top <= window.innerHeight;
}

function normalizePath(path: string): string {
  const cleaned = path.split('?')[0].replace(/\/+$/, '');
  return cleaned || '/';
}

function fieldSignature(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement): string {
  if (element.id) {
    return `#${element.id}`;
  }

  if (element.name) {
    return `${element.tagName.toLowerCase()}[name="${element.name}"]`;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.placeholder) {
      return `${element.tagName.toLowerCase()}[placeholder="${element.placeholder}"]`;
    }
  }

  const rect = element.getBoundingClientRect();
  return `${element.tagName.toLowerCase()}@${Math.round(rect.x)}:${Math.round(rect.y)}`;
}

function readFormValue(target: HTMLElement): string {
  const fillable =
    target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
      ? target
      : (target.querySelector('input, textarea, select, [contenteditable], [role="textbox"]') as HTMLElement | null);

  if (!fillable) {
    return '';
  }

  if (fillable instanceof HTMLSelectElement) {
    return fillable.value || fillable.selectedOptions[0]?.textContent || '';
  }

  if (fillable instanceof HTMLInputElement || fillable instanceof HTMLTextAreaElement) {
    return fillable.value || '';
  }

  return ((fillable as HTMLElement).innerText || fillable.textContent || '').trim();
}

function captureDOMSnapshot(): DOMSnapshot {
  const fields = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  ).filter((field) => !field.closest(SDK_UI_SELECTOR) && isVisible(field));

  const fieldValues: Record<string, string> = {};
  for (const field of fields) {
    fieldValues[fieldSignature(field)] = readFormValue(field);
  }

  const listItems = Array.from(document.querySelectorAll<HTMLElement>('ul li, ol li, table tbody tr, table tr'))
    .filter((item) => !item.closest(SDK_UI_SELECTOR) && isVisible(item))
    .map((item) => (item.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const notificationTexts = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="status"], [role="alert"], [aria-live], .toast, .notification, [data-toast], [data-notification]'
    )
  )
    .filter((node) => !node.closest(SDK_UI_SELECTOR) && isVisible(node))
    .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const formsVisible = Array.from(document.querySelectorAll<HTMLElement>('form, [role="form"]')).filter(
    (form) => !form.closest(SDK_UI_SELECTOR) && isVisible(form)
  ).length;

  return {
    path: window.location.pathname,
    elementCount: document.querySelectorAll('*').length,
    openDialogs: document.querySelectorAll('dialog[open], [role="dialog"]:not([aria-hidden="true"])').length,
    formsVisible,
    listItems,
    notificationTexts,
    fieldValues
  };
}

function splitSelectorList(selectorList: string): string[] {
  const candidates: string[] = [];
  let token = '';
  let bracketDepth = 0;
  let parenDepth = 0;

  for (const character of selectorList) {
    if (character === '[') {
      bracketDepth += 1;
    } else if (character === ']') {
      bracketDepth = Math.max(0, bracketDepth - 1);
    } else if (character === '(') {
      parenDepth += 1;
    } else if (character === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    }

    if (character === ',' && bracketDepth === 0 && parenDepth === 0) {
      const trimmed = token.trim();
      if (trimmed) {
        candidates.push(trimmed);
      }
      token = '';
      continue;
    }

    token += character;
  }

  const trailing = token.trim();
  if (trailing) {
    candidates.push(trailing);
  }

  return candidates;
}

function queryCandidate(candidate: string): HTMLElement | null {
  const containsMatch = candidate.match(/^(.*?):contains\((.*)\)$/i);

  if (containsMatch) {
    const base = containsMatch[1].trim() || '*';
    const rawNeedle = containsMatch[2].trim().replace(/^['"]|['"]$/g, '');
    const needle = rawNeedle.toLowerCase();

    const elements = Array.from(document.querySelectorAll<HTMLElement>(base));
    for (const element of elements) {
      if (isSdkUiElement(element) || !isVisible(element)) {
        continue;
      }

      const text = (element.textContent || element.getAttribute('aria-label') || '').toLowerCase();
      if (text.includes(needle)) {
        return element;
      }
    }

    return null;
  }

  try {
    const element = document.querySelector(candidate) as HTMLElement | null;
    if (!element || isSdkUiElement(element) || !isVisible(element)) {
      return null;
    }
    return element;
  } catch {
    return null;
  }
}

function queryCandidateMatches(candidate: string): HTMLElement[] {
  const containsMatch = candidate.match(/^(.*?):contains\((.*)\)$/i);
  if (containsMatch) {
    const base = containsMatch[1].trim() || '*';
    const rawNeedle = containsMatch[2].trim().replace(/^['"]|['"]$/g, '');
    const needle = rawNeedle.toLowerCase();
    return Array.from(document.querySelectorAll<HTMLElement>(base)).filter((element) => {
      if (isSdkUiElement(element) || !isVisible(element)) {
        return false;
      }
      const text = (element.textContent || element.getAttribute('aria-label') || '').toLowerCase();
      return text.includes(needle);
    });
  }

  try {
    return Array.from(document.querySelectorAll<HTMLElement>(candidate)).filter(
      (element) => !isSdkUiElement(element) && isVisible(element)
    );
  } catch {
    return [];
  }
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 1 && !TOKEN_STOP_WORDS.has(token));
}

function normalizeLabel(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function toLabelKey(value: string): string {
  return normalizeLabel(value).replace(/[^a-z0-9]/g, '');
}

function normalizeSubmitText(value: string | null | undefined): string {
  return (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasSubmitLikeKeyword(value: string | null | undefined): boolean {
  const normalized = normalizeSubmitText(value);
  if (!normalized) {
    return false;
  }

  return SUBMIT_LIKE_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function isSubmitLikeCompletionStep({
  step,
  locatorKind,
  resolvedTargetLabel
}: SubmitLikeCompletionContext): boolean {
  if (step.action === 'submit') {
    return true;
  }

  if (step.action !== 'click') {
    return false;
  }

  if (locatorKind === 'submit') {
    return true;
  }

  return hasSubmitLikeKeyword(step.reason) || hasSubmitLikeKeyword(resolvedTargetLabel || step.target || '');
}

function addUniqueLocator(locators: AppMapLocatorRef[] | undefined, locator: AppMapLocatorRef): AppMapLocatorRef[] {
  const next = locators ? [...locators] : [];
  if (!next.some((entry) => entry.id === locator.id)) {
    next.push(locator);
  }
  return next;
}

function routePatternMatches(routePattern: string, currentPath: string): boolean {
  const pattern = normalizePath(routePattern || '/');
  const current = normalizePath(currentPath || '/');
  if (pattern === current) {
    return true;
  }

  const patternSegments = pattern.split('/').filter(Boolean);
  const currentSegments = current.split('/').filter(Boolean);
  let patternIndex = 0;
  let currentIndex = 0;

  while (patternIndex < patternSegments.length && currentIndex < currentSegments.length) {
    const segment = patternSegments[patternIndex];
    if (segment === '*') {
      return true;
    }

    if (segment.startsWith(':')) {
      const optional = segment.endsWith('?');
      if (!optional || currentSegments[currentIndex]) {
        currentIndex += 1;
      }
      patternIndex += 1;
      continue;
    }

    if (segment !== currentSegments[currentIndex]) {
      return false;
    }

    patternIndex += 1;
    currentIndex += 1;
  }

  while (patternIndex < patternSegments.length && patternSegments[patternIndex]?.startsWith(':')) {
    patternIndex += 1;
  }

  return patternIndex === patternSegments.length && currentIndex === currentSegments.length;
}

function toLocatorSelectorCandidates(entry: { elementId?: string; selectorCandidates?: string[] }): string[] {
  const candidates = (entry.selectorCandidates || []).map((candidate) => candidate.trim()).filter(Boolean);
  const elementId = (entry.elementId || '').trim();
  if (elementId && !candidates.includes(elementId)) {
    candidates.push(elementId);
  }
  return candidates;
}

function legacyRouteLocators(routePath: string, route: NonNullable<AppMap['routes']>[number]): AppMapLocatorRef[] {
  const locators: AppMapLocatorRef[] = [];

  const pushLocator = (
    kind: AppMapLocatorKind,
    label: string | null | undefined,
    entry: { elementId?: string; selectorCandidates?: string[]; path?: string; fillable?: boolean; clickable?: boolean }
  ): void => {
    const normalizedLabel = normalizeLabel(label || '');
    const labelKey = toLabelKey(label || '');
    const selectorCandidates = toLocatorSelectorCandidates(entry);
    if (!normalizedLabel || !labelKey || !selectorCandidates.length) {
      return;
    }
    const locatorId = `${routePath}::${kind}::${labelKey}::${selectorCandidates[0]}`;
    locators.push({
      id: locatorId,
      kind,
      label: normalizedLabel,
      labelKey,
      selectorCandidates,
      ...(entry.path ? { path: normalizePath(entry.path) } : {}),
      ...(typeof entry.fillable === 'boolean' ? { fillable: entry.fillable } : {}),
      ...(typeof entry.clickable === 'boolean' ? { clickable: entry.clickable } : {})
    });
  };

  for (const nav of route.navigationLinks || []) {
    pushLocator('navigation', nav?.label, {
      elementId: nav?.elementId,
      selectorCandidates: nav?.selectorCandidates,
      path: nav?.path,
      clickable: true
    });
  }
  for (const button of route.buttons || []) {
    const label = button?.label || '';
    const kind: AppMapLocatorKind = /\b(create|save|submit|add|confirm)\b/i.test(label) ? 'submit' : 'button';
    pushLocator(kind, label, {
      elementId: button?.elementId,
      selectorCandidates: button?.selectorCandidates,
      clickable: true
    });
  }
  for (const tab of route.tabs || []) {
    pushLocator('tab', tab?.label, { elementId: tab?.elementId, selectorCandidates: tab?.selectorCandidates, clickable: true });
  }
  for (const filter of route.filters || []) {
    pushLocator('filter', filter?.label, {
      elementId: filter?.elementId,
      selectorCandidates: filter?.selectorCandidates,
      clickable: true
    });
  }
  for (const trigger of route.modalTriggers || []) {
    pushLocator('modalTrigger', trigger?.label, {
      elementId: trigger?.elementId,
      selectorCandidates: trigger?.selectorCandidates,
      clickable: true
    });
  }
  for (const field of route.formFields || []) {
    pushLocator('formField', field?.label, {
      elementId: field?.elementId,
      selectorCandidates: field?.selectorCandidates,
      fillable: true
    });
  }

  return locators;
}

function upsertAppMapRouteLocator(routeIndex: AppMapRouteSelectorIndex, locator: AppMapLocatorRef): void {
  const normalizedLabel = normalizeLabel(locator.label || '');
  const labelKey = toLabelKey(locator.label || locator.labelKey || '');
  if (!normalizedLabel || !labelKey || !locator.selectorCandidates?.length) {
    return;
  }

  const normalizedLocator: AppMapLocatorRef = {
    ...locator,
    label: normalizedLabel,
    labelKey,
    selectorCandidates: locator.selectorCandidates.map((candidate) => candidate.trim()).filter(Boolean)
  };
  if (!normalizedLocator.selectorCandidates.length) {
    return;
  }

  routeIndex.exactLabelLocators.set(
    normalizedLabel,
    addUniqueLocator(routeIndex.exactLabelLocators.get(normalizedLabel), normalizedLocator)
  );
  routeIndex.labelKeyLocators.set(labelKey, addUniqueLocator(routeIndex.labelKeyLocators.get(labelKey), normalizedLocator));

  if (normalizedLocator.kind === 'navigation' && normalizedLocator.path) {
    const path = normalizePath(normalizedLocator.path);
    routeIndex.navigationLocatorsByPath.set(
      path,
      addUniqueLocator(routeIndex.navigationLocatorsByPath.get(path), normalizedLocator)
    );
  }
}

function buildAppMapSelectorIndex(appMap: AppMap | null | undefined): AppMapRouteSelectorIndex[] {
  if (!appMap?.routes?.length) {
    return [];
  }

  const indexes: AppMapRouteSelectorIndex[] = [];
  for (const route of appMap.routes) {
    const routePattern = normalizePath(route.path || '/');
    const routeIndex: AppMapRouteSelectorIndex = {
      routePattern,
      exactLabelLocators: new Map<string, AppMapLocatorRef[]>(),
      labelKeyLocators: new Map<string, AppMapLocatorRef[]>(),
      navigationLocatorsByPath: new Map<string, AppMapLocatorRef[]>()
    };

    const mergedRouteLocators = new Map<string, AppMapLocatorRef>();
    for (const locator of [...(Array.isArray(route.locators) ? route.locators : []), ...legacyRouteLocators(routePattern, route)]) {
      const labelKey = locator.labelKey || toLabelKey(locator.label || '');
      const selectorKey = toLocatorSelectorCandidates(locator)[0] || locator.id;
      const key = `${labelKey}::${selectorKey}`;
      if (!mergedRouteLocators.has(key)) {
        mergedRouteLocators.set(key, locator);
      }
    }
    for (const locator of mergedRouteLocators.values()) {
      upsertAppMapRouteLocator(routeIndex, locator);
    }
    indexes.push(routeIndex);
  }

  return indexes;
}

function prioritizeLocators(locators: AppMapLocatorRef[], action: IntentStep['action']): AppMapLocatorRef[] {
  const score = (locator: AppMapLocatorRef): number => {
    let value = 0;
    if (action === 'fill') {
      if (locator.fillable || locator.kind === 'formField') {
        value += 40;
      }
      if (locator.clickable) {
        value -= 10;
      }
    } else if (action === 'click' || action === 'submit') {
      if (locator.clickable || locator.kind === 'button' || locator.kind === 'submit' || locator.kind === 'modalTrigger') {
        value += 40;
      }
      if (locator.fillable) {
        value -= 8;
      }
    }
    if (locator.kind === 'submit' && (action === 'click' || action === 'submit')) {
      value += 6;
    }
    return value;
  };
  return [...locators].sort((a, b) => score(b) - score(a));
}

function routeScopedAppMapLocators(
  step: IntentStep,
  target: string,
  map: DOMCapabilityMap,
  context: ResolutionContext
): AppMapLocatorRef[] {
  const normalizedTarget = normalizeLabel(target);
  const targetKey = toLabelKey(target);
  if (!normalizedTarget || !targetKey) {
    return [];
  }

  const currentRoutePath = normalizePath(map.currentRoute || window.location.pathname);
  const matchedRouteIndexes = context.appMapSelectorIndex.filter((routeIndex) =>
    routePatternMatches(routeIndex.routePattern, currentRoutePath)
  );
  if (!matchedRouteIndexes.length) {
    return [];
  }

  const locators: AppMapLocatorRef[] = [];
  for (const routeIndex of matchedRouteIndexes) {
    for (const locator of routeIndex.exactLabelLocators.get(normalizedTarget) || []) {
      if (!locators.some((entry) => entry.id === locator.id)) {
        locators.push(locator);
      }
    }
    for (const locator of routeIndex.labelKeyLocators.get(targetKey) || []) {
      if (!locators.some((entry) => entry.id === locator.id)) {
        locators.push(locator);
      }
    }
  }

  return prioritizeLocators(locators, step.action);
}

function routeScopedNavigationLocators(path: string, map: DOMCapabilityMap, context: ResolutionContext): AppMapLocatorRef[] {
  const expectedPath = normalizePath(path || '/');
  const currentRoutePath = normalizePath(map.currentRoute || window.location.pathname);
  const matchedRouteIndexes = context.appMapSelectorIndex.filter((routeIndex) =>
    routePatternMatches(routeIndex.routePattern, currentRoutePath)
  );
  const locators: AppMapLocatorRef[] = [];
  for (const routeIndex of matchedRouteIndexes) {
    for (const locator of routeIndex.navigationLocatorsByPath.get(expectedPath) || []) {
      if (!locators.some((entry) => entry.id === locator.id)) {
        locators.push(locator);
      }
    }
  }
  return locators;
}

function isFieldElement(tagName: string): boolean {
  return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function isClickableElement(tagName: string, role: string): boolean {
  return tagName === 'button' || tagName === 'a' || role === 'button' || role === 'link';
}

function isElementDisabled(element: HTMLElement): boolean {
  return (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement
  )
    ? element.disabled
    : element.getAttribute('aria-disabled') === 'true' || element.hasAttribute('disabled');
}

function locatorAllowsAction(locator: AppMapLocatorRef, action: IntentStep['action']): boolean {
  if (action === 'fill') {
    if (locator.fillable === false) {
      return false;
    }
    return locator.fillable === true || locator.kind === 'formField';
  }
  if (action === 'click' || action === 'submit' || action === 'navigate') {
    if (locator.clickable === false) {
      return false;
    }
    return true;
  }
  return true;
}

function elementSatisfiesLocator(element: HTMLElement, locator: AppMapLocatorRef, step: IntentStep): boolean {
  if (!isVisible(element) || isSdkUiElement(element) || isElementDisabled(element)) {
    return false;
  }

  const tag = element.tagName.toLowerCase();
  const role = (element.getAttribute('role') || '').toLowerCase();
  if (locator.tagName && locator.tagName !== tag) {
    return false;
  }
  if (locator.role && locator.role !== role) {
    return false;
  }

  if (!locatorAllowsAction(locator, step.action)) {
    return false;
  }

  if (step.action === 'fill') {
    if (!isFieldElement(tag) && !element.isContentEditable && role !== 'textbox') {
      return false;
    }
  }
  if (step.action === 'click' || step.action === 'submit') {
    if (!isClickableElement(tag, role) && !locator.clickable) {
      return false;
    }
  }

  return true;
}

function scoreLocatorMatch(element: HTMLElement, locator: AppMapLocatorRef): number {
  const text = `${element.textContent || ''} ${element.getAttribute('aria-label') || ''}`.toLowerCase();
  const label = normalizeLabel(locator.label || '');
  if (!label) {
    return 0;
  }
  if (text.trim() === label) {
    return 5;
  }
  if (text.includes(label)) {
    return 2;
  }
  return 0;
}

function resolveLocatorCandidate(locator: AppMapLocatorRef, step: IntentStep): { element: HTMLElement; selector: string } | null {
  for (const selector of locator.selectorCandidates || []) {
    const matches = queryCandidateMatches(selector).filter((element) => elementSatisfiesLocator(element, locator, step));
    if (matches.length === 1) {
      return { element: matches[0], selector };
    }
    if (matches.length > 1) {
      const scored = matches
        .map((element) => ({ element, score: scoreLocatorMatch(element, locator) }))
        .sort((a, b) => b.score - a.score);
      if (scored.length && scored[0].score > 0 && (scored.length === 1 || scored[0].score > scored[1].score)) {
        return { element: scored[0].element, selector };
      }
    }
  }
  return null;
}

function scoreSemanticMatch(step: IntentStep, descriptor: DOMCapabilityMap['elements'][number]): number {
  const reasonTokens = tokenize(step.reason || '');
  const valueTokens = tokenize(step.value || '');
  const semanticText = [
    descriptor.label,
    descriptor.text,
    descriptor.componentName || '',
    (descriptor.handlers || []).join(' '),
    descriptor.ariaLabel || '',
    descriptor.placeholder || '',
    descriptor.type || '',
    descriptor.role || ''
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;

  if (descriptor.disabled) {
    score -= 40;
  }

  if (step.action === 'fill') {
    score += isFieldElement(descriptor.tagName) ? 40 : -25;
  } else if (step.action === 'click' || step.action === 'submit') {
    score += isClickableElement(descriptor.tagName, descriptor.role) ? 35 : -15;
  }

  if (step.action === 'submit' && descriptor.type === 'submit') {
    score += 25;
  }

  for (const token of reasonTokens) {
    if (semanticText.includes(token)) {
      score += 16;
    }
  }

  for (const token of valueTokens) {
    if (semanticText.includes(token)) {
      score += 8;
    }
  }

  if (step.action === 'fill' && isFieldElement(descriptor.tagName) && !(descriptor.value || '').trim()) {
    score += 6;
  }

  return score;
}

function findSemanticTarget(step: IntentStep, map: DOMCapabilityMap): { element: HTMLElement; selector: string } | null {
  let bestScore = Number.NEGATIVE_INFINITY;
  let best: DOMCapabilityMap['elements'][number] | null = null;

  for (const descriptor of map.elements) {
    if (descriptor.selector && isSdkUiElement(document.querySelector(descriptor.selector))) {
      continue;
    }

    const score = scoreSemanticMatch(step, descriptor);
    if (score > bestScore) {
      bestScore = score;
      best = descriptor;
    }
  }

  if (!best) {
    return null;
  }

  const minimumScore = step.action === 'fill' ? 25 : 20;
  if (bestScore < minimumScore) {
    return null;
  }

  const element = queryCandidate(best.selector);
  if (!element) {
    return null;
  }

  return {
    element,
    selector: best.selector
  };
}

function isElementIdTarget(target: string): boolean {
  return /^e\d+$/i.test(target.trim());
}

function scoreLabelTargetMatch(step: IntentStep, target: string, descriptor: DOMCapabilityMap['elements'][number]): number {
  const targetTokens = tokenize(target);
  const semanticText = [
    descriptor.label,
    descriptor.text,
    descriptor.ariaLabel || '',
    descriptor.placeholder || '',
    descriptor.componentName || ''
  ]
    .join(' ')
    .toLowerCase();

  let score = 0;
  const normalizedTarget = target.trim().toLowerCase();
  const normalizedLabel = (descriptor.label || '').trim().toLowerCase();
  const normalizedText = (descriptor.text || '').trim().toLowerCase();

  if (normalizedTarget && (normalizedTarget === normalizedLabel || normalizedTarget === normalizedText)) {
    score += 70;
  }

  for (const token of targetTokens) {
    if (semanticText.includes(token)) {
      score += 18;
    }
  }

  if (step.action === 'fill') {
    score += isFieldElement(descriptor.tagName) ? 32 : -16;
  } else if (step.action === 'click' || step.action === 'submit') {
    score += isClickableElement(descriptor.tagName, descriptor.role) ? 30 : -14;
  }

  if (descriptor.disabled) {
    score -= 35;
  }

  return score;
}

function findLabelTarget(step: IntentStep, target: string, map: DOMCapabilityMap): { element: HTMLElement; selector: string } | null {
  let bestScore = Number.NEGATIVE_INFINITY;
  let best: DOMCapabilityMap['elements'][number] | null = null;

  for (const descriptor of map.elements) {
    if (descriptor.selector && isSdkUiElement(document.querySelector(descriptor.selector))) {
      continue;
    }

    const score = scoreLabelTargetMatch(step, target, descriptor);
    if (score > bestScore) {
      bestScore = score;
      best = descriptor;
    }
  }

  if (!best) {
    return null;
  }

  const minimumScore = step.action === 'fill' ? 24 : 20;
  if (bestScore < minimumScore) {
    return null;
  }

  const element = queryCandidate(best.selector);
  if (!element) {
    return null;
  }

  return {
    element,
    selector: best.selector
  };
}

interface ResolutionPolicy {
  allowLiveLabelFallback: boolean;
  allowSemanticFallback: boolean;
}

interface ResolvedTargetElement {
  element: HTMLElement;
  selector?: string;
  locatorKind?: AppMapLocatorKind;
  resolvedTargetLabel?: string;
}

function resolveTargetElement(
  step: IntentStep,
  map: DOMCapabilityMap,
  context: ResolutionContext,
  policy: ResolutionPolicy
): ResolvedTargetElement | null {
  const target = step.target;
  if (!target) {
    return null;
  }

  // eslint-disable-next-line no-console
  console.log('[Exocor][Executor] selector map snapshot', {
    ...context.liveSelectorMap,
    ...context.aliasSelectorMap
  });
  // eslint-disable-next-line no-console
  console.log('[Exocor][Executor] requested target id', target);

  const mappedSelector = context.aliasSelectorMap[target] || context.liveSelectorMap[target];
  if (mappedSelector) {
    const mappedElement = queryCandidate(mappedSelector);
    // eslint-disable-next-line no-console
    console.log('[Exocor] Selector for', step.target, ':', mappedSelector, 'found:', !!mappedElement);
    // eslint-disable-next-line no-console
    console.log('[Exocor][Executor] selector lookup', mappedSelector, 'found:', Boolean(mappedElement));
    if (mappedElement) {
      return {
        element: mappedElement,
        selector: mappedSelector,
        locatorKind: context.aliasLocatorKindMap[target],
        resolvedTargetLabel: target
      };
    }
  }

  if (!isElementIdTarget(target)) {
    const appMapLocators = routeScopedAppMapLocators(step, target, map, context);
    for (const locator of appMapLocators) {
      const resolved = resolveLocatorCandidate(locator, step);
      const selector = resolved?.selector || locator.selectorCandidates?.[0] || '';
      // eslint-disable-next-line no-console
      console.log('[Exocor][Executor] app-map selector lookup', selector, 'found:', Boolean(resolved?.element));
      if (!resolved) {
        continue;
      }

      context.aliasSelectorMap[target] = resolved.selector;
      context.aliasLocatorKindMap[target] = locator.kind;
      // eslint-disable-next-line no-console
      console.log('[Exocor][Executor] app-map remap', {
        targetLabel: target,
        selector: resolved.selector,
        kind: locator.kind,
        route: map.currentRoute
      });
      return {
        element: resolved.element,
        selector: resolved.selector,
        locatorKind: locator.kind,
        resolvedTargetLabel: locator.label || target
      };
    }
  }

  const candidates = splitSelectorList(target);
  for (const candidate of candidates) {
    const candidateElement = queryCandidate(candidate);
    // eslint-disable-next-line no-console
    console.log('[Exocor] Selector for', step.target, ':', candidate, 'found:', !!candidateElement);
    // eslint-disable-next-line no-console
    console.log('[Exocor][Executor] direct selector lookup', candidate, 'found:', Boolean(candidateElement));
    if (candidateElement) {
      return {
        element: candidateElement,
        selector: candidate,
        resolvedTargetLabel: target
      };
    }
  }

  if (!isElementIdTarget(target) && policy.allowLiveLabelFallback) {
    const labelMatched = findLabelTarget(step, target, map);
    if (labelMatched) {
      context.aliasSelectorMap[target] = labelMatched.selector;
      // eslint-disable-next-line no-console
      console.log('[Exocor][Executor] label remap', {
        targetLabel: target,
        selector: labelMatched.selector,
        action: step.action
      });
      return {
        element: labelMatched.element,
        selector: labelMatched.selector,
        resolvedTargetLabel: target
      };
    }
  }

  if (policy.allowSemanticFallback) {
    const semantic = findSemanticTarget(step, map);
    if (semantic) {
      context.aliasSelectorMap[target] = semantic.selector;
      // eslint-disable-next-line no-console
      console.log('[Exocor] Selector for', step.target, ':', semantic.selector, 'found:', true);
      // eslint-disable-next-line no-console
      console.log('[Exocor][Executor] semantic remap', {
        targetId: target,
        selector: semantic.selector,
        reason: step.reason,
        value: step.value ?? null
      });
      return {
        element: semantic.element,
        selector: semantic.selector,
        resolvedTargetLabel: target
      };
    }
  }

  // eslint-disable-next-line no-console
  console.log('[Exocor] Selector for', step.target, ':', null, 'found:', false);
  // eslint-disable-next-line no-console
  console.log('[Exocor][Executor] resolution failed for target id', target);
  return null;
}

function setNativeValue(target: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(target, value);
}

type FillableElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;

interface FillAttemptResult {
  filled: boolean;
  beforeValue: string;
  afterValue: string;
  usedElement: FillableElement;
  reason?: string;
}

function isContentEditableTarget(element: HTMLElement): boolean {
  const contentEditable = element.getAttribute('contenteditable');
  if (contentEditable == null) {
    return element.isContentEditable;
  }

  const normalized = contentEditable.toLowerCase();
  return normalized === '' || normalized === 'true';
}

function isRoleTextbox(element: HTMLElement): boolean {
  return (element.getAttribute('role') || '').toLowerCase() === 'textbox';
}

function isDirectlyFillable(element: HTMLElement): boolean {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    element instanceof HTMLSelectElement ||
    isContentEditableTarget(element) ||
    isRoleTextbox(element)
  );
}

function describeElementForFill(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  const role = element.getAttribute('role') || 'none';
  const contentEditable = element.getAttribute('contenteditable');
  return `tag=${tag}, role=${role}, contenteditable=${contentEditable ?? 'null'}`;
}

function resolveFillTarget(element: HTMLElement): FillableElement | null {
  if (isDirectlyFillable(element)) {
    return element;
  }

  const descendants = Array.from(
    element.querySelectorAll<HTMLElement>('input, textarea, select, [contenteditable], [role="textbox"]')
  );

  for (const candidate of descendants) {
    if (isSdkUiElement(candidate)) {
      continue;
    }

    if (isDirectlyFillable(candidate)) {
      return candidate;
    }
  }

  return null;
}

function readFillableValue(target: FillableElement): string {
  if (target instanceof HTMLSelectElement) {
    return target.value || target.selectedOptions[0]?.textContent || '';
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.value || '';
  }

  return (target.innerText || target.textContent || '').trim();
}

function dispatchFillEvents(target: HTMLElement): void {
  target.dispatchEvent(new Event('input', { bubbles: true }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

function dispatchMouseLikeEvent(target: HTMLElement, eventName: string): void {
  if (eventName === 'focus') {
    target.focus();
    if (typeof FocusEvent === 'function') {
      target.dispatchEvent(new FocusEvent('focus'));
    } else {
      target.dispatchEvent(new Event('focus'));
    }
    return;
  }

  if (eventName.startsWith('pointer') && typeof PointerEvent === 'function') {
    target.dispatchEvent(new PointerEvent(eventName, { bubbles: true, cancelable: true, composed: true }));
    return;
  }

  target.dispatchEvent(new MouseEvent(eventName, { bubbles: true, cancelable: true, composed: true }));
}

function dispatchDropdownEventSequence(target: HTMLElement): void {
  for (const eventName of DROPDOWN_EVENT_SEQUENCE) {
    dispatchMouseLikeEvent(target, eventName);
  }
}

function normalizeValueForMatch(value: string): string {
  return value.trim().toLowerCase();
}

function matchesOptionValue(candidate: Element, optionValue: string): boolean {
  const normalized = normalizeValueForMatch(optionValue);
  if (!normalized) {
    return false;
  }

  const text = (candidate.textContent || '').trim().toLowerCase();
  if (text === normalized || text.includes(normalized)) {
    return true;
  }

  const valueAttr = (candidate.getAttribute('value') || candidate.getAttribute('data-value') || '').trim().toLowerCase();
  return valueAttr === normalized || valueAttr.includes(normalized);
}

function isCustomDropdownElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  if (tag !== 'div' && tag !== 'button') {
    return false;
  }

  const role = (element.getAttribute('role') || '').toLowerCase();
  const ariaHasPopup = (element.getAttribute('aria-haspopup') || '').toLowerCase();
  const className = (element.className || '').toLowerCase();
  const classLooksLikeDropdown = /\b(select|dropdown|combobox)\b/.test(className);

  return (
    role === 'combobox' ||
    role === 'listbox' ||
    ariaHasPopup === 'listbox' ||
    ariaHasPopup === 'true' ||
    classLooksLikeDropdown
  );
}

function findDropdownOptionElement(triggerElement: HTMLElement, optionValue: string): HTMLElement | null {
  const normalized = normalizeValueForMatch(optionValue);
  if (!normalized) {
    return null;
  }

  const listboxId = triggerElement.getAttribute('aria-controls');
  if (listboxId) {
    const controlled = document.getElementById(listboxId);
    if (controlled) {
      const controlledOption = Array.from(
        controlled.querySelectorAll<HTMLElement>('[role="option"], [value], [data-value], li, button, div')
      ).find((candidate) => isVisible(candidate) && matchesOptionValue(candidate, normalized));
      if (controlledOption) {
        return controlledOption;
      }
    }
  }

  const allCandidates = Array.from(
    document.querySelectorAll<HTMLElement>('[role="option"], option, [data-value], [value], li, button, div')
  ).filter((candidate) => !candidate.closest(SDK_UI_SELECTOR) && isVisible(candidate));
  return allCandidates.find((candidate) => matchesOptionValue(candidate, normalized)) || null;
}

function applyNativeSelectChange(target: HTMLSelectElement, value: string | null | undefined): StepResult {
  if (value != null) {
    const matchedOption = Array.from(target.options).find((option) => matchesOptionValue(option, value));
    if (!matchedOption) {
      return { executed: false, reason: `Select option "${value}" not found.` };
    }
    target.value = matchedOption.value;
  }

  target.dispatchEvent(new Event('change', { bubbles: true }));
  return { executed: true };
}

function fillInput(element: HTMLElement, value: string): FillAttemptResult | null {
  const target = resolveFillTarget(element);
  if (!target) {
    return null;
  }

  const beforeValue = readFillableValue(target);

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    setNativeValue(target, value);
    dispatchFillEvents(target);
    return {
      filled: true,
      beforeValue,
      afterValue: readFillableValue(target),
      usedElement: target
    };
  }

  if (target instanceof HTMLSelectElement) {
    const match = Array.from(target.options).find((option) =>
      option.textContent?.toLowerCase().includes(value.toLowerCase())
    );

    if (match) {
      target.value = match.value;
    } else {
      target.value = value;
    }

    dispatchFillEvents(target);
    return {
      filled: true,
      beforeValue,
      afterValue: readFillableValue(target),
      usedElement: target
    };
  }

  if (isContentEditableTarget(target) || isRoleTextbox(target)) {
    target.innerText = value;
    dispatchFillEvents(target);
    return {
      filled: true,
      beforeValue,
      afterValue: readFillableValue(target),
      usedElement: target
    };
  }

  return {
    filled: false,
    beforeValue,
    afterValue: beforeValue,
    usedElement: target,
    reason: `Unsupported fill target (${describeElementForFill(target)})`
  };
}

function domSignature(): string {
  const hostElements = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((element) => !isSdkUiElement(element));
  const openDialogs = Array.from(
    document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"]:not([aria-hidden="true"])')
  ).filter((element) => !isSdkUiElement(element)).length;
  const formsVisible = Array.from(document.querySelectorAll<HTMLElement>('form, [role="form"]')).filter(
    (form) => !isSdkUiElement(form) && isVisible(form)
  ).length;
  const fieldValues = Array.from(
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select')
  )
    .filter((field) => !field.closest(SDK_UI_SELECTOR))
    .map((field) => `${fieldSignature(field)}=${readFormValue(field)}`)
    .sort()
    .join('|');

  return `${normalizePath(window.location.pathname)}|${hostElements.length}|${openDialogs}|${formsVisible}|${fieldValues}`;
}

function mutationTouchesHost(records: MutationRecord[]): boolean {
  const nodeTouchesHost = (node: Node | null): boolean => {
    if (!node) {
      return false;
    }

    if (node instanceof Element) {
      return !isSdkUiElement(node);
    }

    return node.parentElement ? !isSdkUiElement(node.parentElement) : false;
  };

  for (const record of records) {
    if (record.type === 'childList') {
      for (const node of Array.from(record.addedNodes)) {
        if (nodeTouchesHost(node)) {
          return true;
        }
      }
      for (const node of Array.from(record.removedNodes)) {
        if (nodeTouchesHost(node)) {
          return true;
        }
      }
      continue;
    }

    if (nodeTouchesHost(record.target)) {
      return true;
    }
  }

  return false;
}

async function waitForUiSettled(beforeSignature: string, mode: UiSettleMode, signal?: AbortSignal): Promise<boolean> {
  throwIfAborted(signal);
  const observerTarget = document.body || document.documentElement;
  if (!observerTarget) {
    await waitForRenderFrames(UI_SETTLED_RENDER_FRAMES);
    return false;
  }

  const startedAt = Date.now();
  let lastActivityAt = startedAt;
  let observedHostChange = false;
  let lastSignature = beforeSignature;

  const observer = new MutationObserver((records) => {
    if (!mutationTouchesHost(records)) {
      return;
    }

    observedHostChange = true;
    lastActivityAt = Date.now();
  });

  observer.observe(observerTarget, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true
  });

  try {
    while (Date.now() - startedAt < WAIT_FOR_UI_SETTLED_TIMEOUT_MS) {
      throwIfAborted(signal);
      const signature = domSignature();
      if (signature !== lastSignature) {
        observedHostChange = true;
        lastActivityAt = Date.now();
        lastSignature = signature;
      }

      const quietWindowSatisfied = Date.now() - lastActivityAt >= UI_SETTLED_QUIET_WINDOW_MS;
      const ready = mode === 'mutation-required' ? observedHostChange && quietWindowSatisfied : quietWindowSatisfied;
      if (ready) {
        await waitForRenderFrames(UI_SETTLED_RENDER_FRAMES);
        throwIfAborted(signal);
        const postFrameSignature = domSignature();
        if (postFrameSignature !== lastSignature) {
          observedHostChange = true;
          lastActivityAt = Date.now();
          lastSignature = postFrameSignature;
          continue;
        }
        return observedHostChange;
      }

      await sleep(WAIT_FOR_UI_SETTLED_POLL_MS, signal);
    }

    await waitForRenderFrames(UI_SETTLED_RENDER_FRAMES);
    throwIfAborted(signal);
    return observedHostChange;
  } finally {
    observer.disconnect();
  }
}

function clickRequiresMutationSettle(
  step: IntentStep,
  element: HTMLElement,
  locatorKind?: AppMapLocatorKind,
  submitLikeCompletionStep?: boolean
): boolean {
  if (step.waitForDOM || submitLikeCompletionStep) {
    return true;
  }

  if (
    locatorKind === 'modalTrigger' ||
    locatorKind === 'tab' ||
    locatorKind === 'filter' ||
    locatorKind === 'navigation' ||
    locatorKind === 'submit'
  ) {
    return true;
  }

  if (step.value != null || element instanceof HTMLSelectElement || isCustomDropdownElement(element)) {
    return true;
  }

  const role = (element.getAttribute('role') || '').toLowerCase();
  const type = (element.getAttribute('type') || '').toLowerCase();

  return (
    element instanceof HTMLAnchorElement ||
    element.hasAttribute('aria-controls') ||
    element.hasAttribute('aria-expanded') ||
    element.hasAttribute('aria-haspopup') ||
    role === 'tab' ||
    role === 'combobox' ||
    type === 'submit'
  );
}

function fillSettleMode(step: IntentStep, target: FillableElement): UiSettleMode {
  if (step.waitForDOM || target instanceof HTMLSelectElement) {
    return 'mutation-required';
  }

  return 'quiet-only';
}

function diffNewElements(previousMap: DOMCapabilityMap, nextMap: DOMCapabilityMap): DOMElementDescriptor[] {
  const previousSelectors = new Set(previousMap.elements.map((element) => element.selector));
  return nextMap.elements.filter((element) => !previousSelectors.has(element.selector));
}

function inferIntentKind(command: string, steps: IntentStep[]): IntentKind {
  const normalized = command.toLowerCase();
  const hasSubmitStep = steps.some((step) => step.action === 'submit');
  const hasFillStep = steps.some((step) => step.action === 'fill');
  const hasNavigateStep = steps.some((step) => step.action === 'navigate');

  if (/\b(create|add|new|submit|save|register|book)\b/.test(normalized) || hasSubmitStep) {
    return 'create';
  }

  if (hasNavigateStep && !hasFillStep && !hasSubmitStep && /\b(go to|navigate|open|view|show)\b/.test(normalized) && !/\b(filter|tab|show only|critical|high|low|medium)\b/.test(normalized)) {
    return 'navigate';
  }

  if (hasFillStep || /\b(fill|set|type|enter|assign|update)\b/.test(normalized)) {
    return 'fill';
  }

  return 'generic';
}

function hasNewListItems(before: DOMSnapshot, after: DOMSnapshot): boolean {
  if (after.listItems.length > before.listItems.length) {
    return true;
  }

  const beforeSet = new Set(before.listItems);
  return after.listItems.some((item) => !beforeSet.has(item));
}

function hasFieldValueChanges(before: DOMSnapshot, after: DOMSnapshot): boolean {
  const keys = new Set([...Object.keys(before.fieldValues), ...Object.keys(after.fieldValues)]);

  for (const key of keys) {
    if ((before.fieldValues[key] || '') !== (after.fieldValues[key] || '')) {
      return true;
    }
  }

  return false;
}

function lastCompletedStepLabel(lastCompletedStep: IntentStep | undefined): string {
  return lastCompletedStep?.reason || lastCompletedStep?.action || 'unknown step';
}

function evaluateStrictSuccess(
  command: string,
  steps: IntentStep[],
  before: DOMSnapshot,
  after: DOMSnapshot,
  fillValueChanged: boolean,
  submitLikeCompletionExecuted: boolean,
  trustedCompletionExecuted: boolean,
  lastCompletedStep: IntentStep | undefined
): { success: boolean; message: string } {
  const kind = inferIntentKind(command, steps);
  const incomplete = `Incomplete — stopped at ${lastCompletedStepLabel(lastCompletedStep)}. Try again or type the command.`;

  if (trustedCompletionExecuted) {
    return {
      success: true,
      message: 'trusted app-native tool executed'
    };
  }

  if (kind === 'create') {
    const newItemAppeared = hasNewListItems(before, after);
    const successToastAppeared = after.notificationTexts.length > before.notificationTexts.length;
    const formDisappeared = after.formsVisible < before.formsVisible || after.openDialogs < before.openDialogs;

    if (newItemAppeared) {
      return { success: true, message: 'created item appeared in list' };
    }

    if (successToastAppeared) {
      return { success: true, message: 'success notification appeared' };
    }

    if (formDisappeared) {
      return { success: true, message: 'form/dialog closed after submission' };
    }

    if (submitLikeCompletionExecuted) {
      return { success: true, message: 'submit-like completion action executed' };
    }

    return { success: false, message: incomplete };
  }

  if (kind === 'navigate') {
    const expectedRoute = steps
      .filter((step) => step.action === 'navigate' && step.target && step.target.startsWith('/'))
      .map((step) => step.target as string)
      .at(-1);

    if (expectedRoute) {
      const matched = normalizePath(after.path) === normalizePath(expectedRoute);
      return {
        success: matched,
        message: matched ? `navigated to ${normalizePath(after.path)}` : incomplete
      };
    }

    const changed = normalizePath(after.path) !== normalizePath(before.path);
    return {
      success: changed,
      message: changed ? `navigated to ${normalizePath(after.path)}` : incomplete
    };
  }

  if (kind === 'fill') {
    return {
      success: fillValueChanged,
      message: fillValueChanged ? 'input value updated' : incomplete
    };
  }

  const meaningfulChange =
    normalizePath(after.path) !== normalizePath(before.path) ||
    hasNewListItems(before, after) ||
    after.notificationTexts.length > before.notificationTexts.length ||
    after.openDialogs !== before.openDialogs ||
    after.formsVisible !== before.formsVisible ||
    hasFieldValueChanges(before, after) ||
    after.elementCount !== before.elementCount;

  return {
    success: meaningfulChange,
    message: meaningfulChange ? 'workflow completed with DOM change' : incomplete
  };
}

async function* stepsFromArray(steps: IntentStep[]): AsyncIterable<IntentStep> {
  for (const step of steps) {
    yield step;
  }
}

async function closeStepIterator(iterator: AsyncIterator<IntentStep>): Promise<void> {
  if (typeof iterator.return !== 'function') {
    return;
  }
  try {
    await iterator.return(undefined);
  } catch {
    // Ignore iterator-close failures during cleanup.
  }
}

/** Executes resolved intents against the current host DOM safely. */
export class ActionExecutor {
  constructor(private readonly debug = false) {}

  async execute(intent: IntentAction, map: DOMCapabilityMap, options: ExecuteOptions = {}): Promise<ExecutionResult> {
    const step: IntentStep = {
      action: intent.action,
      target: intent.target,
      value: intent.value,
      reason: 'single-step execution'
    };

    const result = await this.executeSequence([step], map, {
      originalIntent: intent.rawCommand,
      refreshMap: options.refreshMap,
      appMap: options.appMap,
      navigate: options.navigate,
      resolutionPriority: options.resolutionPriority,
      signal: options.signal
    });

    return {
      executed: result.executed,
      reason: result.reason
    };
  }

  async executeSequence(
    steps: IntentStep[],
    map: DOMCapabilityMap,
    options: ExecuteSequenceOptions = {}
  ): Promise<SequenceExecutionResult> {
    return this.executeSequenceInternal(stepsFromArray(steps), map, options, steps);
  }

  async executeStreamedSequence(
    stepSource: AsyncIterable<IntentStep>,
    map: DOMCapabilityMap,
    options: ExecuteSequenceOptions = {}
  ): Promise<SequenceExecutionResult> {
    return this.executeSequenceInternal(stepSource, map, options);
  }

  private async executeSequenceInternal(
    stepSource: AsyncIterable<IntentStep>,
    map: DOMCapabilityMap,
    options: ExecuteSequenceOptions = {},
    plannedSteps?: IntentStep[]
  ): Promise<SequenceExecutionResult> {
    const beforeSequence = captureDOMSnapshot();
    let currentMap = map;
    const resolutionContext: ResolutionContext = {
      liveSelectorMap: { ...map.compressed.selectorMap },
      aliasSelectorMap: {},
      aliasLocatorKindMap: {},
      appMapSelectorIndex: buildAppMapSelectorIndex(options.appMap)
    };

    const newElementsBySelector = new Map<string, DOMElementDescriptor>();
    let completedSteps = 0;
    let fillValueChanged = false;
    let submitLikeCompletionExecuted = false;
    let trustedCompletionExecuted = false;
    let lastCompletedStep: IntentStep | undefined;
    const consumedSteps: IntentStep[] = [];
    const effectivePriority: ResolutionPriority = options.resolutionPriority || 'dom_only';
    const iterator = stepSource[Symbol.asyncIterator]();
    let activeStep: IntentStep | undefined;

    try {
      let index = 0;
      let currentStepResult: IteratorResult<IntentStep>;
      throwIfAborted(options.signal);
      try {
        currentStepResult = await iterator.next();
      } catch {
        return {
          executed: false,
          reason: 'Step stream failed before execution started.',
          completedSteps,
          failedStepReason: 'Step stream failed before execution started.',
          lastCompletedStep,
          newElementsAfterWait: Array.from(newElementsBySelector.values())
        };
      }

      while (!currentStepResult.done) {
        throwIfAborted(options.signal);
        const step = currentStepResult.value;
        activeStep = step;
        consumedSteps.push(step);
        options.onProgress?.(`${step.reason || step.action}...`, step, index);

        let beforeSignature = domSignature();
        const allowSemanticFallback = effectivePriority === 'dom_only';
        let execution = await this.executeStep(step, currentMap, resolutionContext, options, {
          allowLiveLabelFallback: effectivePriority === 'dom_only',
          allowSemanticFallback
        });

        if (!execution.executed && execution.targetNotFound && options.refreshMap) {
          const previousMap = currentMap;
          const refreshedMap = options.refreshMap();
          currentMap = refreshedMap;
          resolutionContext.liveSelectorMap = { ...currentMap.compressed.selectorMap };

          const refreshedElements = diffNewElements(previousMap, refreshedMap);
          for (const element of refreshedElements) {
            newElementsBySelector.set(element.selector, element);
          }

          beforeSignature = domSignature();
          execution = await this.executeStep(step, currentMap, resolutionContext, options, {
            allowLiveLabelFallback: true,
            allowSemanticFallback
          });
        }

        if (!execution.executed) {
          await closeStepIterator(iterator);
          return {
            executed: false,
            reason: execution.reason || 'Step execution failed.',
            completedSteps,
            failedStep: step,
            failedStepReason: execution.reason || 'Step execution failed.',
            lastCompletedStep,
            newElementsAfterWait: Array.from(newElementsBySelector.values())
          };
        }

        if (execution.valueChanged) {
          fillValueChanged = true;
        }
        if (execution.submitLikeCompletionExecuted) {
          submitLikeCompletionExecuted = true;
        }
        if (execution.trustedCompletionExecuted) {
          trustedCompletionExecuted = true;
        }

        completedSteps += 1;
        lastCompletedStep = step;
        activeStep = undefined;

        if (step.action !== 'wait') {
          await waitForUiSettled(
            beforeSignature,
            execution.settleMode || (step.waitForDOM ? 'mutation-required' : 'quiet-only'),
            options.signal
          );
          if (options.refreshMap) {
            const previousMap = currentMap;
            const refreshedMap = options.refreshMap();
            currentMap = refreshedMap;
            resolutionContext.liveSelectorMap = { ...currentMap.compressed.selectorMap };

            const newElements = diffNewElements(previousMap, refreshedMap);
            for (const element of newElements) {
              newElementsBySelector.set(element.selector, element);
            }
          }
        }

        let nextStepResult: IteratorResult<IntentStep>;
        try {
          throwIfAborted(options.signal);
          nextStepResult = await iterator.next();
        } catch {
          await closeStepIterator(iterator);
          return {
            executed: false,
            reason: 'Step stream failed during execution.',
            completedSteps,
            failedStepReason: 'Step stream failed during execution.',
            lastCompletedStep,
            newElementsAfterWait: Array.from(newElementsBySelector.values())
          };
        }

        if (!nextStepResult.done && step.action !== 'wait') {
          await sleep(step.ms ?? options.defaultDelayMs ?? DEFAULT_STEP_DELAY_MS, options.signal);
        }

        currentStepResult = nextStepResult;
        index += 1;
      }

      throwIfAborted(options.signal);
      const stepsForSuccessCheck = plannedSteps || consumedSteps;
      const afterSequence = captureDOMSnapshot();
      const strictCheck = evaluateStrictSuccess(
        options.originalIntent || '',
        stepsForSuccessCheck,
        beforeSequence,
        afterSequence,
        fillValueChanged,
        submitLikeCompletionExecuted,
        trustedCompletionExecuted,
        lastCompletedStep
      );

      if (!strictCheck.success) {
        return {
          executed: false,
          reason: strictCheck.message,
          completedSteps,
          failedStepReason: strictCheck.message,
          lastCompletedStep,
          newElementsAfterWait: Array.from(newElementsBySelector.values())
        };
      }

      return {
        executed: true,
        completedSteps,
        successDescription: strictCheck.message,
        lastCompletedStep,
        newElementsAfterWait: Array.from(newElementsBySelector.values())
      };
    } catch (error) {
      if (!isAbortError(error)) {
        throw error;
      }
      await closeStepIterator(iterator);
      return {
        executed: false,
        reason: 'Stopped by user.',
        completedSteps,
        failedStep: activeStep,
        failedStepReason: 'Stopped by user.',
        lastCompletedStep,
        newElementsAfterWait: Array.from(newElementsBySelector.values())
      };
    }
  }

  private async executeStep(
    step: IntentStep,
    map: DOMCapabilityMap,
    resolutionContext: ResolutionContext,
    options: ExecuteSequenceOptions,
    resolutionPolicy: ResolutionPolicy
  ): Promise<StepResult> {
    throwIfAborted(options.signal);
    // eslint-disable-next-line no-console
    console.log('[Exocor] Executing step:', JSON.stringify(step));
    if (this.debug) {
      // eslint-disable-next-line no-console
      console.log('[Exocor] Step:', step);
    }

    switch (step.action) {
      case 'wait': {
        await sleep(step.ms ?? DEFAULT_STEP_DELAY_MS, options.signal);
        return { executed: true };
      }
      case 'click': {
        if (!step.target) {
          return { executed: true, reason: 'Missing click target; skipped.' };
        }

        const resolvedTarget = resolveTargetElement(step, map, resolutionContext, resolutionPolicy);
        if (!resolvedTarget) {
          return { executed: false, reason: 'Click target not found.', targetNotFound: true };
        }
        const element = resolvedTarget.element;
        const submitLikeCompletionStep = isSubmitLikeCompletionStep({
          step,
          locatorKind: resolvedTarget.locatorKind,
          resolvedTargetLabel: resolvedTarget.resolvedTargetLabel || step.target || ''
        });

        if (element instanceof HTMLSelectElement) {
          const selectionResult = applyNativeSelectChange(element, step.value);
          if (!selectionResult.executed) {
            return selectionResult;
          }
          return {
            ...selectionResult,
            submitLikeCompletionExecuted: submitLikeCompletionStep,
            settleMode: 'mutation-required'
          };
        }

        if (isCustomDropdownElement(element)) {
          dispatchDropdownEventSequence(element);
          await sleep(DROPDOWN_INTERACTION_DELAY_MS, options.signal);

          if (step.value) {
            const option = findDropdownOptionElement(element, step.value);
            if (!option) {
              return { executed: false, reason: `Dropdown option "${step.value}" not found.` };
            }

            dispatchDropdownEventSequence(option);
            await sleep(DROPDOWN_INTERACTION_DELAY_MS, options.signal);
          }

          return {
            executed: true,
            submitLikeCompletionExecuted: submitLikeCompletionStep,
            settleMode: 'mutation-required'
          };
        }

        element.click();
        return {
          executed: true,
          submitLikeCompletionExecuted: submitLikeCompletionStep,
          settleMode: clickRequiresMutationSettle(step, element, resolvedTarget.locatorKind, submitLikeCompletionStep)
            ? 'mutation-required'
            : 'quiet-only'
        };
      }
      case 'fill': {
        if (!step.target || step.value == null) {
          return { executed: true, reason: 'Missing fill target or value; skipped.' };
        }

        const resolvedTarget = resolveTargetElement(step, map, resolutionContext, resolutionPolicy);
        if (!resolvedTarget) {
          return { executed: false, reason: 'Fill target not found.', targetNotFound: true };
        }
        const element = resolvedTarget.element;

        const fillAttempt = fillInput(element, step.value);
        if (!fillAttempt) {
          const details = describeElementForFill(element);
          // eslint-disable-next-line no-console
          console.log('[Exocor][Executor] fill failed - no fillable descendant', details);
          return {
            executed: false,
            reason: `Fill target not editable (${details})`
          };
        }

        if (!fillAttempt.filled) {
          const details = describeElementForFill(fillAttempt.usedElement as HTMLElement);
          // eslint-disable-next-line no-console
          console.log('[Exocor][Executor] fill failed - unsupported target', details);
          return {
            executed: false,
            reason: fillAttempt.reason || `Fill target not editable (${details})`
          };
        }

        const valueChanged = fillAttempt.beforeValue !== fillAttempt.afterValue;

        // eslint-disable-next-line no-console
        console.log('[Exocor][Executor] fill value changed', valueChanged, {
          beforeValue: fillAttempt.beforeValue,
          afterValue: fillAttempt.afterValue,
          target: describeElementForFill(fillAttempt.usedElement as HTMLElement)
        });
        return { executed: true, valueChanged, settleMode: fillSettleMode(step, fillAttempt.usedElement) };
      }
      case 'navigate': {
        if (!step.target || !step.target.startsWith('/')) {
          return { executed: true, reason: 'Invalid navigate target; skipped.' };
        }

        const expectedPath = normalizePath(step.target);
        const initialPath = normalizePath(window.location.pathname);

        const waitForExpectedPath = async (): Promise<boolean> => {
          const startedAt = Date.now();
          while (Date.now() - startedAt <= WAIT_FOR_ROUTE_TIMEOUT_MS) {
            throwIfAborted(options.signal);
            if (normalizePath(window.location.pathname) === expectedPath) {
              return true;
            }
            await sleep(WAIT_FOR_ROUTE_POLL_MS, options.signal);
          }
          return normalizePath(window.location.pathname) === expectedPath;
        };

        if (options.navigate) {
          try {
            const navigateResult = await options.navigate(expectedPath);
            if (navigateResult !== false) {
              const navigated = await waitForExpectedPath();
              if (navigated) {
                return { executed: true, settleMode: 'mutation-required' };
              }
            }
          } catch {
            // Ignore navigate-driver failures and fall back to UI/history navigation.
          }
        }

        const navLocators = routeScopedNavigationLocators(expectedPath, map, resolutionContext);
        for (const locator of navLocators) {
          const resolved = resolveLocatorCandidate(locator, {
            ...step,
            action: 'click',
            target: locator.label || step.target
          });
          if (!resolved) {
            continue;
          }
          resolved.element.click();
          const navigated = await waitForExpectedPath();
          if (navigated) {
            return { executed: true, settleMode: 'mutation-required' };
          }
        }

        window.history.pushState({}, '', expectedPath);
        window.dispatchEvent(new PopStateEvent('popstate'));
        const navigated = await waitForExpectedPath();
        if (navigated || normalizePath(window.location.pathname) !== initialPath) {
          return { executed: true, settleMode: 'mutation-required' };
        }
        return { executed: false, reason: `Navigate target "${expectedPath}" not reached.` };
      }
      case 'scroll': {
        if (!step.target) {
          return { executed: true, reason: 'Missing scroll target; skipped.' };
        }

        const resolvedTarget = resolveTargetElement(step, map, resolutionContext, resolutionPolicy);
        if (!resolvedTarget) {
          return { executed: false, reason: 'Scroll target not found.', targetNotFound: true };
        }
        const element = resolvedTarget.element;

        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return { executed: true, settleMode: step.waitForDOM ? 'mutation-required' : 'quiet-only' };
      }
      case 'submit': {
        if (!step.target) {
          return { executed: true, reason: 'Missing submit target; skipped.', submitLikeCompletionExecuted: false };
        }

        const resolvedTarget = resolveTargetElement(step, map, resolutionContext, resolutionPolicy);
        if (!resolvedTarget) {
          return { executed: false, reason: 'Submit target not found.', targetNotFound: true };
        }
        const element = resolvedTarget.element;

        const form = element instanceof HTMLFormElement ? element : element.closest('form');
        if (!form) {
          return { executed: false, reason: 'Submit target is not inside a form.' };
        }

        form.requestSubmit();
        return {
          executed: true,
          submitLikeCompletionExecuted: isSubmitLikeCompletionStep({
            step,
            locatorKind: resolvedTarget.locatorKind,
            resolvedTargetLabel: resolvedTarget.resolvedTargetLabel || step.target || ''
          }),
          settleMode: 'mutation-required'
        };
      }
      case 'tool': {
        if (!options.toolRegistry) {
          return { executed: false, reason: 'Tool registry unavailable.' };
        }

        const toolId = step.toolId || step.target || '';
        const validation = options.toolRegistry.validateArgs(toolId, step.args);
        if (!validation.ok) {
          return {
            executed: false,
            reason: validation.reason
          };
        }

        const currentRoute = normalizeToolRoutePath(map.currentRoute || window.location.pathname || '/');
        if (!toolMatchesCurrentRoute(validation.tool, currentRoute)) {
          return {
            executed: false,
            reason: `Tool "${validation.tool.id}" is scoped to ${validation.tool.routes.join(', ')} but current route is ${currentRoute}.`
          };
        }

        try {
          await validation.tool.handler(validation.args || {});
        } catch (error) {
          return {
            executed: false,
            reason:
              error instanceof Error && error.message
                ? `Tool "${validation.tool.id}" failed: ${error.message}`
                : `Tool "${validation.tool.id}" failed.`
          };
        }

        return {
          executed: true,
          trustedCompletionExecuted: true,
          settleMode: 'quiet-only'
        };
      }
      default:
        return { executed: true, reason: 'Unsupported action; skipped.' };
    }
  }
}
