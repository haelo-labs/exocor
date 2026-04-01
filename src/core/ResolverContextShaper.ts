import { createCapabilityMap } from './CapabilityMap';
import { summarizeAppMapForResolver } from './DOMScanner';
import {
  buildNewElementsUserPrompt,
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
  buildPreferredToolIntentSystemPrompt,
  buildPreferredToolIntentUserPrompt,
  buildPromptContext,
  buildResolveUserPrompt,
  buildRuntimeStateSnapshot,
  estimateResolverRequestTokens
} from './resolverPrompts';
import {
  applyRedactionRule,
  matchesPolicySelectors,
  type ResolvedExocorTrustPolicy
} from './contextPolicy';
import type {
  AppMap,
  AppMapSummary,
  DOMCapabilityMap,
  DOMElementDescriptor,
  IntentResolutionInput,
  IntentStep,
  ToolCapabilityMap,
  ToolCapabilityEntry
} from '../types';

type ResolverContextProfile = 'tool_first' | 'navigation' | 'form' | 'retrieval' | 'referential' | 'general';
export type ResolverRequestKind = 'plan' | 'resolve' | 'failed_step' | 'new_elements' | 'preferred_tool_intent';

interface ResolverBudgetConfig {
  targetTokens: number;
  appMapTokenBudget: number;
  elementLimit: number;
  toolLimit: number;
  routeLimit: number;
  headingLimit: number;
  navigationLimit: number;
  formLimit: number;
  buttonLimit: number;
  dialogLimit: number;
  tableRowLimit: number;
  listItemLimit: number;
  cardLimit: number;
  badgeLimit: number;
  stateHintLimit: number;
  includeLiveDom: boolean;
  includeTablesAndLists: boolean;
  includeSelectedText: boolean;
  includeGaze: boolean;
}

interface MutableContextCandidate {
  mapBase: Omit<DOMCapabilityMap, 'compressed' | 'updatedAt'>;
  appMap: AppMapSummary | null;
  toolCapabilityMap: ToolCapabilityMap | null;
  runtimeContext?: Record<string, unknown>;
}

export interface ResolverContextDebugReport {
  requestKind: ResolverRequestKind;
  profile: ResolverContextProfile;
  targetTokens: number;
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

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

function truncate(value: string | null | undefined, maxLength = 120): string {
  const normalized = value || '';
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
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

function buildBudgetConfig(requestKind: ResolverRequestKind, profile: ResolverContextProfile): ResolverBudgetConfig {
  const plannerRequest = requestKind === 'plan' || requestKind === 'resolve';
  const lowBudgetRequest = requestKind === 'failed_step' || requestKind === 'new_elements' || requestKind === 'preferred_tool_intent';

  return {
    targetTokens: plannerRequest ? 5000 : 3000,
    appMapTokenBudget: requestKind === 'preferred_tool_intent' ? 450 : plannerRequest ? 1050 : 700,
    elementLimit:
      requestKind === 'preferred_tool_intent'
        ? 4
        : profile === 'form'
          ? plannerRequest
            ? 12
            : 8
          : profile === 'retrieval'
            ? plannerRequest
              ? 12
              : 8
            : profile === 'referential'
              ? 10
              : profile === 'navigation'
                ? 8
                : profile === 'tool_first'
                  ? 6
                  : 9,
    toolLimit:
      requestKind === 'preferred_tool_intent'
        ? 1
        : profile === 'tool_first'
          ? 3
          : lowBudgetRequest
            ? 2
            : 4,
    routeLimit: plannerRequest ? 6 : 4,
    headingLimit: plannerRequest ? 4 : 2,
    navigationLimit: plannerRequest ? 10 : 6,
    formLimit: profile === 'form' ? (plannerRequest ? 10 : 6) : plannerRequest ? 4 : 3,
    buttonLimit: profile === 'form' || profile === 'navigation' ? (plannerRequest ? 8 : 5) : plannerRequest ? 5 : 4,
    dialogLimit: profile === 'form' ? 3 : 2,
    tableRowLimit: profile === 'retrieval' ? (plannerRequest ? 3 : 2) : 0,
    listItemLimit: profile === 'retrieval' ? (plannerRequest ? 5 : 3) : 0,
    cardLimit: profile === 'retrieval' && plannerRequest ? 2 : 0,
    badgeLimit: profile === 'retrieval' || profile === 'navigation' ? 4 : 0,
    stateHintLimit: profile === 'form' || profile === 'navigation' ? 4 : 2,
    includeLiveDom:
      requestKind !== 'preferred_tool_intent' &&
      (profile === 'form' || profile === 'retrieval' || profile === 'referential' || profile === 'general'),
    includeTablesAndLists: profile === 'retrieval',
    includeSelectedText: profile === 'retrieval' || profile === 'general',
    includeGaze: profile === 'referential'
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

function compactTransportElement(element: DOMElementDescriptor): DOMElementDescriptor {
  return {
    id: element.id,
    selector: element.selector,
    label: truncate(element.label, 64),
    text: truncate(element.text, 80),
    fillable: element.fillable,
    componentName: element.componentName ? truncate(element.componentName, 48) : null,
    handlers: element.handlers ? [...element.handlers].slice(0, 2) : undefined,
    role: element.role,
    tagName: element.tagName,
    type: element.type,
    ariaLabel: truncate(element.ariaLabel, 48),
    placeholder: truncate(element.placeholder, 48),
    value: truncate(element.value, 56),
    disabled: element.disabled,
    rect: { ...element.rect }
  };
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
    score += profile === 'form' ? 100 : 25;
  }

  if (element.tagName === 'button' || element.role === 'button') {
    score += profile === 'form' || profile === 'navigation' ? 48 : 18;
  }

  if (element.tagName === 'a' || element.role === 'link' || element.href) {
    score += profile === 'navigation' ? 70 : 14;
  }

  if (profile === 'retrieval' && (element.tagName === 'tr' || element.role === 'row')) {
    score += 48;
  }

  if (profile === 'tool_first') {
    score -= 20;
  }

  if (/(create|save|submit|confirm|apply|finish)/i.test(searchable)) {
    score += profile === 'form' ? 40 : 12;
  }

  for (const token of commandTokens) {
    if (token.length > 1 && searchable.includes(token)) {
      score += 10;
    }
  }

  if (element.disabled) {
    score -= 16;
  }

  return score;
}

function shapeElements(
  input: IntentResolutionInput,
  trustPolicy: ResolvedExocorTrustPolicy,
  budget: ResolverBudgetConfig,
  profile: ResolverContextProfile,
  counters: { filteredByNeverSend: number; redactedFields: number }
): DOMElementDescriptor[] {
  const commandTokens = toCommandTokens(input.command);

  return input.map.elements
    .filter((element) => {
      const shouldDrop = selectorMatchesNeverSend(trustPolicy, element.selector, [element.selector]);
      if (shouldDrop) {
        counters.filteredByNeverSend += 1;
      }
      return !shouldDrop;
    })
    .map((element) => {
      const nextElement = compactTransportElement(element);
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
    .slice(0, budget.elementLimit);
}

function trimToolParameterOptions(options: string[] | undefined): string[] | undefined {
  if (!Array.isArray(options) || !options.length) {
    return undefined;
  }

  return options.slice(0, 6).map((option) => truncate(option, 24));
}

function compactToolEntry(tool: ToolCapabilityEntry): ToolCapabilityEntry {
  return {
    ...tool,
    description: truncate(tool.description, 72),
    parameters: (tool.parameters || []).slice(0, 8).map((parameter) => ({
      ...parameter,
      description: truncate(parameter.description, 40),
      ...(trimToolParameterOptions(parameter.options) ? { options: trimToolParameterOptions(parameter.options) } : {})
    })),
    routes: (tool.routes || []).slice(0, 2),
    preferredReason: undefined
  };
}

function prioritizeTool(
  tool: ToolCapabilityEntry,
  currentRoute: string,
  preferredToolIds: Set<string>,
  commandTokens: string[]
): number {
  let score = tool.semanticScore || 0;

  if (preferredToolIds.has(tool.id)) {
    score += 100;
  }
  if (tool.preferredForCommand) {
    score += 40;
  }
  if (tool.currentRouteMatches || tool.routes.includes(currentRoute)) {
    score += 20;
  }
  if (tool.isGlobal) {
    score += 8;
  }

  const searchable = `${tool.id} ${tool.description} ${(tool.parameters || []).map((parameter) => `${parameter.name} ${parameter.description || ''}`).join(' ')}`.toLowerCase();
  for (const token of commandTokens) {
    if (token.length > 1 && searchable.includes(token)) {
      score += 6;
    }
  }

  return score;
}

function shapeToolCapabilityMap(
  toolCapabilityMap: IntentResolutionInput['toolCapabilityMap'],
  currentRoute: string,
  budget: ResolverBudgetConfig,
  profile: ResolverContextProfile,
  command: string,
  requestKind: ResolverRequestKind
): ToolCapabilityMap | null {
  if (!toolCapabilityMap?.tools?.length) {
    return null;
  }

  const preferredToolIds = new Set(toolCapabilityMap.preferredToolIds || []);
  const commandTokens = toCommandTokens(command);
  const limit = requestKind === 'preferred_tool_intent'
    ? 1
    : profile === 'tool_first'
      ? Math.max(2, budget.toolLimit)
      : budget.toolLimit;

  const prioritized = [...toolCapabilityMap.tools]
    .sort((left, right) => prioritizeTool(right, currentRoute, preferredToolIds, commandTokens) - prioritizeTool(left, currentRoute, preferredToolIds, commandTokens))
    .slice(0, limit)
    .map((tool) => compactToolEntry(tool));

  const selectedIds = new Set(prioritized.map((tool) => tool.id));

  return {
    currentRoute: toolCapabilityMap.currentRoute,
    preferredToolIds: (toolCapabilityMap.preferredToolIds || []).filter((toolId) => selectedIds.has(toolId)),
    tools: prioritized
  };
}

function normalizeRouteTokens(value: unknown): string[] {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, ' ')
    .split(/\s+/)
    .map((token) => token.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .map((token) => token.replace(/[-_]/g, ' '))
    .flatMap((token) => token.split(/\s+/))
    .map((token) => token.replace(/s$/, ''))
    .filter((token) => token.length > 1);
}

function routeEntryLabel(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (!value || typeof value !== 'object') {
    return '';
  }

  const record = value as Record<string, unknown>;
  if (typeof record.label === 'string') {
    return record.label;
  }
  if (typeof record.path === 'string') {
    return record.path;
  }
  if (typeof record.title === 'string') {
    return record.title;
  }

  return '';
}

function inferAnchorRoute(
  command: string,
  appMap: AppMap | AppMapSummary | null | undefined,
  currentRoute: string,
  toolCapabilityMap: ToolCapabilityMap | null
): string | null {
  const preferredTool = toolCapabilityMap?.tools.find((tool) => (toolCapabilityMap.preferredToolIds || []).includes(tool.id));
  if (preferredTool && !preferredTool.currentRouteMatches && !preferredTool.isGlobal && preferredTool.routes.length) {
    return preferredTool.routes[0] || null;
  }

  if (!appMap?.routes?.length) {
    return null;
  }

  const commandTokens = new Set(normalizeRouteTokens(command));
  let bestRoute: string | null = null;
  let bestScore = 0;

  for (const route of appMap.routes) {
    const routeTokens = new Set<string>();
    normalizeRouteTokens(route.path).forEach((token) => routeTokens.add(token));
    normalizeRouteTokens(route.title).forEach((token) => routeTokens.add(token));
    route.navigationLinks.forEach((entry) => normalizeRouteTokens(entry.label).forEach((token) => routeTokens.add(token)));
    route.buttons.forEach((entry) => normalizeRouteTokens(routeEntryLabel(entry)).forEach((token) => routeTokens.add(token)));
    route.tabs.forEach((entry) => normalizeRouteTokens(routeEntryLabel(entry)).forEach((token) => routeTokens.add(token)));
    route.filters.forEach((entry) => normalizeRouteTokens(routeEntryLabel(entry)).forEach((token) => routeTokens.add(token)));
    route.modalTriggers.forEach((entry) => normalizeRouteTokens(routeEntryLabel(entry)).forEach((token) => routeTokens.add(token)));

    let score = 0;
    for (const token of routeTokens) {
      if (commandTokens.has(token)) {
        score += 1;
      }
    }
    if ((route.path || '/') === currentRoute) {
      score -= 2;
    }
    if (score > bestScore) {
      bestScore = score;
      bestRoute = route.path;
    }
  }

  return bestScore > 0 ? bestRoute : null;
}

function filterAndSummarizeAppMap(
  appMap: AppMap | AppMapSummary | null | undefined,
  currentRoute: string,
  trustPolicy: ResolvedExocorTrustPolicy,
  budget: ResolverBudgetConfig,
  counters: { filteredByNeverSend: number; redactedFields: number },
  anchorRoute?: string | null
): AppMapSummary | null {
  if (!appMap) {
    return null;
  }

  if ('tokenEstimate' in appMap) {
    return summarizeAppMapForResolver(appMap, currentRoute, budget.appMapTokenBudget, anchorRoute);
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
          truncate(entry.label, 48),
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
          truncate(trigger.label, 48),
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
                truncate(field.label, 48),
                {
                  rules: trustPolicy.redact,
                  field: 'label',
                  selector: field.elementId,
                  selectorCandidates: field.selectorCandidates
                },
                counters
              ),
              options: (field.options || []).slice(0, 4).map((option) => truncate(option, 24))
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
                truncate(button.label, 48),
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
          truncate(field.label, 48),
          {
            rules: trustPolicy.redact,
            field: 'label',
            selector: field.elementId,
            selectorCandidates: field.selectorCandidates
          },
          counters
        ),
        options: (field.options || []).slice(0, 4).map((option) => truncate(option, 24))
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
          truncate(button.label, 48),
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
          truncate(filter.label, 48),
          {
            rules: trustPolicy.redact,
            field: 'label',
            selector: filter.elementId,
            selectorCandidates: filter.selectorCandidates
          },
          counters
        ),
        options: filter.options.slice(0, 4).map((option) =>
          redactString(
            truncate(option, 24),
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
          truncate(tab.label, 48),
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
    budget.appMapTokenBudget,
    anchorRoute
  );
}

function toTransportMap(map: DOMCapabilityMap): DOMCapabilityMap {
  const compressed = {
    ...map.compressed,
    tokenEstimate: Math.ceil(
      JSON.stringify({
        pageSummary: map.compressed.pageSummary,
        currentRoute: map.compressed.currentRoute,
        currentUrl: map.compressed.currentUrl,
        routes: map.compressed.routes,
        gazeTargetId: map.compressed.gazeTargetId,
        elements: map.compressed.elements,
        tableSummary: map.compressed.tableSummary,
        listSummary: map.compressed.listSummary
      }).length / 4
    )
  };

  return {
    ...map,
    compressed
  };
}

function buildRuntimeContext(
  input: IntentResolutionInput,
  runtimeContext: Record<string, unknown> | undefined,
  budget: ResolverBudgetConfig,
  trustPolicy: ResolvedExocorTrustPolicy
): Record<string, unknown> | undefined {
  if (!runtimeContext) {
    return undefined;
  }

  const nextContext: Record<string, unknown> = {};
  if (typeof runtimeContext.inputMethod === 'string') {
    nextContext.inputMethod = runtimeContext.inputMethod;
  }

  if (typeof runtimeContext.selectedText === 'string' && runtimeContext.selectedText.trim()) {
    nextContext.selectedText = truncate(runtimeContext.selectedText.trim(), 120);
  }

  if (runtimeContext.gazeTarget && typeof runtimeContext.gazeTarget === 'object') {
    nextContext.gazeTarget = runtimeContext.gazeTarget;
  }
  if (runtimeContext.gazePosition && typeof runtimeContext.gazePosition === 'object') {
    nextContext.gazePosition = runtimeContext.gazePosition;
  }

  if (runtimeContext.focusedElement && typeof runtimeContext.focusedElement === 'object') {
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
      nextContext.focusedElement = {
        elementId,
        label: typeof focusedElement.label === 'string' ? truncate(focusedElement.label, 48) : undefined,
        text: typeof focusedElement.text === 'string' ? truncate(focusedElement.text, 48) : undefined,
        role: typeof focusedElement.role === 'string' ? focusedElement.role : undefined,
        type: typeof focusedElement.type === 'string' ? focusedElement.type : undefined
      };
    }
  }

  return Object.keys(nextContext).length ? nextContext : undefined;
}

function createInitialCandidate(
  input: IntentResolutionInput,
  runtimeContext: Record<string, unknown> | undefined,
  trustPolicy: ResolvedExocorTrustPolicy,
  requestKind: ResolverRequestKind,
  profile: ResolverContextProfile,
  counters: { filteredByNeverSend: number; redactedFields: number }
): { candidate: MutableContextCandidate; includedSections: string[]; droppedSections: string[]; budget: ResolverBudgetConfig } {
  const budget = buildBudgetConfig(requestKind, profile);
  const hasOpenDialogs = input.map.dialogs.some((dialog) => dialog.isOpen);
  const includeTools = trustPolicy.features.tools && Boolean(input.toolCapabilityMap?.tools?.length);
  const includeForms = input.map.formState.length > 0 && (profile === 'form' || profile === 'general' || hasSpecificFieldValues(input.command));
  const includeDialogs = hasOpenDialogs && (profile === 'form' || profile === 'general');
  const includeTablesAndLists = budget.includeTablesAndLists && (input.map.tableRows.length > 0 || input.map.listItems.length > 0);
  const includeLiveDom = trustPolicy.features.liveDomScanning && budget.includeLiveDom;
  const preserveFormValues = profile === 'form' || hasSpecificFieldValues(input.command);
  const anchorRoute = inferAnchorRoute(
    input.command,
    input.appMap || null,
    input.map.currentRoute,
    input.toolCapabilityMap || null
  );

  const elements = includeLiveDom ? shapeElements(input, trustPolicy, budget, profile, counters) : [];

  const navigation = input.map.navigation
    .filter((entry) => {
      const shouldDrop = selectorMatchesNeverSend(trustPolicy, entry.selector, [entry.selector]);
      if (shouldDrop) {
        counters.filteredByNeverSend += 1;
      }
      return !shouldDrop;
    })
    .slice(0, budget.navigationLimit)
    .map((entry) => ({
      ...entry,
      label: redactString(
        truncate(entry.label, 48),
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
        .slice(0, budget.formLimit)
        .map((field) => ({
          ...field,
          label: redactString(
            truncate(field.label, 48),
            {
              rules: trustPolicy.redact,
              field: 'label',
              selector: field.selector,
              selectorCandidates: [field.selector]
            },
            counters
          ),
          name: redactString(
            truncate(field.name, 32),
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
                truncate(field.value, 72),
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
    .slice(0, budget.buttonLimit)
    .map((button) => ({
      ...button,
      label: redactString(
        truncate(button.label, 48),
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
        .slice(0, budget.dialogLimit)
        .map((dialog) => ({
          ...dialog,
          label: redactString(
            truncate(dialog.label, 48),
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
      routes: input.map.routes.slice(0, budget.routeLimit),
      currentRoute: input.map.currentRoute,
      currentUrl: input.map.currentUrl,
      routeParams: { ...input.map.routeParams },
      pageTitle: truncate(input.map.pageTitle, 72),
      headings: input.map.headings.slice(0, budget.headingLimit).map((heading) => ({
        ...heading,
        text: truncate(heading.text, 72)
      })),
      navigation,
      formState,
      buttonsState,
      visibleErrors: input.map.visibleErrors.slice(0, 3).map((error) => truncate(error, 72)),
      dialogs,
      tableRows: includeTablesAndLists
        ? input.map.tableRows.slice(0, budget.tableRowLimit).map((row) => ({
            context: truncate(row.context, 64),
            columns: row.columns.slice(0, 4).map((column) => truncate(column, 36))
          }))
        : [],
      listItems: includeTablesAndLists
        ? input.map.listItems.slice(0, budget.listItemLimit).map((item) => ({
            context: truncate(item.context, 48),
            text: truncate(item.text, 64)
          }))
        : [],
      cards: budget.cardLimit
        ? input.map.cards.slice(0, budget.cardLimit).map((card) => ({
            title: truncate(card.title, 48),
            text: truncate(card.text, 72)
          }))
        : [],
      statusBadges: budget.badgeLimit
        ? input.map.statusBadges.slice(0, budget.badgeLimit).map((badge) => ({
            text: truncate(badge.text, 32),
            selector: badge.selector
          }))
        : [],
      stateHints: budget.stateHintLimit
        ? input.map.stateHints.slice(0, budget.stateHintLimit)
        : [],
      activeItems: profile === 'navigation' ? input.map.activeItems.slice(0, 4).map((item) => truncate(item, 48)) : [],
      countBadges: budget.badgeLimit
        ? input.map.countBadges.slice(0, budget.badgeLimit).map((badge) => ({
            text: truncate(badge.text, 32),
            count: badge.count,
            selector: badge.selector
          }))
        : []
    },
    appMap: filterAndSummarizeAppMap(
      input.appMap || null,
      input.map.currentRoute,
      trustPolicy,
      budget,
      counters,
      anchorRoute
    ),
    toolCapabilityMap: includeTools
      ? shapeToolCapabilityMap(input.toolCapabilityMap || null, input.map.currentRoute, budget, profile, input.command, requestKind)
      : null,
    runtimeContext: buildRuntimeContext(input, runtimeContext, budget, trustPolicy)
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
    candidate.appMap ? null : 'appMap',
    includeLiveDom ? null : 'liveDom',
    includeDialogs ? null : 'dialogs',
    includeForms ? null : 'forms',
    includeTablesAndLists ? null : 'tablesAndLists',
    candidate.runtimeContext?.gazeTarget ? null : 'gaze',
    candidate.runtimeContext?.selectedText ? null : 'selectedText',
    candidate.toolCapabilityMap?.tools.length ? null : 'tools'
  ].filter((value): value is string => Boolean(value));

  return { candidate, includedSections, droppedSections, budget };
}

function buildEstimatedRequest(options: {
  input: IntentResolutionInput;
  candidate: MutableContextCandidate;
  requestKind: ResolverRequestKind;
}): { systemPrompt: string; userPrompt: string } {
  const shapedMap = toTransportMap(createCapabilityMap(options.candidate.mapBase));
  const runtimeState = buildRuntimeStateSnapshot(shapedMap, shapedMap.compressed);
  const context = buildPromptContext({
    compressed: shapedMap.compressed,
    appMap: options.candidate.appMap,
    runtimeState,
    toolCapabilityMap: options.candidate.toolCapabilityMap || null,
    runtimeContext: options.candidate.runtimeContext
  });

  if (options.requestKind === 'preferred_tool_intent' && options.candidate.toolCapabilityMap?.tools.length) {
    const preferredToolId = options.candidate.toolCapabilityMap.preferredToolIds[0] || options.candidate.toolCapabilityMap.tools[0]?.id || '';
    const selectedTool =
      options.candidate.toolCapabilityMap.tools.find((tool) => tool.id === preferredToolId) ||
      options.candidate.toolCapabilityMap.tools[0];
    if (selectedTool) {
      return {
        systemPrompt: buildPreferredToolIntentSystemPrompt(),
        userPrompt: buildPreferredToolIntentUserPrompt({
          command: options.input.command,
          context,
          preferredReason: 'strong semantic match',
          selectedTool
        })
      };
    }
  }

  if (options.requestKind === 'new_elements') {
    return {
      systemPrompt: buildPlannerSystemPrompt(),
      userPrompt: buildNewElementsUserPrompt({
        command: options.input.command,
        context,
        completedSteps: options.input.completedSteps || [],
        newElements: options.input.map.elements.slice(0, 8)
      })
    };
  }

  if (options.requestKind === 'plan') {
    return {
      systemPrompt: buildPlannerSystemPrompt(),
      userPrompt: buildPlannerUserPrompt({
        command: options.input.command,
        priority: 'route_then_dom',
        context
      })
    };
  }

  return {
    systemPrompt: buildPlannerSystemPrompt(),
    userPrompt: buildResolveUserPrompt({
      command: options.input.command,
      context,
      failureContext:
        options.requestKind === 'failed_step'
          ? {
              failedStep: {
                action: 'click',
                target: 'target',
                value: null,
                waitForDOM: true,
                reason: 'retry failed step'
              },
              failureReason: 'target not found'
            }
          : null
    })
  };
}

function estimateCandidateTokens(input: IntentResolutionInput, candidate: MutableContextCandidate, requestKind: ResolverRequestKind): number {
  const prompt = buildEstimatedRequest({
    input,
    candidate,
    requestKind
  });

  return estimateResolverRequestTokens(prompt);
}

function applyBudgetWaterfall(
  input: IntentResolutionInput,
  candidate: MutableContextCandidate,
  budget: ResolverBudgetConfig,
  requestKind: ResolverRequestKind
): boolean {
  let changed = false;

  while (estimateCandidateTokens(input, candidate, requestKind) > budget.targetTokens) {
    const before = estimateCandidateTokens(input, candidate, requestKind);

    if (candidate.mapBase.cards.length) {
      candidate.mapBase.cards = [];
    } else if (candidate.mapBase.statusBadges.length) {
      candidate.mapBase.statusBadges = [];
    } else if (candidate.mapBase.countBadges.length) {
      candidate.mapBase.countBadges = [];
    } else if (candidate.mapBase.activeItems.length) {
      candidate.mapBase.activeItems = [];
    } else if (candidate.mapBase.stateHints.length) {
      candidate.mapBase.stateHints = candidate.mapBase.stateHints.slice(0, Math.max(1, candidate.mapBase.stateHints.length - 1));
    } else if (candidate.mapBase.tableRows.length > 1) {
      candidate.mapBase.tableRows = candidate.mapBase.tableRows.slice(0, candidate.mapBase.tableRows.length - 1);
    } else if (candidate.mapBase.listItems.length > 2) {
      candidate.mapBase.listItems = candidate.mapBase.listItems.slice(0, candidate.mapBase.listItems.length - 1);
    } else if (candidate.mapBase.formState.some((field) => field.value)) {
      candidate.mapBase.formState = candidate.mapBase.formState.map((field) => ({ ...field, value: '' }));
    } else if (candidate.mapBase.navigation.length > 4) {
      candidate.mapBase.navigation = candidate.mapBase.navigation.slice(0, candidate.mapBase.navigation.length - 1);
    } else if (candidate.mapBase.buttonsState.length > 3) {
      candidate.mapBase.buttonsState = candidate.mapBase.buttonsState.slice(0, candidate.mapBase.buttonsState.length - 1);
    } else if (candidate.mapBase.elements.length > 4) {
      candidate.mapBase.elements = candidate.mapBase.elements.slice(0, Math.max(4, candidate.mapBase.elements.length - 2));
    } else if (candidate.appMap && candidate.appMap.routes.length > 2) {
      candidate.appMap = {
        ...candidate.appMap,
        routes: candidate.appMap.routes.slice(0, candidate.appMap.routes.length - 1),
        tokenEstimate: Math.ceil(JSON.stringify(candidate.appMap.routes.slice(0, candidate.appMap.routes.length - 1)).length / 4)
      };
    } else if (candidate.runtimeContext?.selectedText) {
      delete candidate.runtimeContext.selectedText;
      if (!Object.keys(candidate.runtimeContext).length) {
        candidate.runtimeContext = undefined;
      }
    } else if (candidate.runtimeContext?.gazeTarget) {
      delete candidate.runtimeContext.gazeTarget;
      delete candidate.runtimeContext.gazePosition;
      if (candidate.runtimeContext && !Object.keys(candidate.runtimeContext).length) {
        candidate.runtimeContext = undefined;
      }
    } else if (candidate.toolCapabilityMap && candidate.toolCapabilityMap.tools.length > 1) {
      const preferredIds = new Set(candidate.toolCapabilityMap.preferredToolIds || []);
      const trimmedTools = candidate.toolCapabilityMap.tools.filter((tool, index) => preferredIds.has(tool.id) || index === 0);
      candidate.toolCapabilityMap = {
        ...candidate.toolCapabilityMap,
        tools: trimmedTools,
        preferredToolIds: candidate.toolCapabilityMap.preferredToolIds.filter((toolId) =>
          trimmedTools.some((tool) => tool.id === toolId)
        )
      };
    } else if (candidate.mapBase.dialogs.length > 1) {
      candidate.mapBase.dialogs = candidate.mapBase.dialogs.slice(0, 1);
    } else if (candidate.mapBase.formState.length > 3) {
      candidate.mapBase.formState = candidate.mapBase.formState.slice(0, candidate.mapBase.formState.length - 1);
    } else {
      break;
    }

    const after = estimateCandidateTokens(input, candidate, requestKind);
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
  trustPolicy: ResolvedExocorTrustPolicy;
  requestKind?: ResolverRequestKind;
}): ShapedResolverContext {
  const requestKind = options.requestKind || 'plan';
  const profile = inferContextProfile(options.input, options.runtimeContext);
  const counters = {
    filteredByNeverSend: 0,
    redactedFields: 0
  };

  const { candidate, includedSections, droppedSections, budget } = createInitialCandidate(
    options.input,
    options.runtimeContext,
    options.trustPolicy,
    requestKind,
    profile,
    counters
  );
  const budgetAdjusted = applyBudgetWaterfall(options.input, candidate, budget, requestKind);
  const shapedMap = toTransportMap(createCapabilityMap(candidate.mapBase));
  const shapedInput: IntentResolutionInput = {
    ...options.input,
    map: shapedMap,
    appMap: candidate.appMap,
    toolCapabilityMap: candidate.toolCapabilityMap
  };
  const estimatedTokens = estimateCandidateTokens(options.input, candidate, requestKind);

  return {
    input: shapedInput,
    runtimeContext: candidate.runtimeContext,
    report: {
      requestKind,
      profile,
      targetTokens: budget.targetTokens,
      estimatedTokens,
      includedSections,
      droppedSections,
      filteredByNeverSend: counters.filteredByNeverSend,
      redactedFields: counters.redactedFields,
      budgetAdjusted
    }
  };
}

export function shapeResolverNewElementsForTransport(options: {
  command: string;
  elements: DOMElementDescriptor[];
  gazeTarget?: string | null;
  trustPolicy: ResolvedExocorTrustPolicy;
}): DOMElementDescriptor[] {
  const counters = {
    filteredByNeverSend: 0,
    redactedFields: 0
  };

  const input: IntentResolutionInput = {
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
  };
  const profile = inferContextProfile(input, undefined);
  const budget = buildBudgetConfig('new_elements', profile);

  return shapeElements(input, options.trustPolicy, budget, profile, counters);
}
