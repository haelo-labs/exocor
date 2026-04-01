import type {
  AppMapSummary,
  CompressedCapabilityMap,
  DOMCapabilityMap,
  DOMElementDescriptor,
  IntentPlan,
  IntentResolutionInput,
  IntentStep
} from '../types';

export interface ResolverRuntimeStateSnapshot {
  dialogs: string[];
  formState: Array<{ label: string; name: string; type: string; value?: string; disabled?: true }>;
  buttonsState: Array<{ label: string; disabled?: true; loading?: true }>;
}

export type PlannerPromptPriority = 'app_map_only' | 'route_then_dom' | 'dom_only';

function estimateTokens(payload: string): number {
  return Math.ceil(payload.length / 4);
}

function truncate(value: string, maxLength = 120): string {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function pruneValue<T>(value: T): T | undefined {
  if (value == null) {
    return undefined;
  }
  if (typeof value === 'string') {
    return (value.trim() ? value : undefined) as T | undefined;
  }
  if (Array.isArray(value)) {
    return (value.length ? value : undefined) as T | undefined;
  }
  if (typeof value === 'object') {
    return (Object.keys(value as Record<string, unknown>).length ? value : undefined) as T | undefined;
  }
  if (typeof value === 'boolean') {
    return value ? value : undefined;
  }
  return value;
}

function compactCompressedElement(element: CompressedCapabilityMap['elements'][number]): Record<string, unknown> {
  return {
    id: element.id,
    label: pruneValue(truncate(element.label || '', 64)),
    text: pruneValue(truncate(element.text || '', 64)),
    tag: pruneValue(element.tag),
    type: pruneValue(element.type),
    fill: element.fillable || undefined,
    placeholder: pruneValue(truncate(element.placeholder || '', 48)),
    value: pruneValue(truncate(element.value || '', 48)),
    aria: pruneValue(truncate(element.ariaLabel || '', 48)),
    disabled: element.disabled || undefined,
    handlers: pruneValue((element.handlers || []).slice(0, 2)),
    props: pruneValue((element.propHints || []).slice(0, 2)),
    state: pruneValue((element.stateHints || []).slice(0, 2)),
    count: element.count > 1 ? element.count : undefined
  };
}

function compactAppMap(appMap: AppMapSummary | null | undefined): Array<Record<string, unknown>> | undefined {
  if (!appMap?.routes?.length) {
    return undefined;
  }

  return appMap.routes.map((route) => ({
    path: route.path,
    title: route.title && route.title !== route.path ? truncate(route.title, 48) : undefined,
    nav: pruneValue(
      route.navigationLinks.slice(0, 2).map((entry) => ({
        label: truncate(entry.label || '', 36),
        path: entry.path
      }))
    ),
    buttons: pruneValue(route.buttons.slice(0, 3).map((entry) => truncate(entry, 36))),
    tabs: pruneValue(route.tabs.slice(0, 2).map((entry) => truncate(entry, 36))),
    filters: pruneValue(route.filters.slice(0, 2).map((entry) => truncate(entry, 36))),
    modals: pruneValue(
      route.modalTriggers.slice(0, 2).map((entry) => ({
        label: truncate(entry.label || '', 36),
        fields: pruneValue(entry.formFields.slice(0, 4).map((field) => `${truncate(field.label || '', 28)}:${field.type}`)),
        submit: pruneValue(truncate(entry.submitButton || '', 28))
      }))
    )
  }));
}

function compactToolCapabilityMap(
  toolCapabilityMap: IntentResolutionInput['toolCapabilityMap']
): Array<Record<string, unknown>> | undefined {
  if (!toolCapabilityMap?.tools?.length) {
    return undefined;
  }

  const preferredIds = new Set(toolCapabilityMap.preferredToolIds || []);
  return toolCapabilityMap.tools.map((tool) => ({
    id: tool.id,
    desc: truncate(tool.description || '', 64),
    params: pruneValue(
      (tool.parameters || []).map((parameter) => ({
        name: parameter.name,
        desc: parameter.description ? truncate(parameter.description, 32) : undefined,
        type: parameter.type || undefined,
        required: parameter.required || undefined,
        options: pruneValue((parameter.options || []).slice(0, 6))
      }))
    ),
    routes: pruneValue(tool.isGlobal ? [] : tool.routes.slice(0, 2)),
    safe: pruneValue(tool.safety || ''),
    global: tool.isGlobal || undefined,
    onRoute: tool.currentRouteMatches || undefined,
    needsNav: tool.requiresNavigation || undefined,
    preferred: preferredIds.has(tool.id) || tool.preferredForCommand ? true : undefined
  }));
}

function compactFocusedElement(focusedElement: Record<string, unknown>): Record<string, unknown> | undefined {
  const compact = {
    id: typeof focusedElement.elementId === 'string' ? focusedElement.elementId : undefined,
    label: typeof focusedElement.label === 'string' ? truncate(focusedElement.label, 48) : undefined,
    text: typeof focusedElement.text === 'string' ? truncate(focusedElement.text, 48) : undefined,
    role: typeof focusedElement.role === 'string' ? focusedElement.role : undefined,
    type: typeof focusedElement.type === 'string' ? focusedElement.type : undefined
  };

  return pruneValue(compact);
}

function compactRuntimeContext(runtimeContext?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!runtimeContext) {
    return undefined;
  }

  const compact = {
    method: typeof runtimeContext.inputMethod === 'string' ? runtimeContext.inputMethod : undefined,
    selectedText:
      typeof runtimeContext.selectedText === 'string' && runtimeContext.selectedText.trim()
        ? truncate(runtimeContext.selectedText.trim(), 120)
        : undefined,
    focus:
      runtimeContext.focusedElement && typeof runtimeContext.focusedElement === 'object'
        ? compactFocusedElement(runtimeContext.focusedElement as Record<string, unknown>)
        : undefined,
    gaze:
      runtimeContext.gazeTarget && typeof runtimeContext.gazeTarget === 'object'
        ? pruneValue({
            id:
              typeof (runtimeContext.gazeTarget as Record<string, unknown>).elementId === 'string'
                ? (runtimeContext.gazeTarget as Record<string, unknown>).elementId
                : undefined,
            label:
              typeof (runtimeContext.gazeTarget as Record<string, unknown>).label === 'string'
                ? truncate(String((runtimeContext.gazeTarget as Record<string, unknown>).label), 48)
                : undefined,
            text:
              typeof (runtimeContext.gazeTarget as Record<string, unknown>).text === 'string'
                ? truncate(String((runtimeContext.gazeTarget as Record<string, unknown>).text), 48)
                : undefined,
            component:
              typeof (runtimeContext.gazeTarget as Record<string, unknown>).componentName === 'string'
                ? truncate(String((runtimeContext.gazeTarget as Record<string, unknown>).componentName), 32)
                : undefined
          })
        : undefined
  };

  return pruneValue(compact);
}

function compactRuntimeState(runtimeState: ResolverRuntimeStateSnapshot): Record<string, unknown> | undefined {
  const compact = {
    dialogs: pruneValue(runtimeState.dialogs.slice(0, 3).map((dialog) => truncate(dialog, 36))),
    fields: pruneValue(
      runtimeState.formState.slice(0, 8).map((field) => ({
        label: truncate(field.label || '', 28),
        name: truncate(field.name || '', 24),
        type: field.type || 'text',
        value: pruneValue(truncate(field.value || '', 40)),
        disabled: field.disabled || undefined
      }))
    ),
    buttons: pruneValue(
      runtimeState.buttonsState.slice(0, 8).map((button) => ({
        label: truncate(button.label || '', 32),
        disabled: button.disabled || undefined,
        loading: button.loading || undefined
      }))
    )
  };

  return pruneValue(compact);
}

function compactStep(step: IntentStep): Record<string, unknown> {
  return {
    action: step.action,
    target: pruneValue(step.target || ''),
    toolId: pruneValue(step.toolId || ''),
    args: pruneValue(step.args || {}),
    value: pruneValue(typeof step.value === 'string' ? truncate(step.value, 48) : ''),
    waitForDOM: step.waitForDOM || undefined,
    reason: pruneValue(truncate(step.reason || '', 48)),
    ms: typeof step.ms === 'number' ? step.ms : undefined
  };
}

function compactNewElements(elements: DOMElementDescriptor[]): Array<Record<string, unknown>> {
  return elements.slice(0, 10).map((element) => ({
    id: element.id,
    label: pruneValue(truncate(element.label || '', 48)),
    text: pruneValue(truncate(element.text || '', 48)),
    tag: element.tagName,
    type: pruneValue(element.type || ''),
    fill: element.fillable || undefined,
    placeholder: pruneValue(truncate(element.placeholder || '', 32))
  }));
}

function compactSelectedTool(tool: NonNullable<IntentResolutionInput['toolCapabilityMap']>['tools'][number]): Record<string, unknown> {
  return {
    id: tool.id,
    desc: truncate(tool.description || '', 72),
    params: pruneValue(
      (tool.parameters || []).map((parameter) => ({
        name: parameter.name,
        desc: parameter.description ? truncate(parameter.description, 36) : undefined,
        type: parameter.type || undefined,
        required: parameter.required || undefined,
        options: pruneValue((parameter.options || []).slice(0, 6))
      }))
    ),
    routes: pruneValue(tool.isGlobal ? [] : tool.routes.slice(0, 2)),
    safe: pruneValue(tool.safety || ''),
    global: tool.isGlobal || undefined,
    onRoute: tool.currentRouteMatches || undefined,
    needsNav: tool.requiresNavigation || undefined
  };
}

export function buildRuntimeStateSnapshot(
  map: IntentResolutionInput['map'],
  compressed: CompressedCapabilityMap
): ResolverRuntimeStateSnapshot {
  return {
    dialogs: map.dialogs
      .filter((dialog) => dialog.isOpen)
      .slice(0, 8)
      .map((dialog) => dialog.label || '')
      .filter(Boolean),
    formState: map.formState.slice(0, 20).map((field) => ({
      label: field.label || '',
      name: field.name || '',
      type: field.type || '',
      ...(field.value ? { value: field.value } : {}),
      ...(field.disabled ? { disabled: true as const } : {})
    })),
    buttonsState: map.buttonsState.slice(0, 20).map((button) => ({
      label: button.label || '',
      ...(button.disabled ? { disabled: true as const } : {}),
      ...(button.loading ? { loading: true as const } : {})
    }))
  };
}

export function buildPromptContext(options: {
  compressed: CompressedCapabilityMap;
  appMap?: AppMapSummary | null;
  runtimeState: ResolverRuntimeStateSnapshot;
  toolCapabilityMap?: IntentResolutionInput['toolCapabilityMap'];
  runtimeContext?: Record<string, unknown>;
}): Record<string, unknown> {
  const { compressed, appMap, runtimeState, toolCapabilityMap, runtimeContext } = options;

  return {
    route: compressed.currentRoute,
    url: compressed.currentUrl,
    page: pruneValue(truncate(compressed.pageSummary || '', 96)),
    dom: pruneValue({
      gaze: pruneValue(compressed.gazeTargetId || ''),
      elements: pruneValue(compressed.elements.slice(0, 24).map((element) => compactCompressedElement(element))),
      table: compressed.tableSummary !== 'Table rows: 0' ? truncate(compressed.tableSummary, 120) : undefined,
      list: compressed.listSummary !== 'List items: 0' ? truncate(compressed.listSummary, 120) : undefined
    }),
    app: compactAppMap(appMap),
    tools: compactToolCapabilityMap(toolCapabilityMap),
    state: compactRuntimeState(runtimeState),
    runtime: compactRuntimeContext(runtimeContext)
  };
}

export function buildPlannerSystemPrompt(): string {
  return [
    'Return only either a JSON array of steps or one clarification question.',
    'Step format: [{"action":"click|fill|navigate|wait|scroll|tool","target":"label or /route","toolId":"toolId","args":{},"value":"string|null","waitForDOM":true,"reason":"short"}].',
    'Use app-map labels for click/fill/scroll targets, route paths only for navigate, and toolId+args only for tool.',
    'Never invent tool ids, routes, or parameter names.',
    'Prefer preferred tools when they fully cover the task. Global tools work anywhere. Off-route route tools may require navigate then tool.',
    'Use open dialogs/forms already in state before reopening flows.',
    'Complete the task end to end. Use gaze only for referential commands like this/that/here. Return [] if unclear.'
  ].join(' ');
}

export function buildPlannerUserPrompt(options: {
  command: string;
  priority: PlannerPromptPriority;
  context: Record<string, unknown>;
}): string {
  return [`Command: ${options.command}`, `Priority: ${options.priority}`, `Context: ${JSON.stringify(options.context)}`].join('\n');
}

export function buildResolveUserPrompt(options: {
  command: string;
  context: Record<string, unknown>;
  failureContext?: { failedStep: IntentStep; failureReason: string } | null;
}): string {
  if (options.failureContext) {
    return [
      `Command: ${options.command}`,
      `Failed: ${JSON.stringify(compactStep(options.failureContext.failedStep))}`,
      `Failure: ${truncate(options.failureContext.failureReason || '', 120)}`,
      `Context: ${JSON.stringify(options.context)}`
    ].join('\n');
  }

  return [`Command: ${options.command}`, `Context: ${JSON.stringify(options.context)}`].join('\n');
}

export function buildFollowUpUserPrompt(options: {
  command: string;
  context: Record<string, unknown>;
  completedSteps: IntentStep[];
  instruction: string;
}): string {
  return [
    `Command: ${options.command}`,
    `Done: ${JSON.stringify(options.completedSteps.slice(-8).map((step) => compactStep(step)))}`,
    `Instruction: ${truncate(options.instruction || '', 160)}`,
    `Context: ${JSON.stringify(options.context)}`
  ].join('\n');
}

export function buildNewElementsUserPrompt(options: {
  command: string;
  context: Record<string, unknown>;
  completedSteps: IntentStep[];
  newElements: DOMElementDescriptor[];
}): string {
  return [
    `Command: ${options.command}`,
    `Done: ${JSON.stringify(options.completedSteps.slice(-8).map((step) => compactStep(step)))}`,
    `New: ${JSON.stringify(compactNewElements(options.newElements))}`,
    `Context: ${JSON.stringify(options.context)}`
  ].join('\n');
}

export function buildPreferredToolRetrySystemPrompt(preferredToolId: string): string {
  return [
    buildPlannerSystemPrompt(),
    `Correction: the previous plan ignored preferred tool "${preferredToolId}". If it can satisfy the task, use it instead of reconstructing the same workflow.`
  ].join(' ');
}

export function buildPreferredToolRetryUserPrompt(options: {
  command: string;
  context: Record<string, unknown>;
  preferredToolId: string;
  preferredReason: string;
  rejectedPlan: IntentPlan;
}): string {
  return [
    `Command: ${options.command}`,
    `Preferred tool: ${options.preferredToolId}`,
    `Why: ${truncate(options.preferredReason || '', 120)}`,
    `Previous plan: ${JSON.stringify(options.rejectedPlan.steps.slice(0, 8).map((step) => compactStep(step)))}`,
    `Context: ${JSON.stringify(options.context)}`
  ].join('\n');
}

export function buildPreferredToolIntentSystemPrompt(): string {
  return [
    'Return only one JSON object in one of these forms:',
    '{"status":"ready","args":{}}',
    '{"status":"clarification","question":"..."}',
    '{"status":"fallback","reason":"..."}',
    'Do not return steps or DOM plans.',
    'Use only declared parameter names. Omit optional params unless explicit or clearly inferable.',
    'If any required arg is missing, clarify. Use fallback only when the selected tool cannot satisfy the request by itself.'
  ].join(' ');
}

export function buildPreferredToolIntentUserPrompt(options: {
  command: string;
  context: Record<string, unknown>;
  preferredReason: string;
  selectedTool: NonNullable<IntentResolutionInput['toolCapabilityMap']>['tools'][number];
}): string {
  return [
    `Command: ${options.command}`,
    `Tool: ${JSON.stringify(compactSelectedTool(options.selectedTool))}`,
    `Why: ${truncate(options.preferredReason || options.selectedTool.preferredReason || '', 120)}`,
    `Context: ${JSON.stringify(options.context)}`
  ].join('\n');
}

export function buildTypedClarificationSystemPrompt(): string {
  return [
    'Return only JSON: {"needsClarification": boolean, "question": string}.',
    'Default to needsClarification=false.',
    'Clarify only when a required value is missing, cannot be inferred, and acting would likely fail.',
    'Do not clarify for optional fields, assignees, descriptions, tags, dates, categories, navigation, filters, or when gaze already identifies the target.'
  ].join(' ');
}

export function buildTypedClarificationUserPrompt(options: {
  command: string;
  context: Record<string, unknown>;
}): string {
  return [`Command: ${options.command}`, `Context: ${JSON.stringify(options.context)}`].join('\n');
}

export function estimateResolverRequestTokens(options: { systemPrompt: string; userPrompt: string }): number {
  return estimateTokens(`${options.systemPrompt}\n${options.userPrompt}\n`);
}
