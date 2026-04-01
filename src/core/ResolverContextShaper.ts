import { createCapabilityMap } from './CapabilityMap';
import { summarizeAppMapForResolver } from './DOMScanner';
import {
  applyRedactionRule,
  findMatchingRedactionRule,
  matchesPolicySelectors,
  type ResolvedExocorContextPolicy,
  type ResolvedExocorTrustPolicy
} from './contextPolicy';
import type {
  AppMap,
  AppMapSummary,
  DOMCapabilityMap,
  DOMElementDescriptor,
  IntentResolutionInput,
  ToolCapabilityMap
} from '../types';

type ResolverContextProfile = 'tool_first' | 'navigation' | 'form' | 'retrieval' | 'referential' | 'general';

interface MutableContextCandidate {
  mapBase: Omit<DOMCapabilityMap, 'compressed' | 'updatedAt'>;
  appMap: AppMapSummary | null;
  toolCapabilityMap: ToolCapabilityMap | null;
  runtimeContext?: Record<string, unknown>;
}

export interface ResolverContextDebugReport {
  mode: ResolvedExocorContextPolicy['mode'];
  profile: ResolverContextProfile;
  maxContextTokens: number;
  estimatedTokens: number;
  includedSections: string[];
  droppedSections: string[];
  filteredByNeverSend: number;
  redactedFields: number;
  budgetAdjusted: boolean;
}

export interface ShapedResolverContext {
  input: IntentResolutionInput;
  runtimeContext?: Record<string, unknown>;
  report: ResolverContextDebugReport;
}

const REFERENTIAL_PATTERN = /\b(this|that|it|here|there|these|those)\b/i;
const NAVIGATION_PATTERN = /\b(navigate|go to|open|show|visit|switch to|take me to|bring me to)\b/i;
const FILTER_PATTERN = /\b(filter|tab|view|show only|only)\b/i;
const FORM_PATTERN = /\b(create|add|new|edit|update|fill|submit|save|assign|change|set)\b/i;
const RETRIEVAL_PATTERN = /\b(which|what|find|search|lookup|row|result|list|table|record|ticket|item)\b/i;
const VALUE_PATTERN =
  /\b(?:title|name|priority|status|type|assignee|owner|email|phone|date|time|description|tag|category)\b\s*(?:is|=|:)\s*["']?[^,"'\n]+["']?/i;
const APP_MAP_TOKEN_BUDGETS: Record<ResolvedExocorContextPolicy['mode'], number> = {
  full: 900,
  balanced: 650,
  lean: 420
};
const ELEMENT_LIMITS: Record<ResolvedExocorContextPolicy['mode'], number> = {
  full: 64,
  balanced: 36,
  lean: 16
};
const TOOL_LIMITS: Record<ResolvedExocorContextPolicy['mode'], number> = {
  full: 12,
  balanced: 8,
  lean: 4
};

function estimateTokens(payload: unknown): number {
  return Math.ceil(JSON.stringify(payload).length / 4);
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

function truncate(value: string, maxLength = 120): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function toCommandTokens(command: string): string[] {
  return normalizeCommand(command)
    .toLowerCase()
    .replace(/[^a-z0-9\s/_-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function hasSpecificFieldValues(command: string): boolean {
  return VALUE_PATTERN.test(command);
}

function inferContextProfile(input: IntentResolutionInput, runtimeContext?: Record<string, unknown>): ResolverContextProfile {
  const command = normalizeCommand(input.command);
  const lowerCommand = command.toLowerCase();
  const preferredToolCount = input.toolCapabilityMap?.preferredToolIds?.length || 0;
  const hasSelectedText = typeof runtimeContext?.selectedText === 'string' && runtimeContext.selectedText.trim().length > 0;
  const hasGaze = Boolean(input.gazeTarget || runtimeContext?.gazeTarget);

  if (preferredToolCount === 1 && !REFERENTIAL_PATTERN.test(lowerCommand)) {
    return 'tool_first';
  }

  if (REFERENTIAL_PATTERN.test(lowerCommand) && hasGaze) {
    return 'referential';
  }

  if (FORM_PATTERN.test(lowerCommand) || hasSpecificFieldValues(command)) {
    return 'form';
  }

  if (NAVIGATION_PATTERN.test(lowerCommand) || FILTER_PATTERN.test(lowerCommand)) {
    return 'navigation';
  }

  if (RETRIEVAL_PATTERN.test(lowerCommand) || hasSelectedText) {
    return 'retrieval';
  }

  return 'general';
}

function shouldIncludeSection(
  sectionMode: 'auto' | 'always' | 'never',
  autoEnabled: boolean
): boolean {
  if (sectionMode === 'always') {
    return true;
  }
  if (sectionMode === 'never') {
    return false;
  }
  return autoEnabled;
}

function cloneElement(element: DOMElementDescriptor): DOMElementDescriptor {
  return {
    ...element,
    handlers: element.handlers ? [...element.handlers] : undefined,
    props: element.props ? { ...element.props } : undefined,
    state: element.state ? [...element.state] : undefined,
    rect: { ...element.rect }
  };
}

function selectorMatchesNeverSend(
  trustPolicy: ResolvedExocorTrustPolicy,
  selector: string | null | undefined,
  selectorCandidates?: Array<string | null | undefined>
): boolean {
  return matchesPolicySelectors({
    policySelectors: trustPolicy.neverSend,
    selector,
    selectorCandidates
  });
}

function redactString(
  value: string,
  options: Parameters<typeof applyRedactionRule>[1],
  counters: { redactedFields: number }
): string {
  const nextValue = applyRedactionRule(value, options);
  if (nextValue !== value) {
    counters.redactedFields += 1;
  }
  return nextValue;
}

function scoreElement(
  element: DOMElementDescriptor,
  profile: ResolverContextProfile,
  commandTokens: string[],
  gazeTarget: string | null
): number {
  let score = 0;
  const searchable = `${element.label} ${element.text} ${element.ariaLabel || ''} ${element.componentName || ''}`.toLowerCase();

  if (element.id === gazeTarget) {
    score += 140;
  }

  if (element.fillable) {
    score += profile === 'form' ? 90 : 35;
  }

  if (element.tagName === 'button' || element.role === 'button') {
    score += profile === 'form' || profile === 'navigation' ? 50 : 20;
  }

  if (element.tagName === 'a' || element.role === 'link' || element.href) {
    score += profile === 'navigation' ? 70 : 18;
  }

  if (profile === 'retrieval' && (element.tagName === 'tr' || element.role === 'row')) {
    score += 55;
  }

  if (profile === 'tool_first') {
    score -= 20;
  }

  if (/(create|save|submit|confirm|apply|finish)/i.test(searchable)) {
    score += profile === 'form' ? 60 : 20;
  }

  for (const token of commandTokens) {
    if (!token || token.length < 2) {
      continue;
    }
    if (searchable.includes(token)) {
      score += 10;
    }
  }

  if (element.disabled) {
    score -= 20;
  }

  return score;
}

function shapeElements(
  input: IntentResolutionInput,
  trustPolicy: ResolvedExocorTrustPolicy,
  contextPolicy: ResolvedExocorContextPolicy,
  profile: ResolverContextProfile,
  counters: { filteredByNeverSend: number; redactedFields: number }
): DOMElementDescriptor[] {
  const commandTokens = toCommandTokens(input.command);
  const limitBase = ELEMENT_LIMITS[contextPolicy.mode];
  const limit =
    profile === 'tool_first'
      ? Math.min(limitBase, contextPolicy.mode === 'full' ? 12 : 6)
      : profile === 'navigation'
        ? Math.min(limitBase, contextPolicy.mode === 'full' ? 24 : 12)
        : limitBase;

  return input.map.elements
    .filter((element) => {
      const shouldDrop = selectorMatchesNeverSend(trustPolicy, element.selector, [element.selector]);
      if (shouldDrop) {
        counters.filteredByNeverSend += 1;
      }
      return !shouldDrop;
    })
    .map((element) => {
      const nextElement = cloneElement(element);
      nextElement.label = redactString(
        nextElement.label || '',
        {
          rules: trustPolicy.redact,
          field: 'label',
          selector: nextElement.selector,
          selectorCandidates: [nextElement.selector]
        },
        counters
      );
      nextElement.text = redactString(
        nextElement.text || '',
        {
          rules: trustPolicy.redact,
          field: 'text',
          selector: nextElement.selector,
          selectorCandidates: [nextElement.selector]
        },
        counters
      );
      nextElement.value = redactString(
        nextElement.value || '',
        {
          rules: trustPolicy.redact,
          field: 'value',
          selector: nextElement.selector,
          selectorCandidates: [nextElement.selector]
        },
        counters
      );
      nextElement.placeholder = redactString(
        nextElement.placeholder || '',
        {
          rules: trustPolicy.redact,
          field: 'placeholder',
          selector: nextElement.selector,
          selectorCandidates: [nextElement.selector]
        },
        counters
      );
      nextElement.ariaLabel = redactString(
        nextElement.ariaLabel || '',
        {
          rules: trustPolicy.redact,
          field: 'ariaLabel',
          selector: nextElement.selector,
          selectorCandidates: [nextElement.selector]
        },
        counters
      );
      return nextElement;
    })
    .sort((left, right) => scoreElement(right, profile, commandTokens, input.gazeTarget) - scoreElement(left, profile, commandTokens, input.gazeTarget))
    .slice(0, limit);
}

function shapeToolCapabilityMap(
  toolCapabilityMap: IntentResolutionInput['toolCapabilityMap'],
  currentRoute: string,
  contextPolicy: ResolvedExocorContextPolicy,
  profile: ResolverContextProfile
): ToolCapabilityMap | null {
  if (!toolCapabilityMap?.tools?.length) {
    return null;
  }

  const limitBase = TOOL_LIMITS[contextPolicy.mode];
  const limit = profile === 'tool_first' ? Math.max(limitBase, 6) : limitBase;
  const preferredToolIds = new Set(toolCapabilityMap.preferredToolIds || []);
  const prioritized = [...toolCapabilityMap.tools].sort((left, right) => {
    const leftPreferred = preferredToolIds.has(left.id) ? 1 : 0;
    const rightPreferred = preferredToolIds.has(right.id) ? 1 : 0;
    if (leftPreferred !== rightPreferred) {
      return rightPreferred - leftPreferred;
    }
    const leftRoute = left.currentRouteMatches || left.routes.includes(currentRoute) ? 1 : 0;
    const rightRoute = right.currentRouteMatches || right.routes.includes(currentRoute) ? 1 : 0;
    if (leftRoute !== rightRoute) {
      return rightRoute - leftRoute;
    }
    return (right.semanticScore || 0) - (left.semanticScore || 0);
  });

  const selected = prioritized.slice(0, limit);
  const selectedIds = new Set(selected.map((tool) => tool.id));

  return {
    currentRoute: toolCapabilityMap.currentRoute,
    preferredToolIds: toolCapabilityMap.preferredToolIds.filter((toolId) => selectedIds.has(toolId)),
    tools: selected
  };
}

function filterAndSummarizeAppMap(
  appMap: AppMap | AppMapSummary | null | undefined,
  currentRoute: string,
  contextPolicy: ResolvedExocorContextPolicy,
  trustPolicy: ResolvedExocorTrustPolicy,
  counters: { filteredByNeverSend: number; redactedFields: number }
): AppMapSummary | null {
  if (!appMap) {
    return null;
  }

  if ('tokenEstimate' in appMap) {
    return summarizeAppMapForResolver(appMap, currentRoute, APP_MAP_TOKEN_BUDGETS[contextPolicy.mode]);
  }

  const filteredRoutes = appMap.routes.map((route) => ({
    ...route,
    navigationLinks: route.navigationLinks
      .filter((entry) => {
        const shouldDrop = selectorMatchesNeverSend(trustPolicy, entry.elementId, entry.selectorCandidates);
        if (shouldDrop) {
          counters.filteredByNeverSend += 1;
        }
        return !shouldDrop;
      })
      .map((entry) => ({
        ...entry,
        label: redactString(
          entry.label || '',
          {
            rules: trustPolicy.redact,
            field: 'label',
            selector: entry.elementId,
            selectorCandidates: entry.selectorCandidates
          },
          counters
        )
      })),
    modalTriggers: route.modalTriggers
      .filter((trigger) => {
        const shouldDrop = selectorMatchesNeverSend(trustPolicy, trigger.elementId, trigger.selectorCandidates);
        if (shouldDrop) {
          counters.filteredByNeverSend += 1;
        }
        return !shouldDrop;
      })
      .map((trigger) => ({
        ...trigger,
        label: redactString(
          trigger.label || '',
          {
            rules: trustPolicy.redact,
            field: 'label',
            selector: trigger.elementId,
            selectorCandidates: trigger.selectorCandidates
          },
          counters
        ),
        modalContents: {
          formFields: trigger.modalContents.formFields
            .filter((field) => {
              const candidates = [field.elementId, ...(field.selectorCandidates || [])];
              const shouldDrop = selectorMatchesNeverSend(trustPolicy, field.elementId, candidates);
              if (shouldDrop) {
                counters.filteredByNeverSend += 1;
              }
              return !shouldDrop;
            })
            .map((field) => ({
              ...field,
              label: redactString(
                field.label || '',
                {
                  rules: trustPolicy.redact,
                  field: 'label',
                  selector: field.elementId,
                  selectorCandidates: field.selectorCandidates
                },
                counters
              )
            })),
          buttons: trigger.modalContents.buttons
            .filter((button) => {
              const candidates = [button.elementId, ...(button.selectorCandidates || [])];
              const shouldDrop = selectorMatchesNeverSend(trustPolicy, button.elementId, candidates);
              if (shouldDrop) {
                counters.filteredByNeverSend += 1;
              }
              return !shouldDrop;
            })
            .map((button) => ({
              ...button,
              label: redactString(
                button.label || '',
                {
                  rules: trustPolicy.redact,
                  field: 'label',
                  selector: button.elementId,
                  selectorCandidates: button.selectorCandidates
                },
                counters
              )
            }))
        }
      })),
    formFields: route.formFields
      .filter((field) => {
        const candidates = [field.elementId, ...(field.selectorCandidates || [])];
        const shouldDrop = selectorMatchesNeverSend(trustPolicy, field.elementId, candidates);
        if (shouldDrop) {
          counters.filteredByNeverSend += 1;
        }
        return !shouldDrop;
      })
      .map((field) => ({
        ...field,
        label: redactString(
          field.label || '',
          {
            rules: trustPolicy.redact,
            field: 'label',
            selector: field.elementId,
            selectorCandidates: field.selectorCandidates
          },
          counters
        )
      })),
    buttons: route.buttons
      .filter((button) => {
        const candidates = [button.elementId, ...(button.selectorCandidates || [])];
        const shouldDrop = selectorMatchesNeverSend(trustPolicy, button.elementId, candidates);
        if (shouldDrop) {
          counters.filteredByNeverSend += 1;
        }
        return !shouldDrop;
      })
      .map((button) => ({
        ...button,
        label: redactString(
          button.label || '',
          {
            rules: trustPolicy.redact,
            field: 'label',
            selector: button.elementId,
            selectorCandidates: button.selectorCandidates
          },
          counters
        )
      })),
    filters: route.filters
      .filter((filter) => {
        const candidates = [filter.elementId, ...(filter.selectorCandidates || [])];
        const shouldDrop = selectorMatchesNeverSend(trustPolicy, filter.elementId, candidates);
        if (shouldDrop) {
          counters.filteredByNeverSend += 1;
        }
        return !shouldDrop;
      })
      .map((filter) => ({
        ...filter,
        label: redactString(
          filter.label || '',
          {
            rules: trustPolicy.redact,
            field: 'label',
            selector: filter.elementId,
            selectorCandidates: filter.selectorCandidates
          },
          counters
        ),
        options: filter.options.map((option) =>
          redactString(
            option || '',
            {
              rules: trustPolicy.redact,
              field: 'label',
              selector: filter.elementId,
              selectorCandidates: filter.selectorCandidates
            },
            counters
          )
        )
      })),
    tabs: route.tabs
      .filter((tab) => {
        const candidates = [tab.elementId, ...(tab.selectorCandidates || [])];
        const shouldDrop = selectorMatchesNeverSend(trustPolicy, tab.elementId, candidates);
        if (shouldDrop) {
          counters.filteredByNeverSend += 1;
        }
        return !shouldDrop;
      })
      .map((tab) => ({
        ...tab,
        label: redactString(
          tab.label || '',
          {
            rules: trustPolicy.redact,
            field: 'label',
            selector: tab.elementId,
            selectorCandidates: tab.selectorCandidates
          },
          counters
        )
      })),
    locators: (route.locators || []).filter((locator) => {
      const shouldDrop = selectorMatchesNeverSend(trustPolicy, null, locator.selectorCandidates);
      if (shouldDrop) {
        counters.filteredByNeverSend += 1;
      }
      return !shouldDrop;
    })
  }));

  return summarizeAppMapForResolver(
    {
      ...appMap,
      routes: filteredRoutes
    },
    currentRoute,
    APP_MAP_TOKEN_BUDGETS[contextPolicy.mode]
  );
}

function toTransportMap(map: DOMCapabilityMap): DOMCapabilityMap {
  const compressed = {
    ...map.compressed,
    elements: [],
    selectorMap: {},
    tokenEstimate: estimateTokens({
      pageSummary: map.compressed.pageSummary,
      currentRoute: map.compressed.currentRoute,
      currentUrl: map.compressed.currentUrl,
      routes: map.compressed.routes,
      gazeTargetId: map.compressed.gazeTargetId,
      tableSummary: map.compressed.tableSummary,
      listSummary: map.compressed.listSummary
    })
  };

  return {
    ...map,
    compressed
  };
}

function buildRuntimeContext(
  input: IntentResolutionInput,
  runtimeContext: Record<string, unknown> | undefined,
  sections: {
    forms: boolean;
    gaze: boolean;
    selectedText: boolean;
  },
  trustPolicy: ResolvedExocorTrustPolicy
): Record<string, unknown> | undefined {
  if (!runtimeContext) {
    return undefined;
  }

  const nextContext: Record<string, unknown> = {};
  if (typeof runtimeContext.inputMethod === 'string') {
    nextContext.inputMethod = runtimeContext.inputMethod;
  }

  if (sections.selectedText && typeof runtimeContext.selectedText === 'string' && runtimeContext.selectedText.trim()) {
    nextContext.selectedText = truncate(runtimeContext.selectedText.trim(), 200);
  }

  if (sections.gaze && runtimeContext.gazeTarget && typeof runtimeContext.gazeTarget === 'object') {
    nextContext.gazeTarget = runtimeContext.gazeTarget;
  }
  if (sections.gaze && runtimeContext.gazePosition && typeof runtimeContext.gazePosition === 'object') {
    nextContext.gazePosition = runtimeContext.gazePosition;
  }

  if (
    (sections.forms || sections.selectedText || input.inputMethod === 'text') &&
    runtimeContext.focusedElement &&
    typeof runtimeContext.focusedElement === 'object'
  ) {
    const focusedElement = runtimeContext.focusedElement as Record<string, unknown>;
    const elementId = typeof focusedElement.elementId === 'string' ? focusedElement.elementId : '';
    const originalElement = input.map.elements.find((element) => element.id === elementId) || null;
    const shouldDropFocusedElement =
      originalElement &&
      matchesPolicySelectors({
        policySelectors: trustPolicy.neverSend,
        selector: originalElement.selector,
        selectorCandidates: [originalElement.selector]
      });

    if (!shouldDropFocusedElement) {
      nextContext.focusedElement = focusedElement;
    }
  }

  return Object.keys(nextContext).length ? nextContext : undefined;
}

function createInitialCandidate(
  input: IntentResolutionInput,
  runtimeContext: Record<string, unknown> | undefined,
  contextPolicy: ResolvedExocorContextPolicy,
  trustPolicy: ResolvedExocorTrustPolicy,
  profile: ResolverContextProfile,
  counters: { filteredByNeverSend: number; redactedFields: number }
): { candidate: MutableContextCandidate; includedSections: string[]; droppedSections: string[] } {
  const hasOpenDialogs = input.map.dialogs.some((dialog) => dialog.isOpen);
  const includeAppMap = shouldIncludeSection(contextPolicy.sections.appMap, true);
  const includeTools = shouldIncludeSection(contextPolicy.sections.tools, Boolean(input.toolCapabilityMap?.tools?.length));
  const includeForms = shouldIncludeSection(
    contextPolicy.sections.forms,
    input.map.formState.length > 0 && (profile === 'form' || profile === 'general')
  );
  const includeDialogs = shouldIncludeSection(
    contextPolicy.sections.dialogs,
    hasOpenDialogs && (profile === 'form' || profile === 'general')
  );
  const includeTablesAndLists = shouldIncludeSection(
    contextPolicy.sections.tablesAndLists,
    (input.map.tableRows.length > 0 || input.map.listItems.length > 0) && profile === 'retrieval'
  );
  const includeGaze = shouldIncludeSection(
    contextPolicy.sections.gaze,
    input.inputMethod === 'voice' &&
      (contextPolicy.mode === 'full' || profile === 'referential' || Boolean(runtimeContext?.gazeTarget || input.gazeTarget))
  );
  const includeSelectedText = shouldIncludeSection(
    contextPolicy.sections.selectedText,
    typeof runtimeContext?.selectedText === 'string' && runtimeContext.selectedText.trim().length > 0
  );
  const includeLiveDom = shouldIncludeSection(
    contextPolicy.sections.liveDom,
    trustPolicy.features.liveDomScanning &&
      (profile === 'form' || profile === 'retrieval' || profile === 'referential' || contextPolicy.mode === 'full')
  );

  const preserveFormValues = profile === 'form' || hasSpecificFieldValues(input.command);
  const elements = trustPolicy.features.liveDomScanning && includeLiveDom
    ? shapeElements(input, trustPolicy, contextPolicy, profile, counters)
    : [];

  const navigation = input.map.navigation
    .filter((entry) => {
      const shouldDrop = selectorMatchesNeverSend(trustPolicy, entry.selector, [entry.selector]);
      if (shouldDrop) {
        counters.filteredByNeverSend += 1;
      }
      return !shouldDrop;
    })
    .slice(0, contextPolicy.mode === 'lean' ? 8 : 16)
    .map((entry) => ({
      ...entry,
      label: redactString(
        entry.label || '',
        {
          rules: trustPolicy.redact,
          field: 'label',
          selector: entry.selector,
          selectorCandidates: [entry.selector]
        },
        counters
      )
    }));

  const formState = includeForms
    ? input.map.formState
        .filter((field) => {
          const shouldDrop = selectorMatchesNeverSend(trustPolicy, field.selector, [field.selector]);
          if (shouldDrop) {
            counters.filteredByNeverSend += 1;
          }
          return !shouldDrop;
        })
        .slice(0, contextPolicy.mode === 'lean' ? 8 : 20)
        .map((field) => ({
          ...field,
          label: redactString(
            field.label || '',
            {
              rules: trustPolicy.redact,
              field: 'label',
              selector: field.selector,
              selectorCandidates: [field.selector]
            },
            counters
          ),
          name: redactString(
            field.name || '',
            {
              rules: trustPolicy.redact,
              field: 'name',
              selector: field.selector,
              selectorCandidates: [field.selector]
            },
            counters
          ),
          value: preserveFormValues
            ? redactString(
                field.value || '',
                {
                  rules: trustPolicy.redact,
                  field: 'value',
                  selector: field.selector,
                  selectorCandidates: [field.selector]
                },
                counters
              )
            : ''
        }))
    : [];

  const buttonsState = input.map.buttonsState
    .filter((button) => {
      const shouldDrop = selectorMatchesNeverSend(trustPolicy, button.selector, [button.selector]);
      if (shouldDrop) {
        counters.filteredByNeverSend += 1;
      }
      return !shouldDrop;
    })
    .slice(0, contextPolicy.mode === 'lean' ? 8 : 20)
    .map((button) => ({
      ...button,
      label: redactString(
        button.label || '',
        {
          rules: trustPolicy.redact,
          field: 'label',
          selector: button.selector,
          selectorCandidates: [button.selector]
        },
        counters
      )
    }));

  const dialogs = includeDialogs
    ? input.map.dialogs
        .filter((dialog) => dialog.isOpen)
        .filter((dialog) => {
          const shouldDrop = selectorMatchesNeverSend(trustPolicy, dialog.selector, [dialog.selector]);
          if (shouldDrop) {
            counters.filteredByNeverSend += 1;
          }
          return !shouldDrop;
        })
        .slice(0, 4)
        .map((dialog) => ({
          ...dialog,
          label: redactString(
            dialog.label || '',
            {
              rules: trustPolicy.redact,
              field: 'label',
              selector: dialog.selector,
              selectorCandidates: [dialog.selector]
            },
            counters
          )
        }))
    : [];

  const candidate: MutableContextCandidate = {
    mapBase: {
      elements,
      routes: input.map.routes.slice(0, contextPolicy.mode === 'lean' ? 6 : 12),
      currentRoute: input.map.currentRoute,
      currentUrl: input.map.currentUrl,
      routeParams: { ...input.map.routeParams },
      pageTitle: input.map.pageTitle,
      headings: input.map.headings.slice(0, contextPolicy.mode === 'lean' ? 3 : 6),
      navigation,
      formState,
      buttonsState,
      visibleErrors: input.map.visibleErrors.slice(0, 4),
      dialogs,
      tableRows: includeTablesAndLists ? input.map.tableRows.slice(0, contextPolicy.mode === 'lean' ? 2 : 6) : [],
      listItems: includeTablesAndLists ? input.map.listItems.slice(0, contextPolicy.mode === 'lean' ? 3 : 8) : [],
      cards: profile === 'retrieval' && contextPolicy.mode !== 'lean' ? input.map.cards.slice(0, 4) : [],
      statusBadges: profile === 'retrieval' ? input.map.statusBadges.slice(0, 6) : [],
      stateHints: contextPolicy.mode === 'full' ? input.map.stateHints.slice(0, 8) : [],
      activeItems: profile === 'navigation' ? input.map.activeItems.slice(0, 6) : [],
      countBadges: profile === 'retrieval' ? input.map.countBadges.slice(0, 6) : []
    },
    appMap: includeAppMap
      ? filterAndSummarizeAppMap(input.appMap || null, input.map.currentRoute, contextPolicy, trustPolicy, counters)
      : null,
    toolCapabilityMap: includeTools && trustPolicy.features.tools
      ? shapeToolCapabilityMap(input.toolCapabilityMap || null, input.map.currentRoute, contextPolicy, profile)
      : null,
    runtimeContext: buildRuntimeContext(
      input,
      runtimeContext,
      {
        forms: includeForms,
        gaze: includeGaze,
        selectedText: includeSelectedText
      },
      trustPolicy
    )
  };

  const includedSections = [
    candidate.appMap ? 'appMap' : null,
    candidate.mapBase.elements.length ? 'liveDom' : null,
    candidate.mapBase.dialogs.length ? 'dialogs' : null,
    candidate.mapBase.formState.length ? 'forms' : null,
    candidate.mapBase.tableRows.length || candidate.mapBase.listItems.length ? 'tablesAndLists' : null,
    candidate.runtimeContext?.gazeTarget ? 'gaze' : null,
    candidate.runtimeContext?.selectedText ? 'selectedText' : null,
    candidate.toolCapabilityMap?.tools.length ? 'tools' : null
  ].filter((value): value is string => Boolean(value));

  const droppedSections = [
    includeAppMap ? null : 'appMap',
    includeLiveDom ? null : 'liveDom',
    includeDialogs ? null : 'dialogs',
    includeForms ? null : 'forms',
    includeTablesAndLists ? null : 'tablesAndLists',
    includeGaze ? null : 'gaze',
    includeSelectedText ? null : 'selectedText',
    includeTools && trustPolicy.features.tools ? null : 'tools'
  ].filter((value): value is string => Boolean(value));

  return {
    candidate,
    includedSections,
    droppedSections
  };
}

function estimateCandidateTokens(input: IntentResolutionInput, candidate: MutableContextCandidate): number {
  const payload = {
    command: input.command,
    inputMethod: input.inputMethod,
    map: {
      ...candidate.mapBase,
      compressed: null
    },
    appMap: candidate.appMap,
    toolCapabilityMap: candidate.toolCapabilityMap,
    gazeTarget: input.gazeTarget,
    gesture: input.gesture,
    completedSteps: input.completedSteps,
    runtimeContext: candidate.runtimeContext
  };

  return estimateTokens(payload);
}

function applyBudgetWaterfall(
  input: IntentResolutionInput,
  candidate: MutableContextCandidate,
  contextPolicy: ResolvedExocorContextPolicy
): boolean {
  let changed = false;

  while (estimateCandidateTokens(input, candidate) > contextPolicy.maxContextTokens) {
    const before = estimateCandidateTokens(input, candidate);

    if (candidate.mapBase.cards.length) {
      candidate.mapBase.cards = [];
    } else if (candidate.mapBase.statusBadges.length) {
      candidate.mapBase.statusBadges = [];
    } else if (candidate.mapBase.stateHints.length) {
      candidate.mapBase.stateHints = [];
    } else if (candidate.mapBase.countBadges.length) {
      candidate.mapBase.countBadges = [];
    } else if (candidate.mapBase.activeItems.length) {
      candidate.mapBase.activeItems = [];
    } else if (candidate.mapBase.tableRows.length > 1) {
      candidate.mapBase.tableRows = candidate.mapBase.tableRows.slice(0, Math.max(1, Math.floor(candidate.mapBase.tableRows.length / 2)));
    } else if (candidate.mapBase.listItems.length > 2) {
      candidate.mapBase.listItems = candidate.mapBase.listItems.slice(0, Math.max(2, Math.floor(candidate.mapBase.listItems.length / 2)));
    } else if (candidate.mapBase.formState.some((field) => field.value)) {
      candidate.mapBase.formState = candidate.mapBase.formState.map((field) => ({ ...field, value: '' }));
    } else if (candidate.mapBase.buttonsState.length > 6) {
      candidate.mapBase.buttonsState = candidate.mapBase.buttonsState.slice(0, 6);
    } else if (candidate.mapBase.elements.length > 4 && contextPolicy.sections.liveDom !== 'always') {
      candidate.mapBase.elements = candidate.mapBase.elements.slice(0, Math.max(4, Math.floor(candidate.mapBase.elements.length / 2)));
    } else if (candidate.appMap && candidate.appMap.routes.length > 2 && contextPolicy.sections.appMap !== 'always') {
      candidate.appMap = {
        ...candidate.appMap,
        routes: candidate.appMap.routes.slice(0, candidate.appMap.routes.length - 1)
      };
      candidate.appMap.tokenEstimate = estimateTokens(candidate.appMap);
    } else if (candidate.runtimeContext?.selectedText && contextPolicy.sections.selectedText !== 'always') {
      delete candidate.runtimeContext.selectedText;
      if (!Object.keys(candidate.runtimeContext).length) {
        candidate.runtimeContext = undefined;
      }
    } else if (candidate.runtimeContext?.gazeTarget && contextPolicy.sections.gaze !== 'always') {
      delete candidate.runtimeContext.gazeTarget;
      delete candidate.runtimeContext.gazePosition;
      if (!Object.keys(candidate.runtimeContext || {}).length) {
        candidate.runtimeContext = undefined;
      }
    } else if (candidate.toolCapabilityMap && candidate.toolCapabilityMap.tools.length > 3 && contextPolicy.sections.tools !== 'always') {
      const keepIds = new Set(candidate.toolCapabilityMap.preferredToolIds);
      const trimmedTools = candidate.toolCapabilityMap.tools.filter((tool, index) => keepIds.has(tool.id) || index < 3);
      candidate.toolCapabilityMap = {
        ...candidate.toolCapabilityMap,
        tools: trimmedTools
      };
    } else {
      break;
    }

    const after = estimateCandidateTokens(input, candidate);
    if (after >= before) {
      break;
    }
    changed = true;
  }

  return changed;
}

export function shapeResolverContext(options: {
  input: IntentResolutionInput;
  runtimeContext?: Record<string, unknown>;
  contextPolicy: ResolvedExocorContextPolicy;
  trustPolicy: ResolvedExocorTrustPolicy;
}): ShapedResolverContext {
  const { input, runtimeContext, contextPolicy, trustPolicy } = options;
  const profile = inferContextProfile(input, runtimeContext);
  const counters = {
    filteredByNeverSend: 0,
    redactedFields: 0
  };

  const { candidate, includedSections, droppedSections } = createInitialCandidate(
    input,
    runtimeContext,
    contextPolicy,
    trustPolicy,
    profile,
    counters
  );
  const budgetAdjusted = applyBudgetWaterfall(input, candidate, contextPolicy);
  const shapedMap = toTransportMap(createCapabilityMap(candidate.mapBase));
  const shapedInput: IntentResolutionInput = {
    ...input,
    map: shapedMap,
    appMap: candidate.appMap,
    toolCapabilityMap: candidate.toolCapabilityMap
  };
  const report: ResolverContextDebugReport = {
    mode: contextPolicy.mode,
    profile,
    maxContextTokens: contextPolicy.maxContextTokens,
    estimatedTokens: estimateTokens({
      input: shapedInput,
      runtimeContext: candidate.runtimeContext
    }),
    includedSections,
    droppedSections,
    filteredByNeverSend: counters.filteredByNeverSend,
    redactedFields: counters.redactedFields,
    budgetAdjusted
  };

  return {
    input: shapedInput,
    runtimeContext: candidate.runtimeContext,
    report
  };
}

export function shapeResolverNewElementsForTransport(options: {
  command: string;
  elements: DOMElementDescriptor[];
  gazeTarget?: string | null;
  contextPolicy: ResolvedExocorContextPolicy;
  trustPolicy: ResolvedExocorTrustPolicy;
}): DOMElementDescriptor[] {
  const counters = {
    filteredByNeverSend: 0,
    redactedFields: 0
  };

  return shapeElements(
    {
      command: options.command,
      inputMethod: 'text',
      map: createCapabilityMap({
        elements: options.elements,
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
        countBadges: []
      }),
      appMap: null,
      toolCapabilityMap: null,
      gazeTarget: options.gazeTarget || null,
      gesture: 'none'
    },
    options.trustPolicy,
    options.contextPolicy,
    inferContextProfile(
      {
        command: options.command,
        inputMethod: 'text',
        map: createCapabilityMap({
          elements: options.elements,
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
          countBadges: []
        }),
        appMap: null,
        toolCapabilityMap: null,
        gazeTarget: options.gazeTarget || null,
        gesture: 'none'
      },
      undefined
    ),
    counters
  );
}
