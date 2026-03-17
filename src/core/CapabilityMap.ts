import type {
  CompressedCapabilityMap,
  CompressedElementDescriptor,
  DOMCapabilityMap,
  DOMElementDescriptor
} from '../types';

const TOKEN_CAP = 2000;
const MAX_FIELD_LENGTH = 50;
const MAX_HANDLER_COUNT = 4;
const MAX_HINT_COUNT = 4;

function truncate(value: string, maxLength: number = MAX_FIELD_LENGTH): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function estimateTokens(payload: unknown): number {
  return Math.ceil(JSON.stringify(payload).length / 4);
}

function summarizeCollections(
  tableRows: DOMCapabilityMap['tableRows'],
  listItems: DOMCapabilityMap['listItems']
): { tableSummary: string; listSummary: string } {
  const tableCount = tableRows.length;
  const tableExamples = tableRows.slice(0, 3).map((row) => row.columns.join(' | '));
  const tableSummary = tableCount
    ? `Table rows: ${tableCount}. First ${Math.min(3, tableCount)}: ${tableExamples.join(' ; ')}`
    : 'Table rows: 0';

  const listCount = listItems.length;
  const listExamples = listItems.slice(0, 3).map((item) => item.text);
  const listSummary = listCount
    ? `List items: ${listCount}. First ${Math.min(3, listCount)}: ${listExamples.join(' ; ')}`
    : 'List items: 0';

  return { tableSummary, listSummary };
}

function pageSummary(map: Omit<DOMCapabilityMap, 'compressed' | 'updatedAt'>): string {
  const sections = map.headings.slice(0, 4).map((heading) => heading.text).filter(Boolean);
  const title = map.pageTitle || map.currentRoute || 'Unknown page';
  return `Page: ${title}. Sections visible: ${sections.join(', ') || 'None'}`;
}

function propsToHints(props?: DOMElementDescriptor['props']): string[] {
  if (!props) {
    return [];
  }

  return Object.entries(props)
    .filter(([, value]) => value !== null && value !== false && value !== '')
    .slice(0, MAX_HINT_COUNT)
    .map(([key, value]) => `${truncate(key, 18)}=${truncate(String(value), 28)}`);
}

function stateToHints(state?: DOMElementDescriptor['state']): string[] {
  if (!state || !state.length) {
    return [];
  }

  return state
    .slice(0, MAX_HINT_COUNT)
    .map((entry) => truncate(typeof entry === 'object' && entry !== null ? JSON.stringify(entry) : String(entry), 42));
}

function normalizeElement(element: DOMElementDescriptor): CompressedElementDescriptor {
  return {
    id: element.id,
    componentName: truncate(element.componentName || 'anonymous', 40),
    tag: element.tagName,
    type: truncate(element.type || '', 24),
    fillable: Boolean(element.fillable),
    label: truncate(element.label || ''),
    placeholder: truncate(element.placeholder || ''),
    value: truncate(element.value || ''),
    disabled: Boolean(element.disabled),
    ariaLabel: truncate(element.ariaLabel || ''),
    text: truncate(element.text || ''),
    handlers: (element.handlers || []).slice(0, MAX_HANDLER_COUNT).map((handler) => truncate(handler, 42)),
    propHints: propsToHints(element.props),
    stateHints: stateToHints(element.state),
    count: 1
  };
}

function dedupeElements(elements: DOMElementDescriptor[]): {
  compressedElements: CompressedElementDescriptor[];
  selectorMap: Record<string, string>;
} {
  const grouped = new Map<string, CompressedElementDescriptor>();
  const selectorMap: Record<string, string> = {};

  for (const element of elements) {
    const normalized = normalizeElement(element);
    selectorMap[element.id] = element.selector;

    const signature = [
      normalized.componentName,
      normalized.tag,
      normalized.type,
      normalized.fillable ? '1' : '0',
      normalized.label,
      normalized.placeholder,
      normalized.value,
      normalized.disabled ? '1' : '0',
      normalized.ariaLabel,
      normalized.text,
      normalized.handlers.join('|'),
      normalized.propHints.join('|'),
      normalized.stateHints.join('|')
    ].join('|');

    const existing = grouped.get(signature);
    if (existing) {
      existing.count += 1;
      continue;
    }

    grouped.set(signature, normalized);
  }

  return {
    compressedElements: Array.from(grouped.values()),
    selectorMap
  };
}

function elementPriority(element: CompressedElementDescriptor, gazeTargetId: string | null): number {
  let priority = 0;

  const label = `${element.label} ${element.text} ${element.componentName}`.toLowerCase();

  if (element.id === gazeTargetId) {
    priority += 100;
  }

  if (element.tag === 'a' || label.includes('nav') || label.includes('menu') || label.includes('route')) {
    priority += 80;
  }

  if (element.tag === 'input' || element.tag === 'textarea' || element.tag === 'select' || element.tag === 'form') {
    priority += 70;
  }

  if (element.fillable) {
    priority += 35;
  }

  if (element.handlers.some((handler) => handler.toLowerCase().includes('submit'))) {
    priority += 45;
  }

  if (element.tag === 'button' || element.type === 'submit') {
    priority += 60;
  }

  if (element.disabled) {
    priority -= 10;
  }

  return priority;
}

function capElementsByTokenBudget(
  base: Omit<CompressedCapabilityMap, 'elements' | 'tokenEstimate'>,
  elements: CompressedElementDescriptor[],
  tokenCap: number,
  gazeTargetId: string | null
): CompressedCapabilityMap {
  const sorted = [...elements].sort((a, b) => elementPriority(b, gazeTargetId) - elementPriority(a, gazeTargetId));

  let selected = [...sorted];
  let tokenEstimate = estimateTokens({ ...base, elements: selected });

  while (selected.length > 1 && tokenEstimate > tokenCap) {
    selected.pop();
    tokenEstimate = estimateTokens({ ...base, elements: selected });
  }

  return {
    ...base,
    elements: selected,
    tokenEstimate
  };
}

/** Builds a compressed capability map with id-based elements and selector lookup. */
export function buildCompressedCapabilityMap(
  base: Omit<DOMCapabilityMap, 'compressed' | 'updatedAt'>,
  gazeTargetId: string | null = null
): CompressedCapabilityMap {
  const { compressedElements, selectorMap } = dedupeElements(base.elements);
  const summaries = summarizeCollections(base.tableRows, base.listItems);

  const preCappedBase: Omit<CompressedCapabilityMap, 'elements' | 'tokenEstimate'> = {
    pageSummary: pageSummary(base),
    currentRoute: base.currentRoute,
    currentUrl: base.currentUrl,
    routes: base.routes,
    gazeTargetId,
    selectorMap,
    tableSummary: summaries.tableSummary,
    listSummary: summaries.listSummary
  };

  return capElementsByTokenBudget(preCappedBase, compressedElements, TOKEN_CAP, gazeTargetId);
}

/** Builds a capability map object from discovered DOM capabilities. */
export function createCapabilityMap(base: Omit<DOMCapabilityMap, 'compressed' | 'updatedAt'>): DOMCapabilityMap {
  const compressed = buildCompressedCapabilityMap(base);

  return {
    ...base,
    compressed,
    updatedAt: Date.now()
  };
}

/** Finds the element nearest to the provided viewport coordinates. */
export function findClosestElement(
  elements: DOMElementDescriptor[],
  x: number,
  y: number
): DOMElementDescriptor | null {
  if (!elements.length) {
    return null;
  }

  let winner: DOMElementDescriptor | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const element of elements) {
    const centerX = element.rect.x + element.rect.width / 2;
    const centerY = element.rect.y + element.rect.height / 2;
    const distance = Math.hypot(centerX - x, centerY - y);

    if (distance < bestDistance) {
      bestDistance = distance;
      winner = element;
    }
  }

  return winner;
}
