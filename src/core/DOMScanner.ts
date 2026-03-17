import { createCapabilityMap } from './CapabilityMap';
import { isSdkUiElement } from './sdkUi';
import type { AppMap, AppMapLocatorRef, AppMapSummary, DOMCapabilityMap, DOMElementDescriptor, RouteMap } from '../types';

type PrimitiveHint = string | number | boolean | null;
type PropsHint = Record<string, PrimitiveHint>;
type NavigateFn = (path: string) => void | Promise<unknown>;

interface RouteDefinition {
  path: string;
  navigatePath: string;
  componentName: string;
}

interface RouterSnapshot {
  currentRoute: string;
  routes: RouteDefinition[];
  navigate: NavigateFn | null;
}

type FiberNode = {
  child?: FiberNode | null;
  sibling?: FiberNode | null;
  return?: FiberNode | null;
  type?: unknown;
  memoizedProps?: unknown;
  memoizedState?: unknown;
  stateNode?: unknown;
};

export const APP_MAP_STORAGE_KEY = 'exocor.appmap.v1';
export const APP_MAP_SCHEMA_VERSION_STORAGE_KEY = 'exocor.appmap.schema-version';
export const APP_MAP_CACHE_METADATA_STORAGE_KEY = 'exocor.appmap.cache-metadata';
const LEGACY_APP_MAP_STORAGE_KEY = 'haelo.appmap.v1';
const LEGACY_APP_MAP_SCHEMA_VERSION_STORAGE_KEY = 'haelo.appmap.schema-version';
const LEGACY_APP_MAP_CACHE_METADATA_STORAGE_KEY = 'haelo.appmap.cache-metadata';
export const APP_MAP_VERSION = 'v3';
export const APP_MAP_INTEGRITY_REVISION = 'r1';
export const APP_MAP_SDK_BUILD_VERSION = __EXOCOR_SDK_VERSION__;
const DISCOVERY_NAVIGATION_POLL_MS = 50;
const DISCOVERY_NAVIGATION_TIMEOUT_MS = 2000;
const DISCOVERY_SETTLE_WAIT_MS = 300;
const DISCOVERY_TRIGGER_WAIT_MS = 400;
const DISCOVERY_MODAL_CLOSE_WAIT_MS = 300;
const DISCOVERY_TAB_WAIT_MS = 300;
const DISCOVERY_BOOTSTRAP_POLL_MS = 100;
const DISCOVERY_BOOTSTRAP_TIMEOUT_MS = 3000;
const DISCOVERY_BOOTSTRAP_STABLE_TICKS = 2;
const DISCOVERY_MAX_ROUTES = 32;

const INTERACTIVE_TAGS = new Set(['button', 'input', 'textarea', 'select', 'a', 'form']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'textbox', 'combobox', 'menuitem', 'tab']);

export interface AppMapCacheMetadata {
  schemaVersion: string;
  sdkBuildVersion: string;
  integrityRevision: string;
  scopeSignature: string;
}

export interface AppCacheScope {
  key: string;
  signature: string;
  origin: string;
  currentRoute: string;
  strategy: 'router' | 'route_fallback';
}

export interface ScopedAppMapStorageKeys {
  appMap: string;
  schemaVersion: string;
  metadata: string;
}

interface StoredAppMapRecoveryCandidate {
  appMap: AppMap;
  scopeKey: string;
  discoveredAt: number;
}

export type AppMapCacheReadReason =
  | 'valid'
  | 'no_cache'
  | 'meta_mismatch'
  | 'schema_mismatch'
  | 'invalid_shape'
  | 'integrity_invalid';

const APP_MAP_CACHE_READ_REASON_PRIORITY: Record<AppMapCacheReadReason, number> = {
  valid: 0,
  no_cache: 1,
  meta_mismatch: 2,
  schema_mismatch: 3,
  invalid_shape: 4,
  integrity_invalid: 5
};

interface AppMapSanitizeResult {
  appMap: AppMap | null;
  reason: AppMapCacheReadReason;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function textContent(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, maxLength = 120): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function normalizePath(pathname: string): string {
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

function normalizeDiscoveryPath(pathname: string): string {
  const normalized = normalizePath(pathname).toLowerCase();
  if (normalized.length <= 1) {
    return '/';
  }
  return normalized.replace(/\/+$/, '');
}

function joinPaths(parentPath: string, childPath: string): string {
  const parent = normalizePath(parentPath);
  const child = childPath.trim();

  if (!child || child === '.') {
    return parent;
  }

  if (child.startsWith('/')) {
    return normalizePath(child);
  }

  const base = parent === '/' ? '' : parent;
  return normalizePath(`${base}/${child}`);
}

function toNavigablePath(pathname: string): string {
  const normalized = normalizePath(pathname)
    .replace(/\/\*+$/g, '')
    .replace(/\/:([a-zA-Z0-9_]+)\??/g, '/sample')
    .replace(/\*/g, '');

  return normalizePath(normalized);
}

function hasDynamicRouteToken(pathname: string): boolean {
  const value = pathname.trim();
  return value.includes(':') || value.includes('*');
}

function isSafeDiscoveryRoute(routePath: string, originRoute: string): boolean {
  const normalizedPath = normalizePath(routePath);
  if (normalizedPath === normalizePath(originRoute)) {
    return true;
  }

  if (!normalizedPath || hasDynamicRouteToken(routePath)) {
    return false;
  }

  if (normalizedPath.includes('/sample')) {
    return false;
  }

  return true;
}

function toPrimitiveHint(value: unknown): PrimitiveHint | undefined {
  if (value == null) {
    return null;
  }

  if (typeof value === 'string') {
    return truncate(value, 80);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

function summarizeObject(value: Record<string, unknown>, maxKeys = 6): PropsHint {
  const summary: PropsHint = {};

  for (const [key, entry] of Object.entries(value).slice(0, maxKeys)) {
    const primitive = toPrimitiveHint(entry);
    if (primitive !== undefined) {
      summary[key] = primitive;
    }
  }

  return summary;
}

function escapeCss(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function isVisible(element: Element): boolean {
  const style = window.getComputedStyle(element as HTMLElement);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return false;
  }

  const withinX = rect.right >= 0 && rect.left <= window.innerWidth;
  const withinY = rect.bottom >= 0 && rect.top <= window.innerHeight;

  return withinX && withinY;
}

function isNonSdkElement<T extends Element>(element: T | null | undefined): element is T {
  return Boolean(element) && !isSdkUiElement(element);
}

function queryNonSdkElements<T extends Element>(root: ParentNode, selector: string): T[] {
  return Array.from(root.querySelectorAll<T>(selector)).filter((element): element is T => isNonSdkElement(element));
}

function queryVisibleNonSdkElements<T extends HTMLElement>(root: ParentNode, selector: string): T[] {
  return queryNonSdkElements<T>(root, selector).filter((element) => isVisible(element));
}

function findFirstNonSdkElement<T extends Element>(root: ParentNode, selector: string): T | null {
  return queryNonSdkElements<T>(root, selector)[0] || null;
}

function isFillableNode(domNode: HTMLElement, props: Record<string, unknown>): boolean {
  const tag = domNode.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    return true;
  }

  const role = textContent(domNode.getAttribute('role') || (toPrimitiveHint(props.role) as string | undefined) || '');
  if (role.toLowerCase() === 'textbox') {
    return true;
  }

  const domContentEditable = domNode.getAttribute('contenteditable');
  if (domNode.isContentEditable || domContentEditable === '' || domContentEditable === 'true') {
    return true;
  }

  const propContentEditable = props.contentEditable;
  if (typeof propContentEditable === 'boolean' && propContentEditable) {
    return true;
  }

  if (typeof propContentEditable === 'string' && propContentEditable.toLowerCase() === 'true') {
    return true;
  }

  return false;
}

function uniqueSelector(element: Element): string {
  const id = element.getAttribute('id');
  if (id) {
    return `#${escapeCss(id)}`;
  }

  const testId = element.getAttribute('data-testid') || element.getAttribute('data-test-id');
  if (testId) {
    return `[data-testid="${escapeCss(testId)}"]`;
  }

  const name = element.getAttribute('name');
  if (name) {
    return `${element.tagName.toLowerCase()}[name="${escapeCss(name)}"]`;
  }

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return `${element.tagName.toLowerCase()}[aria-label="${escapeCss(ariaLabel)}"]`;
  }

  const path: string[] = [];
  let node: Element | null = element;

  while (node && node !== document.body) {
    const tagName = node.tagName.toLowerCase();
    const parentElement: Element | null = node.parentElement;

    if (!parentElement) {
      break;
    }

    const siblings = Array.from(parentElement.children as HTMLCollectionOf<Element>).filter(
      (sibling: Element) => sibling.tagName.toLowerCase() === tagName
    );

    const index = siblings.indexOf(node);
    const part = siblings.length > 1 ? `${tagName}:nth-of-type(${index + 1})` : tagName;
    path.unshift(part);
    node = parentElement;
  }

  return path.length ? `body > ${path.join(' > ')}` : element.tagName.toLowerCase();
}

function normalizeLocatorLabel(value: string | null | undefined): string {
  return textContent(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function toLabelKey(value: string | null | undefined): string {
  return normalizeLocatorLabel(value).replace(/[^a-z0-9]/g, '');
}

function pushSelectorCandidate(candidates: string[], selector: string | null | undefined): void {
  const normalized = textContent(selector || '');
  if (!normalized) {
    return;
  }
  if (!candidates.includes(normalized)) {
    candidates.push(normalized);
  }
}

function selectorMatchesOnlyElement(selector: string, element: Element): boolean {
  try {
    const matches = queryNonSdkElements<Element>(document, selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

function selectorCandidatesForElement(element: HTMLElement): string[] {
  const tagName = element.tagName.toLowerCase();
  const uniqueCandidates: string[] = [];
  const fallbackCandidates: string[] = [];
  const id = element.getAttribute('id');
  const testId = element.getAttribute('data-testid') || element.getAttribute('data-test-id');
  const name = element.getAttribute('name');
  const ariaLabel = element.getAttribute('aria-label');
  const role = textContent(element.getAttribute('role')).toLowerCase();

  if (id) {
    const selector = `#${escapeCss(id)}`;
    if (selectorMatchesOnlyElement(selector, element)) {
      pushSelectorCandidate(uniqueCandidates, selector);
    } else {
      pushSelectorCandidate(fallbackCandidates, selector);
    }
  }

  if (testId) {
    const selector = `[data-testid="${escapeCss(testId)}"]`;
    if (selectorMatchesOnlyElement(selector, element)) {
      pushSelectorCandidate(uniqueCandidates, selector);
    } else {
      pushSelectorCandidate(fallbackCandidates, selector);
    }
  }

  if (name) {
    const selector = `${tagName}[name="${escapeCss(name)}"]`;
    if (selectorMatchesOnlyElement(selector, element)) {
      pushSelectorCandidate(uniqueCandidates, selector);
    } else {
      pushSelectorCandidate(fallbackCandidates, selector);
    }
  }

  if (ariaLabel) {
    const selector = `${tagName}[aria-label="${escapeCss(ariaLabel)}"]`;
    if (selectorMatchesOnlyElement(selector, element)) {
      pushSelectorCandidate(uniqueCandidates, selector);
    } else {
      pushSelectorCandidate(fallbackCandidates, selector);
    }

    if (role) {
      const roleSelector = `[role="${escapeCss(role)}"][aria-label="${escapeCss(ariaLabel)}"]`;
      if (selectorMatchesOnlyElement(roleSelector, element)) {
        pushSelectorCandidate(uniqueCandidates, roleSelector);
      } else {
        pushSelectorCandidate(fallbackCandidates, roleSelector);
      }
    }
  }

  const structural = uniqueSelector(element);
  if (selectorMatchesOnlyElement(structural, element)) {
    pushSelectorCandidate(uniqueCandidates, structural);
  } else {
    pushSelectorCandidate(fallbackCandidates, structural);
  }

  return [...uniqueCandidates, ...fallbackCandidates];
}

function getReactPropsFromElement(element: Element): Record<string, unknown> {
  const host = element as unknown as Record<string, unknown>;
  const reactPropsKey = Object.keys(host).find((key) => key.startsWith('__reactProps'));
  if (!reactPropsKey) {
    return {};
  }

  const maybeProps = host[reactPropsKey];
  return isRecord(maybeProps) ? maybeProps : {};
}

function normalizeNavigationPathCandidate(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return normalizeHrefToPath(value);
}

function inferPathFromSource(source: string | null | undefined): string | null {
  const normalizedSource = textContent(source);
  if (!normalizedSource) {
    return null;
  }

  if (!/(navigate|history\.push|router\.navigate|location\.assign|pushState|replace)/i.test(normalizedSource)) {
    return null;
  }

  const match = normalizedSource.match(/['"`](\/[^'"`?#]*)[^'"`]*['"`]/);
  if (!match || !match[1]) {
    return null;
  }

  return normalizePath(match[1]);
}

function hasRouteNavigationSignal(element: HTMLElement, props: Record<string, unknown>): boolean {
  if (inferPathFromSource(element.getAttribute('onclick'))) {
    return true;
  }

  const onClick = props.onClick;
  if (typeof onClick !== 'function') {
    return false;
  }

  try {
    return /(navigate|history\.push|router\.navigate|location\.assign|pushState|replace)/i.test(onClick.toString());
  } catch {
    return false;
  }
}

function extractNavigationPathFromElement(element: HTMLElement, props: Record<string, unknown>): string | null {
  const directCandidates = [
    element.getAttribute('href'),
    element.getAttribute('to'),
    element.getAttribute('data-href'),
    element.getAttribute('data-to'),
    element.getAttribute('data-path'),
    element.getAttribute('data-route'),
    element.getAttribute('pathname'),
    typeof props.href === 'string' ? props.href : null,
    typeof props.to === 'string' ? props.to : null,
    typeof props.path === 'string' ? props.path : null,
    typeof props.pathname === 'string' ? props.pathname : null
  ];

  for (const candidate of directCandidates) {
    const normalized = normalizeNavigationPathCandidate(candidate);
    if (normalized) {
      return normalized;
    }
  }

  const fromOnClickAttribute = inferPathFromSource(element.getAttribute('onclick'));
  if (fromOnClickAttribute) {
    return fromOnClickAttribute;
  }

  const onClick = props.onClick;
  if (typeof onClick !== 'function') {
    return null;
  }

  try {
    return inferPathFromSource(onClick.toString());
  } catch {
    return null;
  }
}

/** Returns the React Fiber root from a potential React root container element. */
function getFiberRoot(rootElement: Element): FiberNode | null {
  const key = Object.keys(rootElement).find(
    (entry) =>
      entry.startsWith('__reactFiber') ||
      entry.startsWith('__reactInternalInstance') ||
      entry.startsWith('__reactContainer')
  );

  if (!key) {
    return null;
  }

  const value = (rootElement as unknown as Record<string, unknown>)[key];

  if (isRecord(value) && isRecord(value.current)) {
    return value.current as FiberNode;
  }

  return (value as FiberNode) || null;
}

function toRootFiber(fiber: FiberNode): FiberNode {
  let current = fiber;
  const seen = new Set<object>();

  while (current.return && isRecord(current.return) && !seen.has(current.return as object)) {
    seen.add(current.return as object);
    current = current.return;
  }

  return current;
}

function fiberStateElement(stateNode: unknown): Element | null {
  if (stateNode instanceof Element) {
    return stateNode;
  }

  if (isRecord(stateNode) && stateNode.containerInfo instanceof Element) {
    return stateNode.containerInfo;
  }

  return null;
}

function isSdkUiFiberRoot(fiber: FiberNode): boolean {
  return isSdkUiElement(fiberStateElement(fiber.stateNode));
}

/** Walks a Fiber tree depth-first and calls visitor for every node. */
function walkFiber(root: FiberNode, visitor: (fiber: FiberNode) => boolean | void): void {
  const stack: FiberNode[] = [root];
  const seen = new Set<object>();

  while (stack.length) {
    const fiber = stack.pop();
    if (!fiber || !isRecord(fiber)) {
      continue;
    }

    if (seen.has(fiber as object)) {
      continue;
    }

    seen.add(fiber as object);
    const shouldDescend = visitor(fiber) !== false;

    if (fiber.sibling) {
      stack.push(fiber.sibling);
    }

    if (shouldDescend && fiber.child) {
      stack.push(fiber.child);
    }
  }
}

function discoverFiberRoots(): FiberNode[] {
  const roots = new Set<FiberNode>();
  const candidates = new Set<Element>();

  if (document.getElementById('root')) {
    candidates.add(document.getElementById('root') as Element);
  }

  candidates.add(document.body);
  Array.from(document.body.children).forEach((child) => {
    candidates.add(child);
  });

  Array.from(document.querySelectorAll('[data-reactroot], [id*="root" i]')).forEach((element) => {
    candidates.add(element);
  });

  for (const candidate of candidates) {
    if (isSdkUiElement(candidate)) {
      continue;
    }

    const fiber = getFiberRoot(candidate);
    if (fiber) {
      const rootFiber = toRootFiber(fiber);
      if (!isSdkUiFiberRoot(rootFiber)) {
        roots.add(rootFiber);
      }
    }
  }

  if (!roots.size) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode as Element | null;
    let scanned = 0;

    while (node && scanned < 800) {
      const fiber = isSdkUiElement(node) ? null : getFiberRoot(node);
      if (fiber) {
        const rootFiber = toRootFiber(fiber);
        if (!isSdkUiFiberRoot(rootFiber)) {
          roots.add(rootFiber);
        }
      }
      node = walker.nextNode() as Element | null;
      scanned += 1;
    }
  }

  return Array.from(roots);
}

function readTypeName(typeValue: unknown): string | null {
  if (!typeValue) {
    return null;
  }

  if (typeof typeValue === 'function') {
    const fn = typeValue as Function & { displayName?: string };
    return fn.displayName || fn.name || null;
  }

  if (typeof typeValue === 'object' && typeValue !== null) {
    const record = typeValue as Record<string, unknown>;
    const displayName = record.displayName;
    const name = record.name;
    const render = record.render;

    if (typeof displayName === 'string' && displayName) {
      return displayName;
    }

    if (typeof name === 'string' && name) {
      return name;
    }

    if (typeof render === 'function') {
      const renderFn = render as Function & { displayName?: string };
      return renderFn.displayName || renderFn.name || null;
    }
  }

  return null;
}

function inferComponentName(fiber: FiberNode): string | null {
  let cursor: FiberNode | undefined | null = fiber;
  const visited = new Set<object>();

  while (cursor && isRecord(cursor) && !visited.has(cursor as object)) {
    visited.add(cursor as object);
    const name = readTypeName(cursor.type);
    if (name && !/^[a-z]+$/.test(name)) {
      return name;
    }
    cursor = cursor.return;
  }

  return readTypeName(fiber.type);
}

function extractHandlers(props: Record<string, unknown>): string[] {
  return Object.entries(props)
    .filter(([key, value]) => key.startsWith('on') && typeof value === 'function')
    .map(([key, value]) => `${key}:${(value as Function).name || key}`)
    .slice(0, 8);
}

function extractStateValues(fiber: FiberNode): DOMElementDescriptor['state'] {
  const values: DOMElementDescriptor['state'] = [];
  const stateValue = fiber.memoizedState;

  if (stateValue == null) {
    return values;
  }

  if (isRecord(stateValue) && 'next' in stateValue) {
    let cursor: Record<string, unknown> | null = stateValue;
    const visited = new Set<object>();

    while (cursor && !visited.has(cursor) && values.length < 8) {
      visited.add(cursor);
      const memoized = cursor.memoizedState;

      if ('queue' in cursor || memoized !== undefined) {
        const primitive = toPrimitiveHint(memoized);
        if (primitive !== undefined) {
          values.push(primitive);
        } else if (Array.isArray(memoized)) {
          values.push(truncate(`array(${memoized.length})`, 42));
        } else if (isRecord(memoized)) {
          values.push(summarizeObject(memoized));
        }
      }

      cursor = isRecord(cursor.next) ? (cursor.next as Record<string, unknown>) : null;
    }

    return values;
  }

  const primitive = toPrimitiveHint(stateValue);
  if (primitive !== undefined) {
    values.push(primitive);
  } else if (isRecord(stateValue)) {
    values.push(summarizeObject(stateValue));
  }

  return values;
}

function pickProps(props: Record<string, unknown>): PropsHint {
  const keep = [
    'disabled',
    'aria-label',
    'placeholder',
    'value',
    'contentEditable',
    'name',
    'type',
    'data-state',
    'data-status',
    'aria-expanded',
    'aria-selected',
    'checked',
    'open',
    'required',
    'role',
    'to',
    'href'
  ];

  const picked: PropsHint = {};

  for (const key of keep) {
    const value = props[key];
    const primitive = toPrimitiveHint(value);
    if (primitive !== undefined) {
      picked[key] = primitive;
    }
  }

  return picked;
}

function getElementLabel(element: Element, props: Record<string, unknown>): string {
  const propAria = toPrimitiveHint(props['aria-label']);
  if (typeof propAria === 'string' && propAria) {
    return propAria;
  }

  const ariaLabel = textContent(element.getAttribute('aria-label'));
  if (ariaLabel) {
    return ariaLabel;
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) {
    if (element.id) {
      const label = findFirstNonSdkElement<HTMLLabelElement>(document, `label[for="${escapeCss(element.id)}"]`);
      const labelText = textContent(label?.textContent);
      if (labelText) {
        return labelText;
      }
    }

    const placeholderFromProps = toPrimitiveHint(props.placeholder) as string | undefined;
    const placeholderFromElement =
      element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.placeholder : '';
    const placeholder = textContent(placeholderFromProps || placeholderFromElement);
    if (placeholder) {
      return placeholder;
    }

    const name = textContent((toPrimitiveHint(props.name) as string | undefined) || element.name);
    if (name) {
      return name;
    }
  }

  return textContent(element.textContent) || textContent(element.getAttribute('name')) || element.tagName.toLowerCase();
}

function extractValue(element: Element, props: Record<string, unknown>): string {
  const controlled = toPrimitiveHint(props.value);
  if (controlled !== undefined && controlled !== null) {
    return String(controlled);
  }

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element.value || '';
  }

  if (element instanceof HTMLSelectElement) {
    const option = element.selectedOptions[0];
    return option?.textContent || element.value || '';
  }

  return '';
}

function isInteractive(domNode: HTMLElement, handlers: string[], props: Record<string, unknown>): boolean {
  const tag = domNode.tagName.toLowerCase();
  if (INTERACTIVE_TAGS.has(tag)) {
    return true;
  }

  const role = textContent(domNode.getAttribute('role') || (toPrimitiveHint(props.role) as string | undefined) || '');
  if (role && INTERACTIVE_ROLES.has(role)) {
    return true;
  }

  if (handlers.length) {
    return true;
  }

  return domNode.tabIndex >= 0;
}

function boolFromUnknown(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

function toDescriptor(domNode: HTMLElement, fiber: FiberNode, id: string): DOMElementDescriptor {
  const props = isRecord(fiber.memoizedProps) ? fiber.memoizedProps : {};
  const handlers = extractHandlers(props);
  const rect = domNode.getBoundingClientRect();

  const propDisabled = boolFromUnknown(props.disabled);
  const domDisabled =
    domNode instanceof HTMLButtonElement ||
    domNode instanceof HTMLInputElement ||
    domNode instanceof HTMLTextAreaElement ||
    domNode instanceof HTMLSelectElement
      ? domNode.disabled
      : domNode.getAttribute('aria-disabled') === 'true';

  return {
    id,
    fillable: isFillableNode(domNode, props),
    componentName: inferComponentName(fiber),
    selector: uniqueSelector(domNode),
    label: getElementLabel(domNode, props),
    text: textContent(domNode.textContent),
    handlers,
    props: pickProps(props),
    state: extractStateValues(fiber),
    visible: true,
    role: domNode.getAttribute('role') || (toPrimitiveHint(props.role) as string | undefined) || domNode.tagName.toLowerCase(),
    tagName: domNode.tagName.toLowerCase(),
    type: (toPrimitiveHint(props.type) as string | undefined) || (domNode as HTMLInputElement).type,
    href:
      (toPrimitiveHint(props.href) as string | undefined) ||
      (domNode instanceof HTMLAnchorElement ? domNode.getAttribute('href') || undefined : undefined),
    ariaLabel:
      (toPrimitiveHint(props['aria-label']) as string | undefined) || domNode.getAttribute('aria-label') || undefined,
    ariaDescription: domNode.getAttribute('aria-description') || domNode.getAttribute('aria-describedby') || undefined,
    placeholder:
      (toPrimitiveHint(props.placeholder) as string | undefined) ||
      (domNode instanceof HTMLInputElement || domNode instanceof HTMLTextAreaElement
        ? domNode.placeholder || undefined
        : undefined),
    value: extractValue(domNode, props),
    disabled: propDisabled ?? domDisabled,
    dataState: domNode.getAttribute('data-state'),
    dataStatus: domNode.getAttribute('data-status'),
    ariaExpanded: domNode.getAttribute('aria-expanded'),
    ariaSelected: domNode.getAttribute('aria-selected'),
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height
    }
  };
}

function readComponentNameFromRoute(route: Record<string, unknown>): string {
  const component = readTypeName(route.Component);
  if (component) {
    return component;
  }

  if (isRecord(route.element)) {
    const fromElement = readTypeName(route.element.type);
    if (fromElement) {
      return fromElement;
    }
  }

  const lazy = route.lazy;
  if (typeof lazy === 'function') {
    const lazyFn = lazy as Function & { name?: string };
    if (lazyFn.name) {
      return lazyFn.name;
    }
  }

  if (typeof route.id === 'string' && route.id) {
    return route.id;
  }

  return 'UnknownRoute';
}

function registerRouteDefinition(
  routeDefinitions: Map<string, RouteDefinition>,
  routePath: string,
  componentName: string
): void {
  const normalizedPath = normalizePath(routePath);
  const existing = routeDefinitions.get(normalizedPath);
  if (!existing) {
    routeDefinitions.set(normalizedPath, {
      path: normalizedPath,
      navigatePath: toNavigablePath(normalizedPath),
      componentName: componentName || 'UnknownRoute'
    });
    return;
  }

  if (existing.componentName === 'UnknownRoute' && componentName && componentName !== 'UnknownRoute') {
    existing.componentName = componentName;
  }
}

function collectRouteList(
  routeList: unknown[],
  parentPath: string,
  routeDefinitions: Map<string, RouteDefinition>,
  visited: WeakSet<object>,
  depth: number
): void {
  if (depth > 8) {
    return;
  }

  for (const routeEntry of routeList) {
    if (!isRecord(routeEntry)) {
      continue;
    }

    const rawPath = typeof routeEntry.path === 'string' ? routeEntry.path.trim() : '';
    const isIndexRoute = routeEntry.index === true;
    const resolvedPath = rawPath
      ? joinPaths(parentPath, rawPath)
      : isIndexRoute
        ? normalizePath(parentPath || '/')
        : null;

    if (resolvedPath) {
      registerRouteDefinition(routeDefinitions, resolvedPath, readComponentNameFromRoute(routeEntry));
    }

    const nextParent = resolvedPath || parentPath;
    const children = routeEntry.children;
    if (Array.isArray(children)) {
      collectRouteList(children, nextParent, routeDefinitions, visited, depth + 1);
    }

    collectRouterDetails(routeEntry, routeDefinitions, { value: '' }, { current: null }, visited, depth + 1);
  }
}

function extractNavigateCandidate(value: Record<string, unknown>): NavigateFn | null {
  const hasRouterSignals =
    (isRecord(value.location) && typeof value.location.pathname === 'string') ||
    Array.isArray(value.matches) ||
    Array.isArray(value.routes);

  const directNavigate = value.navigate;
  if (hasRouterSignals && typeof directNavigate === 'function') {
    return (path: string) => directNavigate.call(value, path);
  }

  const router = isRecord(value.router) ? value.router : null;
  if (router) {
    const routerNavigate = router.navigate;
    if (typeof routerNavigate === 'function') {
      return (path: string) => routerNavigate.call(router, path);
    }
  }

  const navigator = isRecord(value.navigator) ? value.navigator : null;
  if (navigator) {
    const navigatorPush = navigator.push;
    if (typeof navigatorPush === 'function') {
      return (path: string) => navigatorPush.call(navigator, path);
    }
    const navigatorNavigate = navigator.navigate;
    if (typeof navigatorNavigate === 'function') {
      return (path: string) => navigatorNavigate.call(navigator, path);
    }
  }

  const history = isRecord(value.history) ? value.history : null;
  if (history) {
    const historyPush = history.push;
    if (typeof historyPush === 'function') {
      return (path: string) => historyPush.call(history, path);
    }
  }

  return null;
}

function collectRouterDetails(
  value: unknown,
  routeDefinitions: Map<string, RouteDefinition>,
  currentRoute: { value: string },
  navigateRef: { current: NavigateFn | null },
  visited: WeakSet<object>,
  depth = 0
): void {
  if (depth > 8) {
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value.slice(0, 200)) {
      collectRouterDetails(entry, routeDefinitions, currentRoute, navigateRef, visited, depth + 1);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (visited.has(value)) {
    return;
  }
  visited.add(value);

  const maybeNavigate = extractNavigateCandidate(value);
  if (maybeNavigate && !navigateRef.current) {
    navigateRef.current = maybeNavigate;
  }

  const maybePath = [value.path, value.to, value.href];
  for (const entry of maybePath) {
    if (typeof entry === 'string' && entry.startsWith('/')) {
      registerRouteDefinition(routeDefinitions, entry, readComponentNameFromRoute(value));
    }
  }

  if (isRecord(value.location) && typeof value.location.pathname === 'string') {
    currentRoute.value = normalizePath(value.location.pathname);
    registerRouteDefinition(routeDefinitions, currentRoute.value, 'UnknownRoute');
  }

  if (typeof value.pathname === 'string' && value.pathname.startsWith('/')) {
    currentRoute.value = normalizePath(value.pathname);
    registerRouteDefinition(routeDefinitions, currentRoute.value, 'UnknownRoute');
  }

  if (Array.isArray(value.matches)) {
    for (const match of value.matches) {
      if (!isRecord(match)) {
        continue;
      }
      const route = isRecord(match.route) ? match.route : null;
      if (route && typeof route.path === 'string') {
        registerRouteDefinition(routeDefinitions, route.path, readComponentNameFromRoute(route));
      }
      if (isRecord(match.pathname) && typeof match.pathname.pathname === 'string') {
        currentRoute.value = normalizePath(match.pathname.pathname);
      }
      if (typeof match.pathname === 'string' && match.pathname.startsWith('/')) {
        currentRoute.value = normalizePath(match.pathname);
      }
    }
  }

  if (Array.isArray(value.routes)) {
    collectRouteList(value.routes, '/', routeDefinitions, visited, depth + 1);
  }

  if (Array.isArray(value.children) && value.children.some((entry) => isRecord(entry) && ('path' in entry || 'index' in entry))) {
    collectRouteList(value.children, '/', routeDefinitions, visited, depth + 1);
  }

  for (const nested of Object.values(value)) {
    if (isRecord(nested) || Array.isArray(nested)) {
      collectRouterDetails(nested, routeDefinitions, currentRoute, navigateRef, visited, depth + 1);
    }
  }
}

function discoverRouterSnapshot(): RouterSnapshot {
  const roots = discoverFiberRoots();
  const routeDefinitions = new Map<string, RouteDefinition>();
  const currentRoute = { value: normalizePath(window.location.pathname) };
  const navigateRef: { current: NavigateFn | null } = { current: null };
  const visited = new WeakSet<object>();

  for (const root of roots) {
    walkFiber(root, (fiber) => {
      if (isRecord(fiber.memoizedProps)) {
        collectRouterDetails(fiber.memoizedProps, routeDefinitions, currentRoute, navigateRef, visited);
      }

      if (isRecord(fiber.memoizedState)) {
        collectRouterDetails(fiber.memoizedState, routeDefinitions, currentRoute, navigateRef, visited);
      }
    });
  }

  if (!routeDefinitions.size) {
    registerRouteDefinition(routeDefinitions, currentRoute.value, 'UnknownRoute');
  }

  if (!routeDefinitions.has(currentRoute.value)) {
    registerRouteDefinition(routeDefinitions, currentRoute.value, 'UnknownRoute');
  }

  return {
    currentRoute: currentRoute.value,
    routes: Array.from(routeDefinitions.values()).sort((a, b) => a.path.localeCompare(b.path)),
    navigate: navigateRef.current
  };
}

function hasVisibleInteractiveUiForDiscovery(): boolean {
  const selector = [
    'button',
    'a[href]',
    'input',
    'select',
    'textarea',
    '[role="button"]',
    '[role="link"]',
    '[role="tab"]',
    '[role="textbox"]',
    '[contenteditable="true"]',
    '[contenteditable=""]'
  ].join(',');
  const candidates = queryNonSdkElements<HTMLElement>(document, selector).slice(0, 400);

  for (const candidate of candidates) {
    const style = window.getComputedStyle(candidate);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) {
      continue;
    }
    return true;
  }

  return false;
}

function hasStrongRouterDiscoverySignals(snapshot: RouterSnapshot): boolean {
  if (snapshot.navigate) {
    return true;
  }

  if ((snapshot.routes || []).length > 1) {
    return true;
  }

  return (snapshot.routes || []).some((route) => textContent(route?.componentName || '') !== 'UnknownRoute');
}

function routerSnapshotSignature(snapshot: RouterSnapshot): string {
  const routeKey = (snapshot.routes || [])
    .map((route) => `${normalizePath(route.path)}::${textContent(route.componentName || 'UnknownRoute')}`)
    .join('|');
  return `${normalizePath(snapshot.currentRoute || '/')}||${routeKey}||nav:${snapshot.navigate ? '1' : '0'}`;
}

function hashScopeSignature(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function buildAppCacheScope(snapshot: RouterSnapshot): AppCacheScope {
  const origin = window.location.origin || 'unknown-origin';
  const normalizedCurrentRoute = normalizePath(snapshot.currentRoute || window.location.pathname || '/');
  const hasStrongRouterSignals = hasStrongRouterDiscoverySignals(snapshot);
  const routeKey = (snapshot.routes || [])
    .map((route) => `${normalizePath(route.path || route.navigatePath || normalizedCurrentRoute)}::${textContent(route.componentName || 'UnknownRoute')}`)
    .sort()
    .join('|');
  const signature = hasStrongRouterSignals && routeKey
    ? `${origin}||routes:${routeKey}||nav:${snapshot.navigate ? '1' : '0'}`
    : `${origin}||route:${normalizedCurrentRoute}`;

  return {
    key: `scope-${hashScopeSignature(signature)}`,
    signature,
    origin,
    currentRoute: normalizedCurrentRoute,
    strategy: hasStrongRouterSignals && routeKey ? 'router' : 'route_fallback'
  };
}

export function buildRouteFallbackAppCacheScopeForPath(
  currentRoute: string,
  origin = window.location.origin || 'unknown-origin'
): AppCacheScope {
  const normalizedCurrentRoute = normalizePath(currentRoute || window.location.pathname || '/');
  const signature = `${origin}||route:${normalizedCurrentRoute}`;
  return {
    key: `scope-${hashScopeSignature(signature)}`,
    signature,
    origin,
    currentRoute: normalizedCurrentRoute,
    strategy: 'route_fallback'
  };
}

function doesRouteMatchRecoveryScope(candidateRoute: string, currentRoute: string): boolean {
  const normalizedCandidateRoute = normalizePath(candidateRoute || '/');
  const normalizedCurrentRoute = normalizePath(currentRoute || '/');
  return (
    normalizedCurrentRoute === normalizedCandidateRoute ||
    normalizedCurrentRoute.startsWith(`${normalizedCandidateRoute}/`)
  );
}

function extractScopeKeyFromStorageKey(baseKey: string, storageKey: string): string | null {
  const prefix = `${baseKey}::`;
  if (!storageKey.startsWith(prefix)) {
    return null;
  }

  return storageKey.slice(prefix.length) || null;
}

function buildScopedStorageKeyFromScopeKey(baseKey: string, scopeKey: string): string {
  return `${baseKey}::${scopeKey}`;
}

function readLocalStorageEntry(keys: string[]): { key: string; raw: string } | null {
  if (typeof window === 'undefined') {
    return null;
  }

  for (const key of keys) {
    const raw = window.localStorage.getItem(key);
    if (raw) {
      return { key, raw };
    }
  }

  return null;
}

export function getRelatedAppCacheScopes(scope: AppCacheScope = resolveCurrentAppCacheScope()): AppCacheScope[] {
  if (scope.strategy !== 'router') {
    return [scope];
  }

  const fallbackScope = buildRouteFallbackAppCacheScopeForPath(scope.currentRoute, scope.origin);
  return [scope, fallbackScope].filter(
    (candidate, index, values) => values.findIndex((entry) => entry.key === candidate.key) === index
  );
}

export function resolveCurrentAppCacheScope(): AppCacheScope {
  if (typeof window === 'undefined') {
    return {
      key: 'scope-server',
      signature: 'server',
      origin: 'server',
      currentRoute: '/',
      strategy: 'route_fallback'
    };
  }
  return buildAppCacheScope(discoverRouterSnapshot());
}

export function buildScopedStorageKey(baseKey: string, scope: AppCacheScope = resolveCurrentAppCacheScope()): string {
  return `${baseKey}::${scope.key}`;
}

export function getScopedAppMapStorageKeys(scope: AppCacheScope = resolveCurrentAppCacheScope()): ScopedAppMapStorageKeys {
  return {
    appMap: buildScopedStorageKey(APP_MAP_STORAGE_KEY, scope),
    schemaVersion: buildScopedStorageKey(APP_MAP_SCHEMA_VERSION_STORAGE_KEY, scope),
    metadata: buildScopedStorageKey(APP_MAP_CACHE_METADATA_STORAGE_KEY, scope)
  };
}

async function waitForDiscoveryBootstrapSnapshot(): Promise<{
  snapshot: RouterSnapshot;
  outcome: 'ready' | 'timeout';
  checks: number;
}> {
  const startedAt = Date.now();
  let checks = 0;
  let stableTicks = 0;
  let previousSignature = '';
  let lastSnapshot = discoverRouterSnapshot();

  while (Date.now() - startedAt <= DISCOVERY_BOOTSTRAP_TIMEOUT_MS) {
    checks += 1;
    const snapshot = discoverRouterSnapshot();
    lastSnapshot = snapshot;

    const signature = routerSnapshotSignature(snapshot);
    stableTicks = signature === previousSignature ? stableTicks + 1 : 1;
    previousSignature = signature;

    const domReady = document.readyState !== 'loading';
    const hasVisibleInteractiveUi = hasVisibleInteractiveUiForDiscovery();
    const hasStrongRouterSignals = hasStrongRouterDiscoverySignals(snapshot);
    const hasStableSnapshot = stableTicks >= DISCOVERY_BOOTSTRAP_STABLE_TICKS;

    const canStartFromRouterSignals = hasStrongRouterSignals;
    const canStartFromUiSignals = hasVisibleInteractiveUi && hasStableSnapshot;
    if (domReady && (canStartFromRouterSignals || canStartFromUiSignals)) {
      return { snapshot, outcome: 'ready', checks };
    }

    await sleep(DISCOVERY_BOOTSTRAP_POLL_MS);
  }

  return {
    snapshot: lastSnapshot,
    outcome: 'timeout',
    checks
  };
}

function applyRouterSignals(
  value: Record<string, unknown>,
  routes: Set<string>,
  routeParams: Record<string, string>,
  currentRoute: { value: string }
): void {
  const maybePath = [value.path, value.to, value.href];
  for (const entry of maybePath) {
    if (typeof entry === 'string' && entry.startsWith('/')) {
      routes.add(normalizePath(entry));
    }
  }

  if (isRecord(value.location) && typeof value.location.pathname === 'string') {
    currentRoute.value = normalizePath(value.location.pathname);
    routes.add(currentRoute.value);
  }

  if (isRecord(value.params)) {
    for (const [key, entry] of Object.entries(value.params)) {
      if (entry != null) {
        routeParams[key] = String(entry);
      }
    }
  }

  const matches = value.matches;
  if (Array.isArray(matches)) {
    for (const match of matches) {
      if (!isRecord(match)) {
        continue;
      }

      if (isRecord(match.route) && typeof match.route.path === 'string') {
        routes.add(normalizePath(match.route.path));
      }

      if (isRecord(match.params)) {
        for (const [key, entry] of Object.entries(match.params)) {
          if (entry != null) {
            routeParams[key] = String(entry);
          }
        }
      }
    }
  }

  const routeList = value.routes;
  if (Array.isArray(routeList)) {
    for (const route of routeList) {
      if (isRecord(route) && typeof route.path === 'string') {
        routes.add(normalizePath(route.path));
      }
    }
  }
}

function scanFromFiber(): {
  elements: DOMElementDescriptor[];
  routes: string[];
  currentRoute: string;
  routeParams: Record<string, string>;
} {
  const roots = discoverFiberRoots();

  if (!roots.length) {
    return {
      elements: [],
      routes: [normalizePath(window.location.pathname)],
      currentRoute: normalizePath(window.location.pathname),
      routeParams: {}
    };
  }

  const elements: DOMElementDescriptor[] = [];
  const seenSelectors = new Set<string>();
  const routes = new Set<string>([normalizePath(window.location.pathname)]);
  const routeParams: Record<string, string> = {};
  const currentRoute = { value: normalizePath(window.location.pathname) };
  let elementCounter = 0;

  for (const root of roots) {
    walkFiber(root, (fiber) => {
      const stateElement = fiberStateElement(fiber.stateNode);
      if (stateElement && isSdkUiElement(stateElement)) {
        return false;
      }

      if (isRecord(fiber.memoizedProps)) {
        applyRouterSignals(fiber.memoizedProps, routes, routeParams, currentRoute);
      }

      if (isRecord(fiber.memoizedState)) {
        applyRouterSignals(fiber.memoizedState, routes, routeParams, currentRoute);
      }

      const domNode = fiber.stateNode instanceof HTMLElement ? fiber.stateNode : null;
      if (!domNode) {
        return;
      }

      if (!isVisible(domNode)) {
        return;
      }

      const props = isRecord(fiber.memoizedProps) ? fiber.memoizedProps : {};
      const handlers = extractHandlers(props);

      if (!isInteractive(domNode, handlers, props)) {
        return;
      }

      const selector = uniqueSelector(domNode);
      if (seenSelectors.has(selector)) {
        return;
      }

      seenSelectors.add(selector);
      elementCounter += 1;
      elements.push(toDescriptor(domNode, fiber, `e${elementCounter}`));
    });
  }

  return {
    elements,
    routes: Array.from(routes),
    currentRoute: currentRoute.value,
    routeParams
  };
}

function scanFallbackElements(): DOMElementDescriptor[] {
  const selector = [
    'button',
    'input',
    'textarea',
    'select',
    'a[href]',
    'form',
    '[role="button"]',
    '[role="link"]',
    '[role="textbox"]',
    '[role="combobox"]'
  ].join(',');

  let elementCounter = 0;

  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter((element) => !isSdkUiElement(element) && isVisible(element))
    .map((element) => {
      elementCounter += 1;
      const rect = element.getBoundingClientRect();

      return {
        id: `e${elementCounter}`,
        fillable: isFillableNode(element, {}),
        componentName: null,
        selector: uniqueSelector(element),
        label: getElementLabel(element, {}),
        text: textContent(element.textContent),
        handlers: [],
        props: {},
        state: [],
        visible: true,
        role: element.getAttribute('role') || element.tagName.toLowerCase(),
        tagName: element.tagName.toLowerCase(),
        type: (element as HTMLInputElement).type,
        href: element instanceof HTMLAnchorElement ? element.getAttribute('href') || undefined : undefined,
        ariaLabel: element.getAttribute('aria-label') || undefined,
        ariaDescription: element.getAttribute('aria-description') || element.getAttribute('aria-describedby') || undefined,
        placeholder:
          element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
            ? element.placeholder || undefined
            : undefined,
        value: extractValue(element, {}),
        disabled:
          element instanceof HTMLButtonElement ||
          element instanceof HTMLInputElement ||
          element instanceof HTMLTextAreaElement ||
          element instanceof HTMLSelectElement
            ? element.disabled
            : element.getAttribute('aria-disabled') === 'true',
        dataState: element.getAttribute('data-state'),
        dataStatus: element.getAttribute('data-status'),
        ariaExpanded: element.getAttribute('aria-expanded'),
        ariaSelected: element.getAttribute('aria-selected'),
        rect: {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height
        }
      };
    });
}

function discoverRoutesFromDom(): string[] {
  const links = queryNonSdkElements<HTMLAnchorElement>(document, 'a[href]');
  const routes = new Set<string>();

  for (const link of links) {
    const href = link.getAttribute('href')?.trim();
    if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('#')) {
      continue;
    }

    if (href.startsWith('/')) {
      routes.add(href);
    }
  }

  routes.add(window.location.pathname);
  return Array.from(routes);
}

function scanNavigation(): Array<{ label: string; href: string; selector: string }> {
  return queryVisibleNonSdkElements<HTMLAnchorElement>(document, 'nav a[href], [role="navigation"] a[href], a[href]')
    .map((link) => ({
      label: textContent(link.textContent) || textContent(link.getAttribute('aria-label')) || link.getAttribute('href') || '',
      href: link.getAttribute('href') || '',
      selector: uniqueSelector(link)
    }))
    .filter((entry) => Boolean(entry.href));
}

function scanFormState(elements: DOMElementDescriptor[]): DOMCapabilityMap['formState'] {
  return elements
    .filter((element) => element.tagName === 'input' || element.tagName === 'textarea' || element.tagName === 'select')
    .map((element) => ({
      selector: element.selector,
      name: (typeof element.props?.name === 'string' ? element.props?.name : undefined) || element.label || element.tagName,
      label: element.label,
      type: element.type || element.tagName,
      value: element.value || '',
      disabled: Boolean(element.disabled)
    }));
}

function scanButtonsState(elements: DOMElementDescriptor[]): DOMCapabilityMap['buttonsState'] {
  return elements
    .filter((element) => element.tagName === 'button' || element.role === 'button')
    .map((element) => ({
      selector: element.selector,
      label: element.label,
      disabled: Boolean(element.disabled),
      loading:
        element.props?.['aria-busy'] === true ||
        element.props?.['data-loading'] === true ||
        element.text.toLowerCase().includes('loading')
    }));
}

function scanVisibleErrors(): string[] {
  return queryVisibleNonSdkElements<HTMLElement>(document, '[role="alert"], [aria-invalid="true"], .error, .text-danger, .invalid-feedback')
    .filter((node) => textContent(node.textContent))
    .map((node) => textContent(node.textContent));
}

function scanDialogs(): DOMCapabilityMap['dialogs'] {
  return queryVisibleNonSdkElements<HTMLElement>(document, 'dialog, [role="dialog"], [aria-modal="true"]')
    .map((dialog) => ({
      selector: uniqueSelector(dialog),
      label: textContent(dialog.getAttribute('aria-label')) || textContent(dialog.textContent).slice(0, 120),
      isOpen:
        dialog instanceof HTMLDialogElement
          ? dialog.open
          : dialog.getAttribute('aria-hidden') !== 'true' && !dialog.hasAttribute('hidden')
    }));
}

function scanTableRows(): DOMCapabilityMap['tableRows'] {
  return queryVisibleNonSdkElements<HTMLTableRowElement>(document, 'table tbody tr, table tr')
    .map((row) => {
      const table = row.closest('table');
      const context = textContent(findFirstNonSdkElement<HTMLElement>(table || row, 'caption')?.textContent) || uniqueSelector(table || row);
      const columns = queryNonSdkElements<HTMLElement>(row, 'th, td').map((cell) => textContent(cell.textContent));
      return { context, columns };
    })
    .filter((entry) => entry.columns.length > 0);
}

function scanListItems(): DOMCapabilityMap['listItems'] {
  return queryVisibleNonSdkElements<HTMLLIElement>(document, 'ul li, ol li')
    .map((item) => ({
      context: uniqueSelector(item.closest('ul, ol') || item),
      text: textContent(item.textContent)
    }))
    .filter((entry) => Boolean(entry.text));
}

function scanCards(): DOMCapabilityMap['cards'] {
  return queryVisibleNonSdkElements<HTMLElement>(document, '[class*="card" i], [data-card], article, [role="region"]')
    .map((card) => ({
      title:
        textContent(findFirstNonSdkElement<HTMLElement>(card, 'h1, h2, h3, h4')?.textContent) ||
        textContent(card.getAttribute('aria-label')) ||
        card.tagName.toLowerCase(),
      text: textContent(card.textContent).slice(0, 280)
    }))
    .filter((entry) => Boolean(entry.text));
}

function scanStatusBadges(): DOMCapabilityMap['statusBadges'] {
  return queryVisibleNonSdkElements<HTMLElement>(document, '[class*="badge" i], [data-status], [role="status"]')
    .map((badge) => ({
      text: textContent(badge.textContent),
      selector: uniqueSelector(badge)
    }))
    .filter((entry) => Boolean(entry.text));
}

function scanStateHints(): DOMCapabilityMap['stateHints'] {
  return queryVisibleNonSdkElements<HTMLElement>(document, '[data-state], [data-status], [aria-expanded], [aria-selected]')
    .map((element) => ({
      selector: uniqueSelector(element),
      dataState: element.getAttribute('data-state'),
      dataStatus: element.getAttribute('data-status'),
      ariaExpanded: element.getAttribute('aria-expanded'),
      ariaSelected: element.getAttribute('aria-selected')
    }));
}

function scanActiveItems(): string[] {
  return queryVisibleNonSdkElements<HTMLElement>(document, '[aria-current="page"], [aria-selected="true"], [data-active="true"], .active')
    .map((element) => uniqueSelector(element));
}

function scanCountBadges(): DOMCapabilityMap['countBadges'] {
  return queryVisibleNonSdkElements<HTMLElement>(document, '[class*="badge" i], [data-count], [aria-label*="open" i], [aria-label*="count" i]')
    .map((badge) => {
      const text = textContent(badge.textContent) || textContent(badge.getAttribute('aria-label'));
      const numberMatch = text.match(/\d+/);
      return {
        text,
        count: numberMatch ? Number(numberMatch[0]) : null,
        selector: uniqueSelector(badge)
      };
    })
    .filter((entry) => Boolean(entry.text));
}

/** Scans React Fiber runtime first, with DOM fallback only when Fiber is unavailable. */
export function scanDOM(): DOMCapabilityMap {
  const fiberScan = scanFromFiber();
  const elements = fiberScan.elements.length ? fiberScan.elements : scanFallbackElements();

  const routes = new Set<string>(fiberScan.routes);
  for (const route of discoverRoutesFromDom()) {
    routes.add(route);
  }

  const headings = queryVisibleNonSdkElements<HTMLHeadingElement>(document, 'h1, h2, h3')
    .filter((heading) => textContent(heading.textContent))
    .map((heading) => ({
      level: heading.tagName.toLowerCase() as 'h1' | 'h2' | 'h3',
      text: textContent(heading.textContent)
    }));

  return createCapabilityMap({
    elements,
    routes: Array.from(routes),
    currentRoute: fiberScan.currentRoute || window.location.pathname,
    currentUrl: window.location.href,
    routeParams: fiberScan.routeParams,
    pageTitle: document.title,
    headings,
    navigation: scanNavigation(),
    formState: scanFormState(elements),
    buttonsState: scanButtonsState(elements),
    visibleErrors: scanVisibleErrors(),
    dialogs: scanDialogs(),
    tableRows: scanTableRows(),
    listItems: scanListItems(),
    cards: scanCards(),
    statusBadges: scanStatusBadges(),
    stateHints: scanStateHints(),
    activeItems: scanActiveItems(),
    countBadges: scanCountBadges()
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function normalizeHrefToPath(href: string | null): string | null {
  const value = textContent(href);
  if (!value || value.startsWith('#') || value.startsWith('mailto:') || value.startsWith('tel:')) {
    return null;
  }

  if (value.startsWith('/')) {
    return normalizePath(value);
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    try {
      const parsed = new URL(value, window.location.origin);
      if (parsed.origin !== window.location.origin) {
        return null;
      }
      return normalizePath(parsed.pathname);
    } catch {
      return null;
    }
  }

  return normalizePath(value);
}

function uniqueStrings(values: string[], maxItems = 12): string[] {
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const normalized = textContent(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= maxItems) {
      break;
    }
  }

  return output;
}

function toSafeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  return fallback;
}

function toSafeStringArray(value: unknown, maxItems = 24): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return uniqueStrings(
    value
      .filter((entry) => entry != null)
      .map((entry) => toSafeString(entry))
      .filter(Boolean),
    maxItems
  );
}

function sanitizeRouteMapEntry(value: unknown): RouteMap | null {
  if (!isRecord(value)) {
    return null;
  }

  const path = normalizePath(toSafeString(value.path, '/'));
  const componentName = toSafeString(value.componentName, 'UnknownRoute') || 'UnknownRoute';
  const title = toSafeString(value.title, path) || path;

  const navigationLinks = Array.isArray(value.navigationLinks)
    ? value.navigationLinks
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          label: toSafeString(entry?.label, '') || toSafeString(entry?.path, path),
          path: normalizePath(toSafeString(entry?.path, '/')),
          ...(toSafeString(entry?.elementId)
            ? {
                elementId: toSafeString(entry?.elementId),
                selectorCandidates: toSafeStringArray(entry?.selectorCandidates, 8)
              }
            : {})
        }))
        .filter((entry) => Boolean(entry?.path))
    : [];

  const modalTriggers = Array.isArray(value.modalTriggers)
    ? value.modalTriggers
        .filter((entry) => isRecord(entry))
        .map((entry) => {
          const modalContents = isRecord(entry.modalContents) ? entry.modalContents : {};
          const formFields = Array.isArray(modalContents.formFields)
            ? modalContents.formFields
                .filter((field) => isRecord(field))
                .map((field) => ({
                  label: toSafeString(field?.label, 'field') || 'field',
                  type: toSafeString(field?.type, 'text') || 'text',
                  required: Boolean(field?.required),
                  ...(toSafeString(field?.elementId)
                    ? {
                        elementId: toSafeString(field?.elementId),
                        selectorCandidates: toSafeStringArray(field?.selectorCandidates, 8)
                      }
                    : {}),
                  ...(Array.isArray(field?.options) ? { options: toSafeStringArray(field.options, 16) } : {})
                }))
            : [];
          const buttons = Array.isArray(modalContents.buttons)
            ? modalContents.buttons
                .filter((button) => isRecord(button))
                .map((button) => ({
                  label: toSafeString(button?.label, 'button') || 'button',
                  ...(toSafeString(button?.elementId)
                    ? {
                        elementId: toSafeString(button?.elementId),
                        selectorCandidates: toSafeStringArray(button?.selectorCandidates, 8)
                      }
                    : {})
                }))
            : [];

          return {
            elementId: toSafeString(entry?.elementId, ''),
            label: toSafeString(entry?.label, 'open dialog'),
            selectorCandidates: toSafeStringArray(entry?.selectorCandidates, 8),
            modalContents: {
              formFields,
              buttons
            }
          };
        })
        .filter((entry) => Boolean(entry?.elementId))
    : [];

  const formFields = Array.isArray(value.formFields)
    ? value.formFields
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          elementId: toSafeString(entry?.elementId, ''),
          label: toSafeString(entry?.label, ''),
          type: toSafeString(entry?.type, 'text') || 'text',
          required: Boolean(entry?.required),
          selectorCandidates: toSafeStringArray(entry?.selectorCandidates, 8),
          ...(Array.isArray(entry?.options) ? { options: toSafeStringArray(entry.options, 16) } : {})
        }))
        .filter((entry) => Boolean(entry?.elementId))
    : [];

  const buttons = Array.isArray(value.buttons)
    ? value.buttons
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          elementId: toSafeString(entry?.elementId, ''),
          label: toSafeString(entry?.label, 'button'),
          selectorCandidates: toSafeStringArray(entry?.selectorCandidates, 8)
        }))
        .filter((entry) => Boolean(entry?.elementId))
    : [];

  const filters = Array.isArray(value.filters)
    ? value.filters
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          elementId: toSafeString(entry?.elementId, ''),
          label: toSafeString(entry?.label, 'filter'),
          options: toSafeStringArray(entry?.options, 16),
          selectorCandidates: toSafeStringArray(entry?.selectorCandidates, 8)
        }))
        .filter((entry) => Boolean(entry?.elementId))
    : [];

  const tabs = Array.isArray(value.tabs)
    ? value.tabs
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          elementId: toSafeString(entry?.elementId, ''),
          label: toSafeString(entry?.label, 'tab'),
          selectorCandidates: toSafeStringArray(entry?.selectorCandidates, 8)
        }))
        .filter((entry) => Boolean(entry.elementId))
    : [];
  const locators = Array.isArray(value.locators)
    ? value.locators
        .filter((entry) => isRecord(entry))
        .map((entry) => ({
          id: toSafeString(entry?.id, ''),
          kind: toSafeString(entry?.kind, 'button') as AppMapLocatorRef['kind'],
          label: toSafeString(entry?.label, ''),
          labelKey: toSafeString(entry?.labelKey, ''),
          selectorCandidates: toSafeStringArray(entry?.selectorCandidates, 12),
          ...(toSafeString(entry?.path) ? { path: normalizePath(toSafeString(entry?.path)) } : {}),
          ...(typeof entry?.clickable === 'boolean' ? { clickable: entry.clickable } : {}),
          ...(typeof entry?.fillable === 'boolean' ? { fillable: entry.fillable } : {}),
          ...(toSafeString(entry?.tagName) ? { tagName: toSafeString(entry?.tagName) } : {}),
          ...(toSafeString(entry?.role) ? { role: toSafeString(entry?.role) } : {})
        }))
        .filter((entry) => Boolean(entry.id) && Boolean(entry.labelKey) && entry.selectorCandidates.length > 0)
    : [];
  const headings = toSafeStringArray(value.headings, 16);

  return {
    path,
    componentName,
    title,
    navigationLinks,
    modalTriggers,
    formFields,
    buttons,
    filters,
    tabs,
    ...(locators.length ? { locators } : {}),
    headings
  };
}

function readSelectOptions(select: HTMLSelectElement): string[] {
  return uniqueStrings(
    Array.from(select.options)
      .map((option) => textContent(option.textContent || option.label))
      .filter(Boolean),
    16
  );
}

function readInputOptions(input: HTMLInputElement): string[] {
  if (input.type === 'radio' && input.name) {
    const radioOptions = queryNonSdkElements<HTMLInputElement>(document, `input[type="radio"][name="${escapeCss(input.name)}"]`)
      .map((candidate) => {
        if (candidate.id) {
          const labelNode = findFirstNonSdkElement<HTMLLabelElement>(document, `label[for="${escapeCss(candidate.id)}"]`);
          return textContent(labelNode?.textContent) || textContent(candidate.value);
        }
        return textContent(candidate.value);
      });
    return uniqueStrings(radioOptions, 16);
  }

  if (input.list?.options?.length) {
    return uniqueStrings(
      Array.from(input.list.options).map((option) => textContent(option.value || option.textContent)),
      16
    );
  }

  return [];
}

function readGenericOptions(element: HTMLElement): string[] {
  if (element instanceof HTMLSelectElement) {
    return readSelectOptions(element);
  }

  if (element instanceof HTMLInputElement) {
    if (element.type === 'checkbox') {
      return ['on', 'off'];
    }
    return readInputOptions(element);
  }

  if (element.getAttribute('role') === 'switch' || element.hasAttribute('aria-pressed')) {
    return ['on', 'off'];
  }

  const controls = element.getAttribute('aria-controls');
  if (controls) {
    const target = document.getElementById(controls);
    if (target && !isSdkUiElement(target)) {
      return uniqueStrings(
        queryNonSdkElements<HTMLElement>(target, '[role="option"], option, li, button').map((option) => textContent(option.textContent)),
        16
      );
    }
  }

  return [];
}

function scanNavigationLinksForRoute(): RouteMap['navigationLinks'] {
  const selector = [
    'a[href]',
    '[role="link"]',
    '[data-href]',
    '[data-to]',
    '[data-path]',
    '[data-route]',
    '[to]',
    '[href]',
    'button[onclick]',
    '[role="button"][onclick]',
    '[onclick]'
  ].join(',');

  const links = queryVisibleNonSdkElements<HTMLElement>(document, selector)
    .map((link) => {
      const props = getReactPropsFromElement(link);
      const path = extractNavigationPathFromElement(link, props);
      if (!path) {
        return null;
      }

      const isLinkLike = link.tagName.toLowerCase() === 'a' || textContent(link.getAttribute('role')).toLowerCase() === 'link';
      const hasRouterHint = hasRouteNavigationSignal(link, props);
      if (!isLinkLike && !hasRouterHint && !link.hasAttribute('data-to') && !link.hasAttribute('data-route')) {
        return null;
      }

      return {
        label: getElementLabel(link, props) || textContent(link.getAttribute('aria-label')) || path,
        path,
        elementId: uniqueSelector(link),
        selectorCandidates: selectorCandidatesForElement(link)
      };
    })
    .filter((entry): entry is { label: string; path: string; elementId: string; selectorCandidates: string[] } =>
      Boolean(entry)
    );

  const deduped = new Map<string, { label: string; path: string; elementId: string; selectorCandidates: string[] }>();
  for (const link of links) {
    if (!deduped.has(link?.path)) {
      deduped.set(link?.path, link);
    }
  }
  return Array.from(deduped.values()).slice(0, 24);
}

function scanButtonsForRoute(): RouteMap['buttons'] {
  const buttons = queryVisibleNonSdkElements<HTMLElement>(
    document,
    [
      'button',
      '[role="button"]',
      'input[type="button"]',
      'input[type="submit"]',
      'input[type="reset"]',
      'a[role="button"]',
      '[onclick]',
      '[role="switch"]',
      '[aria-pressed]',
      '[tabindex]'
    ].join(',')
  )
    .map((button) => {
      const props = getReactPropsFromElement(button);
      const role = textContent(button.getAttribute('role')).toLowerCase();
      const tag = button.tagName.toLowerCase();
      const hasClickSignal =
        button.hasAttribute('onclick') ||
        typeof props.onClick === 'function' ||
        typeof props.onMouseDown === 'function' ||
        typeof props.onMouseUp === 'function' ||
        typeof props.onPointerDown === 'function' ||
        typeof props.onPointerUp === 'function';
      const isButtonLike =
        tag === 'button' ||
        role === 'button' ||
        role === 'switch' ||
        button.hasAttribute('aria-pressed') ||
        button instanceof HTMLInputElement ||
        hasClickSignal;

      if (!isButtonLike) {
        return null;
      }

      const label =
        getElementLabel(button, props) ||
        (button instanceof HTMLInputElement ? textContent(button.value) : '') ||
        'button';
      return {
        elementId: uniqueSelector(button),
        label,
        selectorCandidates: selectorCandidatesForElement(button)
      };
    })
    .filter((button): button is { elementId: string; label: string; selectorCandidates: string[] } => Boolean(button));

  const deduped = new Map<string, { elementId: string; label: string; selectorCandidates: string[] }>();
  for (const button of buttons) {
    if (!deduped.has(button?.elementId)) {
      deduped.set(button?.elementId, button);
    }
  }
  return Array.from(deduped.values()).slice(0, 40);
}

function scanModalTriggersForRoute(): RouteMap['modalTriggers'] {
  const modalKeywords = ['new', 'add', 'create', 'open', 'edit', 'view', 'detail', 'filter', 'settings'];
  const candidates = queryVisibleNonSdkElements<HTMLElement>(
    document,
    'button, [role="button"], a[role="button"], [aria-haspopup], [aria-expanded], input[type="button"], input[type="submit"], [role="tab"]'
  );

  const triggers: RouteMap['modalTriggers'] = [];
  const seen = new Set<string>();

  for (const element of candidates) {
    const label =
      textContent(element.textContent) ||
      textContent(element.getAttribute('aria-label')) ||
      (element instanceof HTMLInputElement ? textContent(element.value) : '') ||
      'open dialog';

    const lower = label.toLowerCase();
    const hasDialogHint =
      element.hasAttribute('aria-haspopup') ||
      element.hasAttribute('aria-expanded') ||
      modalKeywords.some((keyword) => lower.includes(keyword));

    if (!hasDialogHint) {
      continue;
    }

    const elementId = uniqueSelector(element);
    if (seen.has(elementId)) {
      continue;
    }
    seen.add(elementId);

    triggers.push({
      elementId,
      label,
      selectorCandidates: selectorCandidatesForElement(element),
      modalContents: {
        formFields: [],
        buttons: []
      }
    });

    if (triggers.length >= 24) {
      break;
    }
  }

  return triggers;
}

function scanFormFieldsForRoute(): RouteMap['formFields'] {
  const fieldSelector =
    'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]';
  const fields = queryVisibleNonSdkElements<HTMLElement>(document, fieldSelector)
    .map((field) => {
      const label = getElementLabel(field, {});
      const required =
        (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement
          ? field.required
          : false) || field.getAttribute('aria-required') === 'true';

      const options = readGenericOptions(field);
      return {
        elementId: uniqueSelector(field),
        label: label || field.tagName.toLowerCase(),
        type:
          (field instanceof HTMLInputElement && field.type) ||
          (field instanceof HTMLSelectElement ? 'select' : null) ||
          (field instanceof HTMLTextAreaElement ? 'textarea' : null) ||
          (field.isContentEditable ? 'contenteditable' : null) ||
          field.getAttribute('role') ||
          field.tagName.toLowerCase(),
        required: Boolean(required),
        selectorCandidates: selectorCandidatesForElement(field),
        ...(options.length ? { options } : {})
      };
    });

  const deduped = new Map<string, RouteMap['formFields'][number]>();
  for (const field of fields) {
    if (!deduped.has(field?.elementId)) {
      deduped.set(field?.elementId, field);
    }
  }
  return Array.from(deduped.values()).slice(0, 48);
}

function scanFiltersForRoute(): RouteMap['filters'] {
  const selector = [
    'select',
    '[role="combobox"]',
    'input[type="checkbox"]',
    '[role="switch"]',
    '[aria-pressed]',
    '[data-filter]',
    '[data-sort]',
    '[data-status]',
    '[aria-label*="filter" i]',
    '[aria-label*="sort" i]',
    '[aria-label*="status" i]',
    '[aria-label*="type" i]',
    '[aria-label*="toggle" i]',
    '[placeholder*="filter" i]',
    '[placeholder*="search" i]',
    '[name*="filter" i]',
    '[name*="sort" i]',
    '[name*="status" i]',
    '[name*="type" i]',
    '[id*="filter" i]',
    '[id*="sort" i]',
    '[id*="status" i]',
    '[id*="type" i]',
    '[class*="toggle" i]',
    '[class*="filter" i]'
  ].join(',');

  const filters = queryVisibleNonSdkElements<HTMLElement>(document, selector)
    .map((element) => {
      const props = getReactPropsFromElement(element);
      const label = getElementLabel(element, props);
      const options = readGenericOptions(element);
      return {
        elementId: uniqueSelector(element),
        label: label || element.getAttribute('aria-label') || 'filter',
        options,
        selectorCandidates: selectorCandidatesForElement(element)
      };
    })
    .filter((entry) => {
      const lower = `${entry.label}`.toLowerCase();
      return (
        lower.includes('filter') ||
        lower.includes('sort') ||
        lower.includes('status') ||
        lower.includes('type') ||
        lower.includes('toggle') ||
        lower.includes('show') ||
        entry.options.length > 0
      );
    });

  const deduped = new Map<string, RouteMap['filters'][number]>();
  for (const filter of filters) {
    if (!deduped.has(filter?.elementId)) {
      deduped.set(filter?.elementId, filter);
    }
  }
  return Array.from(deduped.values()).slice(0, 24);
}

function textFromAriaLabelledBy(element: HTMLElement): string {
  const labelledBy = textContent(element.getAttribute('aria-labelledby'));
  if (!labelledBy) {
    return '';
  }

  return labelledBy
    .split(/\s+/)
    .map((id) => {
      const node = document.getElementById(id);
      return isSdkUiElement(node) ? '' : textContent(node?.textContent);
    })
    .filter(Boolean)
    .join(' ');
}

function scanTabsForRoute(): RouteMap['tabs'] {
  const selector = '[role="tablist"], [role="tab"], [role="tabpanel"]';
  const tabs = queryVisibleNonSdkElements<HTMLElement>(document, selector)
    .map((tab) => {
      const role = textContent(tab.getAttribute('role')).toLowerCase();
      const props = getReactPropsFromElement(tab);
      const elementId = uniqueSelector(tab);
      let label = '';

      if (role === 'tabpanel') {
        label =
          textContent(tab.getAttribute('aria-label')) ||
          textFromAriaLabelledBy(tab) ||
          textContent(findFirstNonSdkElement<HTMLElement>(tab, 'h1, h2, h3, [role="heading"]')?.textContent) ||
          textContent(tab.textContent);
      } else if (role === 'tablist') {
        label = textContent(tab.getAttribute('aria-label')) || textFromAriaLabelledBy(tab) || textContent(tab.textContent);
      } else {
        label = getElementLabel(tab, props);
      }

      return {
        elementId,
        label: truncate(label, 80),
        selectorCandidates: selectorCandidatesForElement(tab)
      };
    })
    .filter((tab) => Boolean(tab.elementId) && Boolean(tab.label));

  const deduped = new Map<string, RouteMap['tabs'][number]>();
  for (const tab of tabs) {
    if (!deduped.has(tab.elementId)) {
      deduped.set(tab.elementId, tab);
    }
  }
  return Array.from(deduped.values()).slice(0, 24);
}

function scanHeadingsForRoute(): string[] {
  return uniqueStrings(
    queryVisibleNonSdkElements<HTMLElement>(document, 'h1, h2, h3, [role="heading"]')
      .map((heading) => textContent(heading.textContent) || textContent(heading.getAttribute('aria-label'))),
    12
  );
}

interface DiscoveryTriggerCandidate {
  element: HTMLElement;
  elementId: string;
  label: string;
  selectorCandidates: string[];
}

interface RouteScanAccumulator {
  path: string;
  componentName: string;
  title: string;
  navigationLinks: Map<string, RouteMap['navigationLinks'][number]>;
  buttons: Map<string, RouteMap['buttons'][number]>;
  tabs: Map<string, RouteMap['tabs'][number]>;
  modalTriggers: Map<string, RouteMap['modalTriggers'][number]>;
  formFields: Map<string, RouteMap['formFields'][number]>;
  filters: Map<string, RouteMap['filters'][number]>;
  headings: Set<string>;
}

const DISCOVERY_MODAL_SELECTOR = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[aria-modal="true"]',
  '[class*="modal" i]',
  '[class*="drawer" i]',
  '[class*="panel" i]',
  '[class*="overlay" i]',
  '[class*="dropdown" i]',
  '[class*="popover" i]'
].join(',');

const DISCOVERY_TRIGGER_KEYWORDS = ['new', 'add', 'create', 'open', 'edit', 'view', 'detail', 'filter', 'settings'];
const DISCOVERY_DESTRUCTIVE_KEYWORDS = ['delete', 'remove', 'destroy', 'clear all', 'reset'];
const DISCOVERY_SUBMIT_KEYWORDS = ['submit', 'save', 'confirm', 'create', 'add'];

function createRouteScanAccumulator(path: string, componentName: string): RouteScanAccumulator {
  return {
    path: normalizePath(path),
    componentName: componentName || 'UnknownRoute',
    title: document.title || normalizePath(path),
    navigationLinks: new Map<string, RouteMap['navigationLinks'][number]>(),
    buttons: new Map<string, RouteMap['buttons'][number]>(),
    tabs: new Map<string, RouteMap['tabs'][number]>(),
    modalTriggers: new Map<string, RouteMap['modalTriggers'][number]>(),
    formFields: new Map<string, RouteMap['formFields'][number]>(),
    filters: new Map<string, RouteMap['filters'][number]>(),
    headings: new Set<string>()
  };
}

function isDestructiveDiscoveryLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return DISCOVERY_DESTRUCTIVE_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function isSubmitLikeLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return DISCOVERY_SUBMIT_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function buildLocatorId(routePath: string, kind: AppMapLocatorRef['kind'], labelKey: string, elementId: string): string {
  const safeLabelKey = labelKey || toLabelKey(elementId) || 'target';
  return `${normalizePath(routePath)}::${kind}::${safeLabelKey}::${elementId}`;
}

function routeLocatorCandidates(entry: { elementId?: string; selectorCandidates?: string[] }): string[] {
  const candidates = (entry.selectorCandidates || []).map((candidate) => textContent(candidate)).filter(Boolean);
  const elementId = textContent(entry.elementId || '');
  if (elementId && !candidates.includes(elementId)) {
    candidates.push(elementId);
  }
  return candidates;
}

function appendRouteLocator(
  locators: Map<string, AppMapLocatorRef>,
  routePath: string,
  kind: AppMapLocatorRef['kind'],
  label: string,
  entry: {
    elementId?: string;
    selectorCandidates?: string[];
    path?: string;
    clickable?: boolean;
    fillable?: boolean;
    tagName?: string;
    role?: string;
  }
): void {
  const labelKey = toLabelKey(label);
  const candidates = routeLocatorCandidates(entry);
  const elementId = textContent(entry.elementId || candidates[0] || '');
  if (!labelKey || !candidates.length || !elementId) {
    return;
  }

  const locatorId = buildLocatorId(routePath, kind, labelKey, elementId);
  if (locators.has(locatorId)) {
    return;
  }

  locators.set(locatorId, {
    id: locatorId,
    kind,
    label: textContent(label),
    labelKey,
    selectorCandidates: candidates,
    ...(entry.path ? { path: normalizePath(entry.path) } : {}),
    ...(typeof entry.clickable === 'boolean' ? { clickable: entry.clickable } : {}),
    ...(typeof entry.fillable === 'boolean' ? { fillable: entry.fillable } : {}),
    ...(entry.tagName ? { tagName: entry.tagName } : {}),
    ...(entry.role ? { role: entry.role } : {})
  });
}

function buildRouteLocators(accumulator: RouteScanAccumulator): AppMapLocatorRef[] {
  const locators = new Map<string, AppMapLocatorRef>();
  const routePath = normalizePath(accumulator.path);

  for (const nav of accumulator.navigationLinks.values()) {
    appendRouteLocator(locators, routePath, 'navigation', nav.label, {
      elementId: nav.elementId,
      selectorCandidates: nav.selectorCandidates,
      path: nav.path,
      clickable: true,
      tagName: 'a',
      role: 'link'
    });
  }

  for (const button of accumulator.buttons.values()) {
    const kind: AppMapLocatorRef['kind'] = isSubmitLikeLabel(button.label) ? 'submit' : 'button';
    appendRouteLocator(locators, routePath, kind, button.label, {
      elementId: button.elementId,
      selectorCandidates: button.selectorCandidates,
      clickable: true
    });
  }

  for (const tab of accumulator.tabs.values()) {
    appendRouteLocator(locators, routePath, 'tab', tab.label, {
      elementId: tab.elementId,
      selectorCandidates: tab.selectorCandidates,
      clickable: true,
      role: 'tab'
    });
  }

  for (const filter of accumulator.filters.values()) {
    appendRouteLocator(locators, routePath, 'filter', filter.label, {
      elementId: filter.elementId,
      selectorCandidates: filter.selectorCandidates,
      clickable: true
    });
  }

  for (const trigger of accumulator.modalTriggers.values()) {
    appendRouteLocator(locators, routePath, 'modalTrigger', trigger.label, {
      elementId: trigger.elementId,
      selectorCandidates: trigger.selectorCandidates,
      clickable: true
    });
    for (const field of trigger.modalContents.formFields || []) {
      appendRouteLocator(locators, routePath, 'formField', field.label, {
        elementId: field.elementId,
        selectorCandidates: field.selectorCandidates,
        fillable: true
      });
    }
    for (const button of trigger.modalContents.buttons || []) {
      const kind: AppMapLocatorRef['kind'] = isSubmitLikeLabel(button.label) ? 'submit' : 'button';
      appendRouteLocator(locators, routePath, kind, button.label, {
        elementId: button.elementId,
        selectorCandidates: button.selectorCandidates,
        clickable: true
      });
    }
  }

  for (const field of accumulator.formFields.values()) {
    appendRouteLocator(locators, routePath, 'formField', field.label, {
      elementId: field.elementId,
      selectorCandidates: field.selectorCandidates,
      fillable: true
    });
  }

  return Array.from(locators.values());
}

function findOpenModalContainers(): HTMLElement[] {
  return queryVisibleNonSdkElements<HTMLElement>(document, DISCOVERY_MODAL_SELECTOR);
}

function modalContainerKey(element: HTMLElement): string {
  return `${uniqueSelector(element)}::${element.tagName.toLowerCase()}`;
}

function strictStructuralSelector(element: Element): string {
  const path: string[] = [];
  let node: Element | null = element;

  while (node && node !== document.body) {
    const parentElement: Element | null = node.parentElement;
    if (!parentElement) {
      break;
    }
    const tagName = node.tagName.toLowerCase();
    const siblings = Array.from(parentElement.children as HTMLCollectionOf<Element>).filter(
      (child: Element) => child.tagName.toLowerCase() === tagName
    );
    const index = siblings.indexOf(node);
    path.unshift(`${tagName}:nth-of-type(${index + 1})`);
    node = parentElement;
  }

  return path.length ? `body > ${path.join(' > ')}` : element.tagName.toLowerCase();
}

function selectorTargetsExactElement(selector: string, target: HTMLElement): boolean {
  try {
    const matches = queryNonSdkElements<HTMLElement>(document, selector);
    return matches.length === 1 && matches[0] === target;
  } catch {
    return false;
  }
}

function fieldPlaceholderLabel(field: HTMLElement): string {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
    return textContent(field.placeholder);
  }
  return '';
}

function fieldNameFallback(field: HTMLElement): string {
  if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) {
    return textContent(field.name);
  }
  return textContent(field.getAttribute('name'));
}

function labelTextWithoutControls(labelElement: Element | null): string {
  if (!labelElement) {
    return '';
  }
  const clone = labelElement.cloneNode(true) as HTMLElement;
  for (const control of Array.from(clone.querySelectorAll('input, textarea, select, button, [role="textbox"]'))) {
    control.remove();
  }
  return textContent(clone.textContent);
}

function nearestVisibleLabelForField(field: HTMLElement, container: HTMLElement): string {
  const cluster =
    field.closest('form, [role="form"], [aria-modal="true"], dialog, [role="dialog"]') ||
    container.closest('form, [role="form"], [aria-modal="true"], dialog, [role="dialog"]') ||
    container;
  const labels = queryVisibleNonSdkElements<HTMLLabelElement>(cluster, 'label');
  if (!labels.length) {
    return '';
  }

  const fieldRect = field.getBoundingClientRect();
  const fieldCenterX = fieldRect.left + fieldRect.width / 2;
  const fieldCenterY = fieldRect.top + fieldRect.height / 2;

  let bestLabel = '';
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const label of labels) {
    const htmlFor = textContent(label.getAttribute('for'));
    if (htmlFor) {
      const referencedControl = document.getElementById(htmlFor);
      if (referencedControl && !isSdkUiElement(referencedControl) && referencedControl !== field) {
        continue;
      }
    }

    const labelText = labelTextWithoutControls(label);
    if (!labelText) {
      continue;
    }

    const labelRect = label.getBoundingClientRect();
    const labelCenterX = labelRect.left + labelRect.width / 2;
    const labelCenterY = labelRect.top + labelRect.height / 2;
    const dx = labelCenterX - fieldCenterX;
    const dy = labelCenterY - fieldCenterY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestLabel = labelText;
    }
  }

  return bestLabel;
}

function resolveModalFieldLabel(field: HTMLElement, container: HTMLElement): string {
  if (field.id) {
    const scoped = findFirstNonSdkElement<HTMLLabelElement>(container, `label[for="${escapeCss(field.id)}"]`);
    const scopedText = labelTextWithoutControls(scoped);
    if (scopedText) {
      return scopedText;
    }

    const global = findFirstNonSdkElement<HTMLLabelElement>(document, `label[for="${escapeCss(field.id)}"]`);
    const globalText = labelTextWithoutControls(global);
    if (globalText) {
      return globalText;
    }
  }

  const wrappingLabel = field.closest('label');
  const wrappingText = labelTextWithoutControls(wrappingLabel);
  if (wrappingText) {
    return wrappingText;
  }

  const nearestLabel = nearestVisibleLabelForField(field, container);
  if (nearestLabel) {
    return nearestLabel;
  }

  const placeholder = fieldPlaceholderLabel(field);
  if (placeholder) {
    return placeholder;
  }

  const ariaLabel = textContent(field.getAttribute('aria-label'));
  if (ariaLabel) {
    return ariaLabel;
  }

  const labelledBy = textFromAriaLabelledBy(field);
  if (labelledBy) {
    return labelledBy;
  }

  const nameFallback = fieldNameFallback(field);
  if (nameFallback) {
    return nameFallback;
  }

  return field.tagName.toLowerCase();
}

function resolveModalFieldSelector(
  field: HTMLElement,
  claimedSelectors: Set<string>
): { elementId: string; selectorCandidates: string[] } {
  const selectorCandidates = uniqueStrings(
    [...selectorCandidatesForElement(field), strictStructuralSelector(field)].filter(Boolean),
    16
  );

  let selected: string | null = null;

  for (const candidate of selectorCandidates) {
    if (claimedSelectors.has(candidate)) {
      continue;
    }
    if (selectorTargetsExactElement(candidate, field)) {
      selected = candidate;
      break;
    }
  }

  if (!selected) {
    const strict = strictStructuralSelector(field);
    selected = strict;
    if (!selectorCandidates.includes(strict)) {
      selectorCandidates.push(strict);
    }
  }

  claimedSelectors.add(selected);
  return {
    elementId: selected,
    selectorCandidates: uniqueStrings([selected, ...selectorCandidates], 16)
  };
}

function scanModalContents(containers: HTMLElement[]): RouteMap['modalTriggers'][number]['modalContents'] {
  const formFieldsMap = new Map<string, RouteMap['modalTriggers'][number]['modalContents']['formFields'][number]>();
  const buttonsMap = new Map<string, RouteMap['modalTriggers'][number]['modalContents']['buttons'][number]>();
  const claimedFieldSelectors = new Set<string>();
  const seenFields = new Set<HTMLElement>();

  for (const container of containers) {
    const fieldSelector =
      'input:not([type="hidden"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]';
    const fields = queryVisibleNonSdkElements<HTMLElement>(container, fieldSelector);

    for (const field of fields) {
      if (seenFields.has(field)) {
        continue;
      }
      seenFields.add(field);

      const label = resolveModalFieldLabel(field, container);
      const type =
        (field instanceof HTMLInputElement && field.type) ||
        (field instanceof HTMLSelectElement ? 'select' : null) ||
        (field instanceof HTMLTextAreaElement ? 'textarea' : null) ||
        (field.isContentEditable ? 'contenteditable' : null) ||
        field.getAttribute('role') ||
        field.tagName.toLowerCase();
      const required =
        (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement
          ? field.required
          : false) || field.getAttribute('aria-required') === 'true';
      const options = readGenericOptions(field);
      const { elementId, selectorCandidates } = resolveModalFieldSelector(field, claimedFieldSelectors);
      if (!formFieldsMap.has(elementId)) {
        formFieldsMap.set(elementId, {
          label,
          type,
          required: Boolean(required),
          elementId,
          selectorCandidates,
          ...(options.length ? { options } : {})
        });
      }
    }

    const buttonSelector = 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], a[role="button"]';
    const buttons = queryVisibleNonSdkElements<HTMLElement>(container, buttonSelector);
    for (const button of buttons) {
      const props = getReactPropsFromElement(button);
      const label = getElementLabel(button, props) || textContent(button.getAttribute('aria-label')) || 'button';
      const key = label.toLowerCase();
      if (!buttonsMap.has(key)) {
        buttonsMap.set(key, {
          label,
          elementId: uniqueSelector(button),
          selectorCandidates: selectorCandidatesForElement(button)
        });
      }
    }
  }

  return {
    formFields: Array.from(formFieldsMap.values()).slice(0, 48),
    buttons: Array.from(buttonsMap.values()).slice(0, 48)
  };
}

function discoverModalTriggerCandidates(): DiscoveryTriggerCandidate[] {
  const selector =
    'button, [role="button"], a[role="button"], [aria-haspopup], [onclick], input[type="button"], input[type="submit"], [role="tab"]';
  const deduped = new Map<string, DiscoveryTriggerCandidate>();

  for (const element of queryVisibleNonSdkElements<HTMLElement>(document, selector)) {
    const role = textContent(element.getAttribute('role')).toLowerCase();
    const props = getReactPropsFromElement(element);
    const label =
      getElementLabel(element, props) ||
      textContent(element.getAttribute('aria-label')) ||
      (element instanceof HTMLInputElement ? textContent(element.value) : '') ||
      'open';
    const lower = label.toLowerCase();
    const isTriggerKeyword = DISCOVERY_TRIGGER_KEYWORDS.some((keyword) => lower.includes(keyword));
    const hasPopupHint = element.getAttribute('aria-haspopup') === 'true' || element.hasAttribute('aria-haspopup');
    const qualifies = role === 'tab' || hasPopupHint || isTriggerKeyword;
    if (!qualifies) {
      continue;
    }

    const elementId = uniqueSelector(element);
    if (!deduped.has(elementId)) {
      deduped.set(elementId, {
        element,
        elementId,
        label,
        selectorCandidates: selectorCandidatesForElement(element)
      });
    }
  }

  return Array.from(deduped.values()).slice(0, 64);
}

function discoverTabCandidates(): DiscoveryTriggerCandidate[] {
  const deduped = new Map<string, DiscoveryTriggerCandidate>();
  const tabs = queryVisibleNonSdkElements<HTMLElement>(document, '[role="tab"]');
  for (const tab of tabs) {
    const props = getReactPropsFromElement(tab);
    const label = getElementLabel(tab, props) || textContent(tab.getAttribute('aria-label')) || 'tab';
    const elementId = uniqueSelector(tab);
    if (!deduped.has(elementId)) {
      deduped.set(elementId, {
        element: tab,
        elementId,
        label,
        selectorCandidates: selectorCandidatesForElement(tab)
      });
    }
  }
  return Array.from(deduped.values()).slice(0, 48);
}

function mergeStaticRouteScan(accumulator: RouteScanAccumulator): void {
  accumulator.title = document.title || accumulator.title;

  for (const entry of scanNavigationLinksForRoute()) {
    if (!accumulator.navigationLinks.has(entry.path)) {
      accumulator.navigationLinks.set(entry.path, entry);
    }
  }
  for (const entry of scanButtonsForRoute()) {
    if (!accumulator.buttons.has(entry.elementId)) {
      accumulator.buttons.set(entry.elementId, entry);
    }
  }
  for (const entry of scanTabsForRoute()) {
    if (!accumulator.tabs.has(entry.elementId)) {
      accumulator.tabs.set(entry.elementId, entry);
    }
  }
  for (const entry of scanFormFieldsForRoute()) {
    if (!accumulator.formFields.has(entry.elementId)) {
      accumulator.formFields.set(entry.elementId, entry);
    }
  }
  for (const entry of scanFiltersForRoute()) {
    if (!accumulator.filters.has(entry.elementId)) {
      accumulator.filters.set(entry.elementId, entry);
    }
  }
  for (const heading of scanHeadingsForRoute()) {
    if (heading) {
      accumulator.headings.add(heading);
    }
  }
}

function mergeModalTriggerResult(
  accumulator: RouteScanAccumulator,
  trigger: Pick<DiscoveryTriggerCandidate, 'elementId' | 'label' | 'selectorCandidates'>,
  modalContents: RouteMap['modalTriggers'][number]['modalContents']
): void {
  const existing = accumulator.modalTriggers.get(trigger.elementId);
  const existingContents = existing?.modalContents || { formFields: [], buttons: [] };

  const formFieldsMap = new Map(existingContents.formFields.map((field) => [field.elementId, field] as const));
  for (const field of modalContents.formFields) {
    const existingField = formFieldsMap.get(field.elementId);
    if (!existingField) {
      formFieldsMap.set(field.elementId, field);
      continue;
    }

    formFieldsMap.set(field.elementId, {
      ...existingField,
      ...(existingField.label ? {} : { label: field.label }),
      ...(existingField.type ? {} : { type: field.type }),
      required: existingField.required || field.required,
      selectorCandidates: uniqueStrings(
        [...(existingField.selectorCandidates || []), ...(field.selectorCandidates || [])],
        16
      ),
      ...(existingField.options?.length ? {} : field.options?.length ? { options: field.options } : {})
    });
  }

  const buttonsMap = new Map(existingContents.buttons.map((button) => [button.label.toLowerCase(), button] as const));
  for (const button of modalContents.buttons) {
    buttonsMap.set(button.label.toLowerCase(), button);
  }

  accumulator.modalTriggers.set(trigger.elementId, {
    elementId: trigger.elementId,
    label: trigger.label,
    selectorCandidates: trigger.selectorCandidates?.length ? trigger.selectorCandidates : existing?.selectorCandidates,
    modalContents: {
      formFields: Array.from(formFieldsMap.values()).slice(0, 48),
      buttons: Array.from(buttonsMap.values()).slice(0, 48)
    }
  });
}

function isElementInsideOpenModal(element: HTMLElement): boolean {
  return Boolean(element.closest(DISCOVERY_MODAL_SELECTOR));
}

function canClickDuringDiscovery(element: HTMLElement, label: string): boolean {
  if (!element) {
    return false;
  }
  if (isDestructiveDiscoveryLabel(label)) {
    return false;
  }
  if (isElementInsideOpenModal(element) && isSubmitLikeLabel(label)) {
    return false;
  }
  return true;
}

async function closeDiscoveredModal(): Promise<void> {
  const openContainers = findOpenModalContainers();
  if (!openContainers.length) {
    return;
  }

  const closeButtonSelector = 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"], a[role="button"]';
  const closeCandidates: HTMLElement[] = [];
  for (const container of openContainers) {
    for (const candidate of queryVisibleNonSdkElements<HTMLElement>(container, closeButtonSelector)) {
      closeCandidates.push(candidate);
    }
  }

  let closed = false;
  for (const candidate of closeCandidates) {
    const props = getReactPropsFromElement(candidate);
    const label =
      getElementLabel(candidate, props) ||
      textContent(candidate.getAttribute('aria-label')) ||
      (candidate instanceof HTMLInputElement ? textContent(candidate.value) : '');
    const lower = label.toLowerCase();
    const isCloseLabel =
      lower === 'close' ||
      lower === 'cancel' ||
      lower === 'dismiss' ||
      lower.includes(' close') ||
      lower.includes('cancel') ||
      lower.includes('dismiss') ||
      textContent(candidate.getAttribute('aria-label')).toLowerCase() === 'close';
    if (!isCloseLabel || isDestructiveDiscoveryLabel(label)) {
      continue;
    }
    candidate.click();
    closed = true;
    break;
  }

  if (!closed) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  }
  await sleep(DISCOVERY_MODAL_CLOSE_WAIT_MS);
}

async function scanModalTriggersActive(accumulator: RouteScanAccumulator): Promise<void> {
  const triggerCandidates = discoverModalTriggerCandidates();
  for (const trigger of triggerCandidates) {
    mergeModalTriggerResult(accumulator, trigger, { formFields: [], buttons: [] });
    if (!canClickDuringDiscovery(trigger.element, trigger.label)) {
      continue;
    }

    const beforeKeys = new Set(findOpenModalContainers().map((container) => modalContainerKey(container)));
    trigger.element.click();
    await sleep(DISCOVERY_TRIGGER_WAIT_MS);

    const openedContainers = findOpenModalContainers();
    const newContainers = openedContainers.filter((container) => !beforeKeys.has(modalContainerKey(container)));
    const containersToScan = newContainers.length ? newContainers : openedContainers;
    const modalContents = scanModalContents(containersToScan);
    mergeModalTriggerResult(accumulator, trigger, modalContents);

    mergeStaticRouteScan(accumulator);
    await closeDiscoveredModal();
    mergeStaticRouteScan(accumulator);
  }
}

async function scanTabsActive(accumulator: RouteScanAccumulator): Promise<void> {
  const tabCandidates = discoverTabCandidates();
  for (const tab of tabCandidates) {
    if (!canClickDuringDiscovery(tab.element, tab.label)) {
      continue;
    }
    tab.element.click();
    await sleep(DISCOVERY_TAB_WAIT_MS);
    mergeStaticRouteScan(accumulator);
  }
}

async function scanRouteMap(path: string, componentName: string): Promise<RouteMap> {
  const accumulator = createRouteScanAccumulator(path, componentName);
  mergeStaticRouteScan(accumulator);
  await scanModalTriggersActive(accumulator);
  await scanTabsActive(accumulator);
  mergeStaticRouteScan(accumulator);

  return {
    path: accumulator.path,
    componentName: accumulator.componentName,
    title: accumulator.title,
    navigationLinks: Array.from(accumulator.navigationLinks.values()).slice(0, 32),
    buttons: Array.from(accumulator.buttons.values()).slice(0, 64),
    tabs: Array.from(accumulator.tabs.values()).slice(0, 32),
    modalTriggers: Array.from(accumulator.modalTriggers.values()).slice(0, 48),
    formFields: Array.from(accumulator.formFields.values()).slice(0, 96),
    filters: Array.from(accumulator.filters.values()).slice(0, 48),
    headings: Array.from(accumulator.headings.values()).slice(0, 24),
    locators: buildRouteLocators(accumulator).slice(0, 256)
  };
}

async function waitForDiscoveryPathMatch(expectedPath: string): Promise<boolean> {
  const normalizedExpected = normalizeDiscoveryPath(expectedPath);
  const startedAt = Date.now();

  while (Date.now() - startedAt <= DISCOVERY_NAVIGATION_TIMEOUT_MS) {
    if (normalizeDiscoveryPath(window.location.pathname) === normalizedExpected) {
      await sleep(DISCOVERY_SETTLE_WAIT_MS);
      return true;
    }
    await sleep(DISCOVERY_NAVIGATION_POLL_MS);
  }

  return false;
}

async function navigateForDiscovery(targetPath: string, navigate?: NavigateFn | null): Promise<boolean> {
  const expectedPath = normalizePath(targetPath);
  const currentPath = normalizeDiscoveryPath(window.location.pathname);
  const expectedDiscoveryPath = normalizeDiscoveryPath(expectedPath);
  if (currentPath === expectedDiscoveryPath) {
    return true;
  }

  if (navigate) {
    try {
      await navigate(expectedPath);
      const navigated = await waitForDiscoveryPathMatch(expectedPath);
      if (navigated) {
        return true;
      }
    } catch {
      // Ignore navigate-driver failures and fall back to history navigation.
    }
  }

  try {
    window.history.pushState({}, '', expectedPath);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  } catch {
    return false;
  }

  if (normalizeDiscoveryPath(window.location.pathname) === expectedDiscoveryPath) {
    await sleep(DISCOVERY_SETTLE_WAIT_MS);
    return true;
  }

  return waitForDiscoveryPathMatch(expectedPath);
}

function sanitizeAppMap(value: unknown): AppMap | null {
  return sanitizeAppMapWithReason(value).appMap;
}

function fieldSelectorIdentity(field: { elementId?: string; selectorCandidates?: string[] }): string {
  const elementId = textContent(field.elementId || '');
  if (elementId) {
    return elementId;
  }

  const firstSelectorCandidate = textContent(field.selectorCandidates?.[0] || '');
  return firstSelectorCandidate;
}

function hasDistinctLabelSelectorCollision(
  fields: Array<{ label: string; elementId?: string; selectorCandidates?: string[] }>
): boolean {
  const selectorToLabel = new Map<string, string>();

  for (const field of fields) {
    const selectorIdentity = fieldSelectorIdentity(field);
    if (!selectorIdentity) {
      continue;
    }

    const labelKey = toLabelKey(field.label || '');
    if (!labelKey) {
      continue;
    }

    const existing = selectorToLabel.get(selectorIdentity);
    if (!existing) {
      selectorToLabel.set(selectorIdentity, labelKey);
      continue;
    }

    if (existing !== labelKey) {
      return true;
    }
  }

  return false;
}

function hasMalformedRawLocatorEntries(routes: unknown[]): boolean {
  for (const routeEntry of routes) {
    if (!isRecord(routeEntry) || !('locators' in routeEntry)) {
      continue;
    }

    const locatorsValue = routeEntry.locators;
    if (!Array.isArray(locatorsValue)) {
      continue;
    }

    for (const locator of locatorsValue) {
      if (!isRecord(locator)) {
        return true;
      }

      const labelKey = textContent(toSafeString(locator.labelKey, ''));
      const selectorCandidates = toSafeStringArray(locator.selectorCandidates, 12);
      if (!labelKey || !selectorCandidates.length) {
        return true;
      }
    }
  }

  return false;
}

function hasRouteIntegrityIssues(routes: RouteMap[]): boolean {
  for (const route of routes) {
    if (hasDistinctLabelSelectorCollision(route.formFields || [])) {
      return true;
    }

    for (const trigger of route.modalTriggers || []) {
      const modalFields = trigger.modalContents?.formFields || [];
      if (hasDistinctLabelSelectorCollision(modalFields)) {
        return true;
      }
    }
  }

  return false;
}

function sanitizeAppMapWithReason(value: unknown): AppMapSanitizeResult {
  if (!isRecord(value) || !Array.isArray(value.routes)) {
    return { appMap: null, reason: 'invalid_shape' };
  }

  const version = toSafeString(value.version, '');
  if (version !== APP_MAP_VERSION) {
    return { appMap: null, reason: 'schema_mismatch' };
  }

  if (hasMalformedRawLocatorEntries(value.routes)) {
    return { appMap: null, reason: 'integrity_invalid' };
  }

  const routes = value.routes
    .filter((entry) => entry != null)
    .map((entry) => sanitizeRouteMapEntry(entry))
    .filter((entry): entry is RouteMap => Boolean(entry));

  if (hasRouteIntegrityIssues(routes)) {
    return { appMap: null, reason: 'integrity_invalid' };
  }

  return {
    appMap: {
      version: APP_MAP_VERSION,
      discoveredAt: typeof value.discoveredAt === 'number' ? value.discoveredAt : Date.now(),
      routeCount: typeof value.routeCount === 'number' ? value.routeCount : routes.length,
      routes
    },
    reason: 'valid'
  };
}

function currentAppMapCacheMetadata(scope: AppCacheScope = resolveCurrentAppCacheScope()): AppMapCacheMetadata {
  return {
    schemaVersion: APP_MAP_VERSION,
    sdkBuildVersion: APP_MAP_SDK_BUILD_VERSION,
    integrityRevision: APP_MAP_INTEGRITY_REVISION,
    scopeSignature: scope.signature
  };
}

function isMetadataRecord(value: unknown): value is AppMapCacheMetadata {
  if (!isRecord(value)) {
    return false;
  }

  const schemaVersion = textContent(toSafeString(value.schemaVersion, ''));
  const sdkBuildVersion = textContent(toSafeString(value.sdkBuildVersion, ''));
  const integrityRevision = textContent(toSafeString(value.integrityRevision, ''));
  const scopeSignature = textContent(toSafeString(value.scopeSignature, ''));

  return Boolean(schemaVersion && sdkBuildVersion && integrityRevision && scopeSignature);
}

function readAppMapCacheMetadataForScope(scope: AppCacheScope): AppMapCacheMetadata | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const primaryKey = getScopedAppMapStorageKeys(scope).metadata;
  const entry = readLocalStorageEntry([
    primaryKey,
    buildScopedStorageKey(LEGACY_APP_MAP_CACHE_METADATA_STORAGE_KEY, scope)
  ]);
  if (!entry) {
    return null;
  }

  try {
    const parsed = JSON.parse(entry.raw) as unknown;
    if (!isMetadataRecord(parsed)) {
      return null;
    }
    if (entry.key !== primaryKey) {
      window.localStorage.setItem(primaryKey, JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    return null;
  }
}

function readAppMapCacheMetadataByScopeKey(scopeKey: string): AppMapCacheMetadata | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const primaryKey = buildScopedStorageKeyFromScopeKey(APP_MAP_CACHE_METADATA_STORAGE_KEY, scopeKey);
  const entry = readLocalStorageEntry([
    primaryKey,
    buildScopedStorageKeyFromScopeKey(LEGACY_APP_MAP_CACHE_METADATA_STORAGE_KEY, scopeKey)
  ]);
  if (!entry) {
    return null;
  }

  try {
    const parsed = JSON.parse(entry.raw) as unknown;
    if (!isMetadataRecord(parsed)) {
      return null;
    }
    if (entry.key !== primaryKey) {
      window.localStorage.setItem(primaryKey, JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeAppMapCacheMetadataForScope(metadata: AppMapCacheMetadata, scope: AppCacheScope): void {
  if (typeof window === 'undefined') {
    return;
  }

  const keys = getScopedAppMapStorageKeys(scope);
  window.localStorage.setItem(keys.schemaVersion, metadata.schemaVersion);
  window.localStorage.setItem(keys.metadata, JSON.stringify(metadata));
}

function writeAppMapCacheMetadata(
  metadata: AppMapCacheMetadata = currentAppMapCacheMetadata(),
  scope: AppCacheScope = resolveCurrentAppCacheScope()
): void {
  for (const candidate of getRelatedAppCacheScopes(scope)) {
    writeAppMapCacheMetadataForScope(
      {
        ...metadata,
        scopeSignature: candidate.signature
      },
      candidate
    );
  }
}

export function getCurrentAppMapCacheMetadata(scope: AppCacheScope = resolveCurrentAppCacheScope()): AppMapCacheMetadata {
  return currentAppMapCacheMetadata(scope);
}

function clearAppMapCacheForScope(scope: AppCacheScope): void {
  if (typeof window === 'undefined') {
    return;
  }
  const keys = getScopedAppMapStorageKeys(scope);
  window.localStorage.removeItem(keys.appMap);
  window.localStorage.removeItem(keys.schemaVersion);
  window.localStorage.removeItem(keys.metadata);
  window.localStorage.removeItem(buildScopedStorageKey(LEGACY_APP_MAP_STORAGE_KEY, scope));
  window.localStorage.removeItem(buildScopedStorageKey(LEGACY_APP_MAP_SCHEMA_VERSION_STORAGE_KEY, scope));
  window.localStorage.removeItem(buildScopedStorageKey(LEGACY_APP_MAP_CACHE_METADATA_STORAGE_KEY, scope));
}

function syncAppMapCacheMetadataForScope(scope: AppCacheScope): AppMapCacheMetadataSyncReason {
  if (typeof window === 'undefined') {
    return 'up_to_date';
  }

  const currentMetadata = currentAppMapCacheMetadata(scope);
  const scopedKeys = getScopedAppMapStorageKeys(scope);
  const hasCachedMap = Boolean(
    readLocalStorageEntry([scopedKeys.appMap, buildScopedStorageKey(LEGACY_APP_MAP_STORAGE_KEY, scope)])
  );
  if (!hasCachedMap) {
    writeAppMapCacheMetadataForScope(currentMetadata, scope);
    return 'up_to_date';
  }

  const cachedMetadata = readAppMapCacheMetadataForScope(scope);
  const metadataMatches =
    cachedMetadata?.schemaVersion === currentMetadata.schemaVersion &&
    cachedMetadata?.sdkBuildVersion === currentMetadata.sdkBuildVersion &&
    cachedMetadata?.integrityRevision === currentMetadata.integrityRevision &&
    cachedMetadata?.scopeSignature === currentMetadata.scopeSignature;

  if (metadataMatches) {
    writeAppMapCacheMetadataForScope(currentMetadata, scope);
    return 'up_to_date';
  }

  clearAppMapCacheForScope(scope);
  writeAppMapCacheMetadataForScope(currentMetadata, scope);
  return 'meta_mismatch';
}

function isRecoveryMetadataCompatible(
  metadata: AppMapCacheMetadata | null,
  expectedMetadata: AppMapCacheMetadata
): boolean {
  if (!metadata) {
    return false;
  }

  return (
    metadata.schemaVersion === expectedMetadata.schemaVersion &&
    metadata.sdkBuildVersion === expectedMetadata.sdkBuildVersion &&
    metadata.integrityRevision === expectedMetadata.integrityRevision
  );
}

function readStoredAppMapRecoveryCandidates(scope: AppCacheScope): StoredAppMapRecoveryCandidate[] {
  if (typeof window === 'undefined') {
    return [];
  }

  const expectedMetadata = currentAppMapCacheMetadata(scope);
  const recoveryCandidates: StoredAppMapRecoveryCandidate[] = [];

  for (let index = 0; index < window.localStorage.length; index += 1) {
    const storageKey = window.localStorage.key(index);
    if (!storageKey) {
      continue;
    }

    const scopeKey =
      extractScopeKeyFromStorageKey(APP_MAP_STORAGE_KEY, storageKey) ||
      extractScopeKeyFromStorageKey(LEGACY_APP_MAP_STORAGE_KEY, storageKey);
    if (!scopeKey) {
      continue;
    }

    const metadata = readAppMapCacheMetadataByScopeKey(scopeKey);
    if (!isRecoveryMetadataCompatible(metadata, expectedMetadata)) {
      continue;
    }

    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      const sanitized = sanitizeAppMapWithReason(parsed);
      if (!sanitized.appMap) {
        continue;
      }

      if (!sanitized.appMap.routes.some((route) => doesRouteMatchRecoveryScope(route.path || '/', scope.currentRoute))) {
        continue;
      }

      recoveryCandidates.push({
        appMap: sanitized.appMap,
        scopeKey,
        discoveredAt: sanitized.appMap.discoveredAt
      });
    } catch {
      continue;
    }
  }

  return recoveryCandidates.sort((left, right) => right.discoveredAt - left.discoveredAt);
}

export function findStoredAppMapScopeKeysForRoute(scope: AppCacheScope = resolveCurrentAppCacheScope()): string[] {
  return readStoredAppMapRecoveryCandidates(scope).map((candidate) => candidate.scopeKey);
}

function readCachedAppMapWithReasonForScope(scope: AppCacheScope): { appMap: AppMap | null; reason: AppMapCacheReadReason } {
  const metadataSyncReason = syncAppMapCacheMetadataForScope(scope);
  if (metadataSyncReason === 'meta_mismatch') {
    return { appMap: null, reason: 'meta_mismatch' };
  }

  const raw = window.localStorage.getItem(getScopedAppMapStorageKeys(scope).appMap);
  const primaryKey = getScopedAppMapStorageKeys(scope).appMap;
  const entry = readLocalStorageEntry([primaryKey, buildScopedStorageKey(LEGACY_APP_MAP_STORAGE_KEY, scope)]);
  if (!entry) {
    return { appMap: null, reason: 'no_cache' };
  }

  try {
    const parsed = JSON.parse(entry.raw) as unknown;
    const sanitized = sanitizeAppMapWithReason(parsed);
    if (!sanitized.appMap) {
      clearAppMapCacheForScope(scope);
      return { appMap: null, reason: sanitized.reason };
    }
    if (entry.key !== primaryKey) {
      saveAppMapToCache(sanitized.appMap, scope);
    }
    return { appMap: sanitized.appMap, reason: 'valid' };
  } catch {
    clearAppMapCacheForScope(scope);
    return { appMap: null, reason: 'invalid_shape' };
  }
}

export function readCachedAppMapWithReason(
  scope: AppCacheScope = resolveCurrentAppCacheScope()
): { appMap: AppMap | null; reason: AppMapCacheReadReason } {
  let fallbackReason: AppMapCacheReadReason = 'no_cache';

  for (const candidate of getRelatedAppCacheScopes(scope)) {
    const result = readCachedAppMapWithReasonForScope(candidate);
    if (result.appMap) {
      if (candidate.key !== scope.key) {
        saveAppMapToCache(result.appMap, scope);
      }
      return result;
    }

    if (APP_MAP_CACHE_READ_REASON_PRIORITY[result.reason] > APP_MAP_CACHE_READ_REASON_PRIORITY[fallbackReason]) {
      fallbackReason = result.reason;
    }
  }

  const recoveryCandidate = readStoredAppMapRecoveryCandidates(scope)[0];
  if (recoveryCandidate) {
    saveAppMapToCache(recoveryCandidate.appMap, scope);
    return { appMap: recoveryCandidate.appMap, reason: 'valid' };
  }

  return { appMap: null, reason: fallbackReason };
}

export function readCachedAppMap(scope: AppCacheScope = resolveCurrentAppCacheScope()): AppMap | null {
  return readCachedAppMapWithReason(scope).appMap;
}

export function saveAppMapToCache(appMap: AppMap, scope: AppCacheScope = resolveCurrentAppCacheScope()): void {
  if (typeof window === 'undefined') {
    return;
  }

  for (const candidate of getRelatedAppCacheScopes(scope)) {
    writeAppMapCacheMetadataForScope(currentAppMapCacheMetadata(candidate), candidate);
    window.localStorage.setItem(getScopedAppMapStorageKeys(candidate).appMap, JSON.stringify(appMap));
  }
}

export function clearAppMapCache(scope: AppCacheScope = resolveCurrentAppCacheScope()): void {
  for (const candidate of getRelatedAppCacheScopes(scope)) {
    clearAppMapCacheForScope(candidate);
  }
}

export type AppMapCacheMetadataSyncReason = 'up_to_date' | 'meta_mismatch';

export function syncAppMapCacheMetadata(scope: AppCacheScope = resolveCurrentAppCacheScope()): AppMapCacheMetadataSyncReason {
  let syncReason: AppMapCacheMetadataSyncReason = 'up_to_date';
  for (const candidate of getRelatedAppCacheScopes(scope)) {
    const candidateReason = syncAppMapCacheMetadataForScope(candidate);
    if (candidateReason === 'meta_mismatch') {
      syncReason = 'meta_mismatch';
    }
  }
  return syncReason;
}

// Backward-compatible alias.
export const syncAppMapCacheVersion = syncAppMapCacheMetadata;

export function getReactRouterRouteCount(): number {
  return discoverRouterSnapshot().routes.length;
}

export function getRouterNavigateFromFiber(): ((path: string) => void | Promise<unknown>) | null {
  return discoverRouterSnapshot().navigate;
}

export async function discoverAppMap(): Promise<AppMap> {
  const readiness = await waitForDiscoveryBootstrapSnapshot();
  const snapshot = readiness.snapshot;
  // eslint-disable-next-line no-console
  console.log('[Exocor Discovery] readiness:', readiness.outcome, {
    checks: readiness.checks,
    routes: snapshot.routes.length,
    hasNavigate: Boolean(snapshot.navigate)
  });
  // eslint-disable-next-line no-console
  console.log('[Exocor Discovery] snapshot:', snapshot);
  const originRoute = normalizePath(snapshot.currentRoute || window.location.pathname);
  const routes = (snapshot?.routes || []).filter((route): route is RouteDefinition => Boolean(route));
  const discoveredRoutes: RouteMap[] = [];
  const routeQueue: RouteDefinition[] = [];
  const queuedPaths = new Set<string>();
  const scannedPaths = new Set<string>();
  let discoveryNavigate: NavigateFn | null = snapshot.navigate;

  const enqueueRoute = (route: RouteDefinition, source: 'snapshot' | 'navigation_link'): void => {
    const normalizedPath = normalizePath(route?.path || route?.navigatePath || originRoute);
    if (!isSafeDiscoveryRoute(normalizedPath, originRoute)) {
      return;
    }
    if (queuedPaths.has(normalizedPath) || scannedPaths.has(normalizedPath)) {
      return;
    }
    if (queuedPaths.size + scannedPaths.size >= DISCOVERY_MAX_ROUTES) {
      return;
    }
    routeQueue.push({
      path: normalizedPath,
      navigatePath: toNavigablePath(route?.navigatePath || normalizedPath),
      componentName: route?.componentName || 'UnknownRoute'
    });
    queuedPaths.add(normalizedPath);
    // eslint-disable-next-line no-console
    console.log('[Exocor Discovery] route enqueue:', normalizedPath, 'source:', source);
  };

  for (const route of routes) {
    enqueueRoute(route, 'snapshot');
  }
  if (!routeQueue.length) {
    enqueueRoute({ path: originRoute, navigatePath: originRoute, componentName: 'UnknownRoute' }, 'snapshot');
  }

  // eslint-disable-next-line no-console
  console.log('[Exocor Discovery] routes to scan:', routeQueue.length, routeQueue);

  while (routeQueue.length && discoveredRoutes.length < DISCOVERY_MAX_ROUTES) {
    const route = routeQueue.shift() as RouteDefinition;
    const normalizedRoutePath = normalizePath(route.path || originRoute);
    queuedPaths.delete(normalizedRoutePath);
    if (scannedPaths.has(normalizedRoutePath)) {
      continue;
    }
    scannedPaths.add(normalizedRoutePath);

    const liveSnapshot = discoverRouterSnapshot();
    if (liveSnapshot.navigate) {
      discoveryNavigate = liveSnapshot.navigate;
    }

    try {
      const targetPath = toNavigablePath(route?.navigatePath || route?.path || originRoute);
      const navigated = await navigateForDiscovery(targetPath, discoveryNavigate);
      // eslint-disable-next-line no-console
      console.log('[Exocor Discovery] navigated:', navigated, 'to:', targetPath);
      if (!navigated) {
        continue;
      }

      const landedPath = normalizePath(window.location.pathname);
      if (landedPath !== normalizePath(targetPath)) {
        continue;
      }

      const matchedRoute =
        (liveSnapshot.routes || []).find((entry) => normalizePath(entry.path) === normalizedRoutePath) ||
        (liveSnapshot.routes || []).find((entry) => normalizePath(entry.navigatePath) === normalizePath(targetPath));
      const componentName =
        matchedRoute?.componentName && matchedRoute.componentName !== 'UnknownRoute'
          ? matchedRoute.componentName
          : route?.componentName || 'UnknownRoute';

      const scannedRoute = await scanRouteMap(normalizedRoutePath, componentName);
      discoveredRoutes.push(scannedRoute);

      for (const navLink of scannedRoute.navigationLinks || []) {
        const navPath = normalizePath(navLink.path || '');
        enqueueRoute(
          {
            path: navPath,
            navigatePath: navPath,
            componentName: 'UnknownRoute'
          },
          'navigation_link'
        );
      }
    } catch {
      continue;
    }
  }

  if (!discoveredRoutes.length) {
    try {
      discoveredRoutes.push(await scanRouteMap(originRoute, 'UnknownRoute'));
    } catch {
      discoveredRoutes.push({
        path: originRoute,
        componentName: 'UnknownRoute',
        title: document.title || originRoute,
        navigationLinks: [],
        modalTriggers: [],
        formFields: [],
        buttons: [],
        filters: [],
        tabs: [],
        headings: []
      });
    }
  }

  try {
    const currentRoute = normalizeDiscoveryPath(window.location.pathname);
    if (currentRoute !== normalizeDiscoveryPath(originRoute)) {
      const restoreSnapshot = discoverRouterSnapshot();
      await navigateForDiscovery(originRoute, restoreSnapshot.navigate || discoveryNavigate);
    }
  } catch {
    // Ignore navigation restore errors and still cache the discovered subset.
  }

  const appMap: AppMap = {
    version: APP_MAP_VERSION,
    discoveredAt: Date.now(),
    routeCount: discoveredRoutes.length,
    routes: discoveredRoutes
  };

  // eslint-disable-next-line no-console
  console.log('[Exocor Discovery] saving map with routes:', discoveredRoutes.length);
  // eslint-disable-next-line no-console
  console.log('[Exocor Discovery] map ready:', appMap.routes.length, 'routes', appMap.routes.map((r) => r.path));
  saveAppMapToCache(appMap);
  return appMap;
}

export const __DOM_SCANNER_TESTING__ = {
  normalizeDiscoveryPath,
  navigateForDiscovery,
  scanRouteMap
};

function estimateTokens(payload: unknown): number {
  return Math.ceil(JSON.stringify(payload).length / 4);
}

export function summarizeAppMapForResolver(
  appMap: AppMap | null | undefined,
  currentRoute: string,
  tokenBudget = 800
): AppMapSummary | null {
  if (!appMap) {
    return null;
  }

  const normalizedCurrent = normalizePath(currentRoute || '/');
  const orderedRoutes = [...(appMap?.routes || [])]
    .filter((route): route is RouteMap => Boolean(route))
    .map((route) => sanitizeRouteMapEntry(route))
    .filter((route): route is RouteMap => Boolean(route))
    .sort((a, b) => {
    if (normalizePath(a?.path || '/') === normalizedCurrent) {
      return -1;
    }
    if (normalizePath(b?.path || '/') === normalizedCurrent) {
      return 1;
    }
    return (a?.path || '').localeCompare(b?.path || '');
  });

  const summary: AppMapSummary = {
    version: appMap?.version || APP_MAP_VERSION,
    routeCount: appMap?.routeCount || orderedRoutes.length,
    tokenEstimate: 0,
    routes: orderedRoutes.map((route) => {
      const navigationLinks = (route?.navigationLinks || [])
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
        .reduce<AppMapSummary['routes'][number]['navigationLinks']>((accumulator, entry) => {
          const path = normalizePath(entry?.path || '/');
          if (!path) {
            return accumulator;
          }
          if (accumulator.some((candidate) => candidate.path === path)) {
            return accumulator;
          }
          accumulator.push({
            label: truncate(textContent(entry?.label || entry?.path || path), 72),
            path
          });
          return accumulator;
        }, [])
        .slice(0, 24);

      const modalTriggers = (route?.modalTriggers || [])
        .filter((trigger): trigger is NonNullable<typeof trigger> => Boolean(trigger))
        .reduce<AppMapSummary['routes'][number]['modalTriggers']>((accumulator, trigger) => {
          const label = textContent(trigger?.label || '');
          if (!label) {
            return accumulator;
          }

          const existingIndex = accumulator.findIndex((entry) => entry.label.toLowerCase() === label.toLowerCase());
          const existing =
            existingIndex >= 0
              ? accumulator[existingIndex]
              : {
                  label: truncate(label, 72),
                  formFields: [],
                  submitButton: ''
                };

          const formFieldMap = new Map(
            (existing?.formFields || []).map((field) => [`${field.label.toLowerCase()}::${field.type.toLowerCase()}`, field])
          );
          const modalFields = Array.isArray(trigger?.modalContents?.formFields) ? trigger.modalContents.formFields : [];

          for (const field of modalFields) {
            const fieldLabel = textContent(field?.label || '');
            if (!fieldLabel) {
              continue;
            }

            const fieldType = textContent(field?.type || 'text') || 'text';
            const key = `${fieldLabel.toLowerCase()}::${fieldType.toLowerCase()}`;
            if (!formFieldMap.has(key)) {
              formFieldMap.set(key, {
                label: truncate(fieldLabel, 72),
                type: truncate(fieldType, 24)
              });
            }
          }

          const modalButtons = Array.isArray(trigger?.modalContents?.buttons) ? trigger.modalContents.buttons : [];
          const submitButton =
            modalButtons
              .map((button) => textContent(button?.label || ''))
              .find((buttonLabel) => /(create|save|submit|add|confirm)/i.test(buttonLabel)) ||
            modalButtons.map((button) => textContent(button?.label || '')).find(Boolean) ||
            existing.submitButton ||
            '';

          const nextEntry = {
            ...existing,
            formFields: Array.from(formFieldMap.values()).slice(0, 12),
            submitButton: truncate(submitButton, 72)
          };

          if (existingIndex >= 0) {
            accumulator[existingIndex] = nextEntry;
          } else {
            accumulator.push(nextEntry);
          }

          return accumulator;
        }, [])
        .slice(0, 8);

      return {
        path: route?.path || '/',
        title: truncate(route?.title || route?.path || '/', 72),
        navigationLinks,
        buttons: uniqueStrings(
          (route?.buttons || [])
            .filter((button): button is NonNullable<typeof button> => Boolean(button))
            .map((button) => textContent(button?.label || ''))
            .filter(Boolean),
          24
        ),
        tabs: uniqueStrings(
          (route?.tabs || [])
            .filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))
            .map((tab) => textContent(tab?.label || ''))
            .filter(Boolean),
          24
        ),
        modalTriggers,
        filters: uniqueStrings(
          (route?.filters || [])
            .filter((filter): filter is NonNullable<typeof filter> => Boolean(filter))
            .map((filter) => textContent(filter?.label || ''))
            .filter(Boolean),
          24
        )
      };
    })
  };

  summary.tokenEstimate = estimateTokens(summary);

  while (summary.tokenEstimate > tokenBudget) {
    let trimmed = false;

    for (let index = summary.routes.length - 1; index >= 0; index -= 1) {
      const route = summary.routes[index];
      const lastModalTrigger = route.modalTriggers[route.modalTriggers.length - 1];

      if (lastModalTrigger?.formFields?.length > 1) {
        lastModalTrigger.formFields.pop();
        trimmed = true;
        break;
      }

      if (route.modalTriggers.length > 2) {
        route.modalTriggers.pop();
        trimmed = true;
        break;
      }

      if (route.buttons.length > 4) {
        route.buttons.pop();
        trimmed = true;
        break;
      }

      if (route.tabs.length > 4) {
        route.tabs.pop();
        trimmed = true;
        break;
      }

      if (route.filters.length > 3) {
        route.filters.pop();
        trimmed = true;
        break;
      }

      if (route.navigationLinks.length > 3) {
        route.navigationLinks.pop();
        trimmed = true;
        break;
      }
    }

    if (!trimmed && summary.routes.length > 1) {
      summary.routes.pop();
      trimmed = true;
    }

    summary.tokenEstimate = estimateTokens(summary);
    if (!trimmed) {
      break;
    }
  }

  return summary;
}

/** Keeps a capability map updated as DOM mutations happen. */
export class DOMScanner {
  private observer: MutationObserver | null = null;
  private updateTimer: number | null = null;

  constructor(private readonly onUpdate: (map: DOMCapabilityMap) => void) {}

  refresh(): DOMCapabilityMap {
    const map = scanDOM();
    this.onUpdate(map);
    return map;
  }

  start(): void {
    if (typeof window === 'undefined' || this.observer) {
      return;
    }

    this.refresh();

    this.observer = new MutationObserver(() => {
      if (this.updateTimer) {
        window.clearTimeout(this.updateTimer);
      }

      this.updateTimer = window.setTimeout(() => {
        this.refresh();
      }, 120);
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      characterData: true
    });
  }

  stop(): void {
    if (this.updateTimer) {
      window.clearTimeout(this.updateTimer);
      this.updateTimer = null;
    }

    this.observer?.disconnect();
    this.observer = null;
  }
}
