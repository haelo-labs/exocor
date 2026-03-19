import Anthropic from '@anthropic-ai/sdk';
import { buildCompressedCapabilityMap } from './CapabilityMap';
import { summarizeAppMapForResolver } from './DOMScanner';
import type {
  AppMap,
  AppMapSummary,
  CompressedCapabilityMap,
  DOMElementDescriptor,
  IntentPlan,
  IntentResolutionInput,
  IntentStep,
  IntentStepAction as ResolverStepAction,
  ResolutionPriority,
  ResolvedIntent
} from '../types';

const ROUTE_ANCHOR_STOP_WORDS = new Set([
  'go',
  'open',
  'show',
  'view',
  'navigate',
  'to',
  'page',
  'screen',
  'tab',
  'filter',
  'click',
  'select',
  'only',
  'list',
  'new',
  'create',
  'add',
  'save'
]);
// Shared resolver configuration for Claude-backed planning.
type ResolverOptions = {
  apiKey?: string;
  debug?: boolean;
};
interface StreamResolveCallbacks {
  onResolutionPriority?: (priority: ResolutionPriority) => void;
  onStep?: (step: IntentStep) => void;
}

const CLAUDE_SYSTEM_PROMPT = `You are an intent resolver. Given app context and user intent return a JSON array of steps to complete the task fully. Be concise.
App context: {compressed capability map with element IDs}
Runtime state: {current route/url, open dialogs, visible form fields, visible buttons}
Explicit tools: {registered global and route-specific app-native tools}
User intent: {voice or typed command}
Current page: {route}
Gaze target: {element ID user is looking at or null}
Return only valid JSON array:
[
{action: click|fill|navigate|wait|scroll|tool, target: elementId or route, toolId: string, args: object, value: string or null, waitForDOM: boolean, reason: string}
]
Rules:

Use element IDs from context for targets
Prefer a registered tool when the tool is clearly a better fit than DOM/app-map inference
Never invent tool ids
Only use declared tool parameter names
Global tools can be used from any route
Route-specific tools remain available even when current route differs; if currentRouteMatches is false and requiresNavigation is true, plan navigate first and then the tool
Destructive tools should only be used for explicit destructive intent
If no tool fits, continue with app-map and DOM planning
Elements marked as fillable: input, textarea, select, contenteditable. Only use fill action on elements explicitly marked as fillable:true in the context. Never use fill action on buttons, divs without contenteditable, or links.
Complete full workflow end to end
Always complete the FULL workflow end to end. Never stop at an intermediate state like an open modal or dialog. If your intent is to CREATE something you must: find the create button, click it, wait for form, fill ALL required fields, and submit the form. Stopping at an open modal is not success. Submitting an empty form is not success. Complete the entire task.
waitForDOM true after clicks that open modals or change page
Add wait 300ms between DOM-changing actions
Do not add navigation for confirmation after submit/create unless the user explicitly requested navigation
If runtime state shows an open modal/dialog and the command is about fill/edit/select/submit, operate in that open modal/dialog in place.
Do not navigate away or reopen create flow unless the user explicitly asked to navigate/start a new flow.
Return empty array if intent is unclear`;

function normalize(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

function extractClarificationAnswerContext(command: string): { originalCommand: string; clarificationAnswer: string } | null {
  const match = command.match(/\boriginal intent:\s*(.*?)\s+clarification answer:\s*(.+)$/i);
  if (!match) {
    return null;
  }

  return {
    originalCommand: normalize(match[1] || ''),
    clarificationAnswer: normalize(match[2] || '')
  };
}

function hasSpecificFieldValues(command: string): boolean {
  const lowerCommand = command.toLowerCase();

  if (
    /\b(?:title|name|priority|status|type|assignee|owner|email|phone|date|time|description|tag|category)\b\s*(?:is|=|:)\s*["']?[^,"'\n]+["']?/i.test(
      command
    )
  ) {
    return true;
  }

  if (
    /\b(?:with|set)\s+(?:priority|status|type|assignee|owner|email|phone|date|time|description|title|name|tag|category)\b(?:\s+(?:to|as|is))?\s+["']?[^,"'\n]+["']?/i.test(
      command
    )
  ) {
    return true;
  }

  if (/\b(?:called|named|titled)\s+["']?[^,"'\n]+["']?/i.test(command)) {
    return true;
  }

  return lowerCommand.includes('clarification answer:');
}

function isNavigationCommand(command: string): boolean {
  const lower = command.toLowerCase();

  if (/\/[a-z0-9/_-]+/.test(lower)) {
    return true;
  }

  if (/\b(navigate|go to|switch to|take me to|bring me to|route to|visit)\b/.test(lower)) {
    return true;
  }

  if (/\b(open|show)\b/.test(lower) && /\b(page|screen|tab|route)\b/.test(lower)) {
    return true;
  }

  return false;
}

function toJsonCandidate(text: string): string | null {
  const end = text.lastIndexOf(']');
  if (end < 0) {
    return null;
  }
  const start = text.lastIndexOf('[', end);
  if (start < 0) {
    return null;
  }

  return text.slice(start, end + 1);
}

function normalizeLooseJson(jsonCandidate: string): string {
  return jsonCandidate
    .replace(/(\w+)\s*:/g, '"$1":')
    .replace(/'/g, '"');
}

function toObjectJsonCandidate(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start < 0 || end <= start) {
    return null;
  }

  return text.slice(start, end + 1);
}

function parseClarificationDecision(text: string): { needsClarification: boolean; question: string } | null {
  const jsonCandidate = toObjectJsonCandidate(text);
  if (!jsonCandidate) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    try {
      parsed = JSON.parse(normalizeLooseJson(jsonCandidate));
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const decision = parsed as Record<string, unknown>;
  return {
    needsClarification: Boolean(decision.needsClarification),
    question: typeof decision.question === 'string' ? decision.question.trim() : ''
  };
}

function isAction(value: string): value is ResolverStepAction {
  return value === 'click' || value === 'fill' || value === 'navigate' || value === 'wait' || value === 'scroll' || value === 'tool';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStepEntry(entry: Record<string, unknown>): IntentStep | null {
  const actionRaw = String(entry.action || '').trim().toLowerCase();
  if (!isAction(actionRaw)) {
    return null;
  }

  const target = entry.target == null ? undefined : String(entry.target).trim();
  const value = entry.value == null ? null : String(entry.value);
  const toolId = entry.toolId == null ? undefined : String(entry.toolId).trim();
  const args = entry.args == null ? undefined : isRecord(entry.args) ? entry.args : null;
  const waitForDOM = Boolean(entry.waitForDOM);
  const reason = String(entry.reason || actionRaw);
  const msRaw = entry.ms;
  const ms = typeof msRaw === 'number' && Number.isFinite(msRaw) ? msRaw : undefined;

  if (actionRaw === 'tool' && !toolId) {
    return null;
  }

  if (actionRaw !== 'wait' && actionRaw !== 'tool' && !target) {
    return null;
  }

  if (args === null) {
    return null;
  }

  return {
    action: actionRaw,
    target: actionRaw === 'tool' ? target || toolId : target,
    value,
    ...(toolId ? { toolId } : {}),
    ...(args ? { args } : {}),
    waitForDOM,
    ms,
    reason
  };
}

function parseStepObject(jsonObjectCandidate: string): IntentStep | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonObjectCandidate);
  } catch {
    try {
      parsed = JSON.parse(normalizeLooseJson(jsonObjectCandidate));
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }

  return parseStepEntry(parsed as Record<string, unknown>);
}

function stepFingerprint(step: IntentStep): string {
  return [
    step.action,
    step.target || '',
    step.toolId || '',
    step.args ? JSON.stringify(step.args) : '',
    step.value || '',
    step.waitForDOM ? '1' : '0',
    step.reason || '',
    typeof step.ms === 'number' ? String(step.ms) : ''
  ].join('|');
}

interface IncrementalStepParser {
  pushText: (delta: string) => void;
  reconcileFromText: (text: string) => IntentStep[];
}

function createIncrementalStepParser(onStep: (step: IntentStep) => void): IncrementalStepParser {
  let startedArray = false;
  let inString = false;
  let escapeNext = false;
  let objectDepth = 0;
  let currentObject = '';
  const emittedSteps: IntentStep[] = [];
  const emittedFingerprints = new Set<string>();

  const emit = (step: IntentStep): void => {
    const fingerprint = stepFingerprint(step);
    if (emittedFingerprints.has(fingerprint)) {
      return;
    }
    emittedFingerprints.add(fingerprint);
    emittedSteps.push(step);
    onStep(step);
  };

  const processCompletedObject = (): void => {
    const step = parseStepObject(currentObject);
    currentObject = '';
    if (!step) {
      return;
    }
    emit(step);
  };

  return {
    pushText: (delta: string): void => {
      for (const char of delta) {
        if (!startedArray) {
          if (char === '[') {
            startedArray = true;
          }
          continue;
        }

        if (objectDepth > 0) {
          currentObject += char;
        }

        if (inString) {
          if (escapeNext) {
            escapeNext = false;
            continue;
          }
          if (char === '\\') {
            escapeNext = true;
            continue;
          }
          if (char === '"') {
            inString = false;
          }
          continue;
        }

        if (char === '"') {
          inString = true;
          continue;
        }

        if (char === '{') {
          if (objectDepth === 0) {
            currentObject = '{';
          }
          objectDepth += 1;
          continue;
        }

        if (char === '}' && objectDepth > 0) {
          objectDepth -= 1;
          if (objectDepth === 0) {
            processCompletedObject();
          }
        }
      }
    },
    reconcileFromText: (text: string): IntentStep[] => {
      const parsedSteps = parseSteps(text);
      for (const step of parsedSteps) {
        emit(step);
      }
      return parsedSteps.length ? parsedSteps : [...emittedSteps];
    }
  };
}

function parseSteps(text: string): IntentStep[] {
  const jsonCandidate = toJsonCandidate(text);
  if (!jsonCandidate) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    try {
      parsed = JSON.parse(normalizeLooseJson(jsonCandidate));
    } catch {
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    return [];
  }

  const steps: IntentStep[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }
    const step = parseStepEntry(entry as Record<string, unknown>);
    if (step) {
      steps.push(step);
    }
  }

  return steps;
}

function toClaudeContext(map: CompressedCapabilityMap): Omit<CompressedCapabilityMap, 'selectorMap'> {
  const { selectorMap: _selectorMap, ...withoutSelectors } = map;
  return withoutSelectors;
}

interface ResolutionPriorityDecision {
  priority: ResolutionPriority;
  reason: string;
  dynamicSignal?: string;
  routeAnchor?: string;
}

interface RuntimeStateSnapshot {
  currentRoute: string;
  currentUrl: string;
  dialogs: Array<{ label: string; isOpen: boolean }>;
  formState: Array<{ label: string; name: string; type: string; value: string; disabled: boolean }>;
  buttonsState: Array<{ label: string; disabled: boolean; loading: boolean }>;
}

type ResolverPromptContext = Omit<CompressedCapabilityMap, 'selectorMap'> & {
  runtimeState: RuntimeStateSnapshot;
  toolCapabilityMap?: IntentResolutionInput['toolCapabilityMap'];
};

function toNewElementContext(elements: DOMElementDescriptor[]): Array<{
  id: string;
  componentName: string;
  tag: string;
  fillable: boolean;
  label: string;
  text: string;
  type: string;
  placeholder: string;
  handlers: string[];
}> {
  return elements.slice(0, 40).map((element) => ({
    id: element.id,
    componentName: element.componentName || 'anonymous',
    tag: element.tagName,
    fillable: Boolean(element.fillable),
    label: element.label || '',
    text: element.text || '',
    type: element.type || '',
    placeholder: element.placeholder || '',
    handlers: (element.handlers || []).slice(0, 6)
  }));
}

/** Server-side Anthropic resolver used behind the Exocor backend route. */
export class IntentResolver {
  private readonly debug: boolean;
  private client: Anthropic | null = null;

  constructor(options: ResolverOptions = {}) {
    this.debug = Boolean(options.debug);

    if (options.apiKey) {
      this.client = new Anthropic({
        apiKey: options.apiKey
      });
    }
  }

  private hasTypedAnchor(appContext?: Record<string, unknown>): boolean {
    if (!appContext) {
      return false;
    }

    const selectedText = typeof appContext.selectedText === 'string' ? appContext.selectedText.trim() : '';
    const focusedElement =
      appContext.focusedElement && typeof appContext.focusedElement === 'object'
        ? (appContext.focusedElement as Record<string, unknown>)
        : null;
    const focusedElementId =
      focusedElement && typeof focusedElement.elementId === 'string' ? focusedElement.elementId.trim() : '';

    return Boolean(selectedText || focusedElementId);
  }

  private hasAppMapContext(domContext: { appMap?: AppMap | AppMapSummary | null }): boolean {
    const appMap = domContext.appMap;
    if (!appMap || !Array.isArray(appMap.routes)) {
      return false;
    }

    return appMap.routes.length > 0;
  }

  private hasToolCapabilityContext(domContext: { toolCapabilityMap?: IntentResolutionInput['toolCapabilityMap'] }): boolean {
    return Boolean(domContext.toolCapabilityMap?.tools?.length);
  }

  private toMatchTokens(value: string): string[] {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9\s/_-]/g, ' ')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => token.replace(/^\/+|\/+$/g, ''))
      .map((token) => token.replace(/[-_]/g, ' '))
      .flatMap((token) => token.split(/\s+/))
      .map((token) => token.replace(/s$/, ''))
      .filter((token) => token.length > 1);
  }

  private extractDynamicSignal(command: string): string | null {
    const patterns: RegExp[] = [
      /\b(?:ticket|incident|order|user|task|case|item|result|row|record)\s+#?\d+\b/i,
      /\b(?:row|result|item|record)\s+(?:number|no\.?)\s*\d+\b/i,
      /\b(?:first|second|third|\d+(?:st|nd|rd|th))\s+(?:result|row|item)\b/i,
      /\bsearch results?\b/i,
      /\bresult\s*#\s*\d+\b/i,
      /\bid\s*[:#]?\s*[a-z0-9-]{2,}\b/i
    ];

    for (const pattern of patterns) {
      const match = command.match(pattern);
      if (match?.[0]) {
        return match[0].trim();
      }
    }

    return null;
  }

  private findRouteAnchor(command: string, appMapSummary: AppMapSummary | null): string | null {
    if (!appMapSummary?.routes?.length) {
      return null;
    }

    const commandLower = command.toLowerCase();
    const commandTokens = new Set(
      this.toMatchTokens(commandLower).filter((token) => !ROUTE_ANCHOR_STOP_WORDS.has(token))
    );
    let bestRoute: string | null = null;
    let bestScore = 0;

    for (const route of appMapSummary.routes) {
      const routeTokens = new Set<string>();
      this.toMatchTokens(route.path)
        .filter((token) => !ROUTE_ANCHOR_STOP_WORDS.has(token))
        .forEach((token) => routeTokens.add(token));
      this.toMatchTokens(route.title)
        .filter((token) => !ROUTE_ANCHOR_STOP_WORDS.has(token))
        .forEach((token) => routeTokens.add(token));
      route.navigationLinks.forEach((entry) =>
        this.toMatchTokens(entry.label)
          .filter((token) => !ROUTE_ANCHOR_STOP_WORDS.has(token))
          .forEach((token) => routeTokens.add(token))
      );
      route.buttons.forEach((entry) =>
        this.toMatchTokens(entry)
          .filter((token) => !ROUTE_ANCHOR_STOP_WORDS.has(token))
          .forEach((token) => routeTokens.add(token))
      );
      route.tabs.forEach((entry) =>
        this.toMatchTokens(entry)
          .filter((token) => !ROUTE_ANCHOR_STOP_WORDS.has(token))
          .forEach((token) => routeTokens.add(token))
      );
      route.filters.forEach((entry) =>
        this.toMatchTokens(entry)
          .filter((token) => !ROUTE_ANCHOR_STOP_WORDS.has(token))
          .forEach((token) => routeTokens.add(token))
      );
      route.modalTriggers.forEach((entry) =>
        this.toMatchTokens(entry.label)
          .filter((token) => !ROUTE_ANCHOR_STOP_WORDS.has(token))
          .forEach((token) => routeTokens.add(token))
      );

      let score = 0;
      for (const token of routeTokens) {
        if (commandTokens.has(token)) {
          score += 1;
        }
      }

      const normalizedPath = route.path.toLowerCase();
      if (normalizedPath !== '/' && commandLower.includes(normalizedPath)) {
        score += 3;
      }

      if (score > bestScore) {
        bestScore = score;
        bestRoute = route.path;
      }
    }

    return bestScore > 0 ? bestRoute : null;
  }

  private classifyResolutionPriority(command: string, appMapSummary: AppMapSummary | null): ResolutionPriorityDecision {
    const dynamicSignal = this.extractDynamicSignal(command);
    const routeAnchor = this.findRouteAnchor(command, appMapSummary);

    let decision: ResolutionPriorityDecision;
    if (dynamicSignal && routeAnchor) {
      decision = {
        priority: 'route_then_dom',
        reason: `dynamic signal "${dynamicSignal}", route anchor "${routeAnchor}"`,
        dynamicSignal,
        routeAnchor
      };
    } else if (dynamicSignal && !routeAnchor) {
      decision = {
        priority: 'dom_only',
        reason: `dynamic signal "${dynamicSignal}" without app-map route anchor`,
        dynamicSignal
      };
    } else {
      decision = {
        priority: 'app_map_only',
        reason: 'no dynamic target signal'
      };
    }

    // eslint-disable-next-line no-console
    console.log(`[Exocor] Resolution priority: ${decision.priority} (reason: ${decision.reason})`);
    return decision;
  }

  private buildRuntimeStateSnapshot(
    map: IntentResolutionInput['map'],
    compressed: CompressedCapabilityMap
  ): RuntimeStateSnapshot {
    return {
      currentRoute: compressed.currentRoute,
      currentUrl: compressed.currentUrl,
      dialogs: map.dialogs
        .filter((dialog) => dialog.isOpen)
        .slice(0, 12)
        .map((dialog) => ({
          label: dialog.label || '',
          isOpen: Boolean(dialog.isOpen)
        })),
      formState: map.formState.slice(0, 40).map((field) => ({
        label: field.label || '',
        name: field.name || '',
        type: field.type || '',
        value: field.value || '',
        disabled: Boolean(field.disabled)
      })),
      buttonsState: map.buttonsState.slice(0, 40).map((button) => ({
        label: button.label || '',
        disabled: Boolean(button.disabled),
        loading: Boolean(button.loading)
      }))
    };
  }

  private buildResolverContext(
    compressed: CompressedCapabilityMap,
    appMap: AppMap | null | undefined,
    runtimeState: RuntimeStateSnapshot,
    toolCapabilityMap: IntentResolutionInput['toolCapabilityMap']
  ): ResolverPromptContext {
    return {
      ...toClaudeContext({
        ...compressed,
        appMap: appMap || null
      }),
      runtimeState,
      toolCapabilityMap: toolCapabilityMap || null
    };
  }

  private buildAppMapFirstContext(
    compressed: CompressedCapabilityMap,
    appMap: AppMap | null | undefined,
    runtimeState: RuntimeStateSnapshot,
    toolCapabilityMap: IntentResolutionInput['toolCapabilityMap']
  ): ResolverPromptContext {
    const context: ResolverPromptContext = {
      pageSummary: '',
      currentRoute: compressed.currentRoute,
      currentUrl: compressed.currentUrl,
      routes: compressed.routes,
      gazeTargetId: compressed.gazeTargetId,
      elements: [],
      tableSummary: '',
      listSummary: '',
      appMap: appMap || null,
      runtimeState,
      toolCapabilityMap: toolCapabilityMap || null,
      tokenEstimate: 0
    };

    return {
      ...context,
      tokenEstimate: Math.ceil(JSON.stringify(context).length / 4)
    };
  }

  private shouldSkipTypedClarificationGate(command: string): boolean {
    const clarificationContext = extractClarificationAnswerContext(command);

    if (clarificationContext) {
      if (clarificationContext.clarificationAnswer.length > 0) {
        return true;
      }

      if (command.length > clarificationContext.originalCommand.length) {
        return true;
      }
    }

    return hasSpecificFieldValues(command);
  }

  private async maybeAskForTypedClarification(
    command: string,
    runtimeContext: Record<string, unknown> | undefined,
    domContext: ResolverPromptContext
  ): Promise<string | null> {
    if (!this.client) {
      return null;
    }

    const decisionPrompt = `You are a clarification gate. Default is always needsClarification=false.
Return JSON only: {"needsClarification": boolean, "question": string}

Only set needsClarification=true when ALL of these are true:
1. A required field has no possible value to infer from the command or context
2. There is no reasonable default
3. Acting without it would cause the action to fail

Never ask about: optional fields, assignees, descriptions, tags, dates, categories.
Never ask when the command is a navigation or filter intent.
Never ask when gaze context identifies the target.
When in doubt: needsClarification=false. Act and let the user correct.

If needsClarification=true: question must be one short sentence about the missing required value only.
If needsClarification=false: question must be empty string.`;

    const userPrompt = [
      `User command: ${command}`,
      `Runtime context: ${runtimeContext ? JSON.stringify(runtimeContext) : 'none'}`,
      `DOM context: ${JSON.stringify(domContext)}`
    ].join('\n\n');

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        temperature: 0,
        max_tokens: 140,
        system: decisionPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      const decision = parseClarificationDecision(text);
      if (!decision?.needsClarification) {
        return null;
      }

      return decision.question || 'Which item should I use?';
    } catch (error) {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.warn('[Exocor] Typed clarification gate failed.', error);
      }
      return null;
    }
  }

  async resolve(input: IntentResolutionInput): Promise<IntentPlan | null> {
    const command = normalize(input.command);
    if (!command || !this.client) {
      return null;
    }

    // eslint-disable-next-line no-console
    console.log('[Exocor] Capability map (full):', JSON.stringify(input.map, null, 2));
    const compressed = buildCompressedCapabilityMap(input.map, input.gazeTarget);
    const runtimeState = this.buildRuntimeStateSnapshot(input.map, compressed);
    // eslint-disable-next-line no-console
    console.log('[Exocor] Capability map:', JSON.stringify(compressed, null, 2));
    const steps = await this.resolveWithClaude(command, compressed, runtimeState, input.appMap, input.toolCapabilityMap, null);

    if (!steps.length) {
      return null;
    }

    return {
      source: 'claude',
      rawCommand: command,
      confidence: 0.85,
      steps
    };
  }

  async resolveForFailedStep(
    input: IntentResolutionInput,
    failedStep: IntentStep,
    failureReason: string
  ): Promise<IntentStep[]> {
    const command = normalize(input.command);
    if (!command || !this.client) {
      return [];
    }

    // eslint-disable-next-line no-console
    console.log('[Exocor] Capability map (full):', JSON.stringify(input.map, null, 2));
    const compressed = buildCompressedCapabilityMap(input.map, input.gazeTarget);
    const runtimeState = this.buildRuntimeStateSnapshot(input.map, compressed);
    // eslint-disable-next-line no-console
    console.log('[Exocor] Capability map:', JSON.stringify(compressed, null, 2));
    return this.resolveWithClaude(command, compressed, runtimeState, input.appMap, input.toolCapabilityMap, {
      failedStep,
      failureReason
    });
  }

  async resolveForNewElements(
    input: IntentResolutionInput,
    newElements: DOMElementDescriptor[],
    completedSteps: IntentStep[]
  ): Promise<IntentStep[]> {
    const command = normalize(input.command);
    if (!command || !this.client || !newElements.length) {
      return [];
    }

    // eslint-disable-next-line no-console
    console.log('[Exocor] Capability map (full):', JSON.stringify(input.map, null, 2));
    const compressed = buildCompressedCapabilityMap(input.map, input.gazeTarget);
    const runtimeState = this.buildRuntimeStateSnapshot(input.map, compressed);
    // eslint-disable-next-line no-console
    console.log('[Exocor] Capability map:', JSON.stringify(compressed, null, 2));
    const contextForClaude = this.buildResolverContext(compressed, input.appMap, runtimeState, input.toolCapabilityMap);
    const newElementsContext = toNewElementContext(newElements);

    const userPrompt = [
      `User intent: ${command}`,
      `Current page: ${compressed.currentRoute}`,
      `Gaze target: ${compressed.gazeTargetId || 'null'}`,
      `App context: ${JSON.stringify(contextForClaude)}`,
      `Completed steps so far: ${JSON.stringify(completedSteps.slice(0, 12))}`,
      `These new elements appeared: ${JSON.stringify(newElementsContext)}`,
      `These new elements appeared. What additional steps are needed to complete the original intent of: ${command}? Return only remaining JSON steps.`
    ].join('\n\n');

    return this.callClaude(userPrompt);
  }

  async resolveFollowUp(
    input: IntentResolutionInput,
    completedSteps: IntentStep[],
    instruction: string
  ): Promise<IntentStep[]> {
    const command = normalize(input.command);
    if (!command || !this.client) {
      return [];
    }

    // eslint-disable-next-line no-console
    console.log('[Exocor] Capability map (full):', JSON.stringify(input.map, null, 2));
    const compressed = buildCompressedCapabilityMap(input.map, input.gazeTarget);
    const runtimeState = this.buildRuntimeStateSnapshot(input.map, compressed);
    // eslint-disable-next-line no-console
    console.log('[Exocor] Capability map:', JSON.stringify(compressed, null, 2));

    const contextForClaude = this.buildResolverContext(compressed, input.appMap, runtimeState, input.toolCapabilityMap);
    const completedStepLabels = completedSteps.map((step) => step.reason || `${step.action} ${step.target || ''}`);

    const userPrompt = [
      `Original user intent: ${command}`,
      `Steps already completed: ${JSON.stringify(completedStepLabels.slice(-20))}`,
      `Current page: ${compressed.currentRoute}`,
      `App context: ${JSON.stringify(contextForClaude)}`,
      `Instruction: ${instruction}`,
      'Return remaining steps only as valid JSON array. Return [] if complete.'
    ].join('\n\n');

    return this.callClaude(userPrompt);
  }

  /**
   * Internal streaming variant for initial plan dispatch.
   * Emits complete steps through callbacks while the model is still generating.
   */
  async resolveWithContextStreamInternal(
    input: IntentResolutionInput,
    runtimeContext?: Record<string, unknown>,
    callbacks: StreamResolveCallbacks = {}
  ): Promise<ResolvedIntent> {
    const command = normalize(input.command);
    if (!command || !this.client) {
      return null;
    }

    const compressed = buildCompressedCapabilityMap(input.map, input.gazeTarget);
    const runtimeState = this.buildRuntimeStateSnapshot(input.map, compressed);
    const appMapSummary = summarizeAppMapForResolver(input.appMap, compressed.currentRoute, 800);
    const fullAppMap = input.appMap || null;
    const liveDomContextForClaude = this.buildResolverContext(
      compressed,
      fullAppMap,
      runtimeState,
      input.toolCapabilityMap
    );
    const priorityDecision = this.classifyResolutionPriority(command, appMapSummary);
    callbacks.onResolutionPriority?.(priorityDecision.priority);

    const contextForClaude =
      priorityDecision.priority === 'dom_only'
        ? liveDomContextForClaude
        : this.buildAppMapFirstContext(compressed, fullAppMap, runtimeState, input.toolCapabilityMap);
    const contextInputMethod = input.inputMethod === 'text' ? 'typed' : input.inputMethod;
    const alreadyClarified = command.includes('|||clarified|||');
    if (
      !alreadyClarified &&
      contextInputMethod === 'typed' &&
      !isNavigationCommand(command) &&
      !this.hasTypedAnchor(runtimeContext) &&
      !this.hasAppMapContext(contextForClaude) &&
      !this.hasToolCapabilityContext(contextForClaude)
    ) {
      const clarificationQuestion = await this.maybeAskForTypedClarification(command, runtimeContext, contextForClaude);
      if (clarificationQuestion) {
        return { type: 'text_response', text: clarificationQuestion };
      }
    }

    const systemPrompt = `Respond with ONLY a JSON array of steps or a single clarification question. No explanation, no reasoning, no text before or after the JSON. If you need to think, think silently. Your entire response must be either:
- A valid JSON array: [{...}, {...}]
- A single clarification question (only when absolutely necessary)

Never show your reasoning. Never show multiple versions.
Never use element IDs as targets. Never use CSS selectors as targets.
For click/fill/submit/scroll actions, target MUST be an app-map label string.
Only navigate actions may target route paths (e.g. "/tickets").
Tool actions must use toolId and args.

You are an intelligent assistant embedded in a web application. Understand the user's goal and complete it fully in one plan.

You have:
- appMap: complete app structure — all routes, buttons, tabs, modals, and form fields discovered in advance
- toolCapabilityMap: explicit app-native tools, including global tools and route-specific tools across the whole app
- runtimeState: current route/url + currently open dialogs + visible form fields + visible buttons
- runtimeContext: SDK-derived metadata such as input method, gaze target/position, focused element, and selected text
- Runtime executor: resolves label targets to live DOM elements at execution time
- Input method: how the user gave the command

You respond with either a JSON array of steps or a clarification question:
[{"action":"click|fill|navigate|wait|scroll|tool","target":"label or route path","toolId":"registeredToolId","args":{"declared":"value"},"value":"string|null","waitForDOM":true|false,"reason":"string"}]

HOW TO USE appMap:
- appMap tells you what exists on each page: routes, buttons, tabs, modals, and form fields with their labels
- Use appMap labels directly as action targets
- Plan across page navigations using labels on destination pages
- Example: navigate "/tickets" → click "New Ticket" → fill "title" → click "Create"

HOW TO USE toolCapabilityMap:
- Prefer a registered tool when the tool is clearly a better fit than pure DOM or app-map inference
- Never invent tool ids
- Never invent argument names
- Only use declared parameter names
- Global tools can be used from any route
- Route-specific tools remain available even when the current route is different
- If a route-specific tool has currentRouteMatches=false and requiresNavigation=true, it is valid and expected to plan navigate first and then the tool
- If no tool is appropriate, continue with app-map and DOM planning
- Destructive tools should only be used for explicit destructive intent

NAVIGATION:
- Plan the full workflow upfront using appMap knowledge
- After a navigate action with waitForDOM:true, continue using app-map labels for subsequent steps
- For tabs and filters: use the tab/filter label from appMap as the click target
- 'go to X in Y' or 'navigate to X showing Y' means: navigate to X AND click the Y tab/filter
- Never add a navigation step only to confirm a submit/create result unless the user explicitly requested navigation

FORMS:
- Fill only fields listed as form fields — never fill buttons
- Submit buttons have labels like Create, Save, Submit, Add, Confirm — always CLICK the label target, never fill
- Skip optional fields not mentioned by the user
- Never re-fill a field already filled in completed steps
- If runtimeState shows an open modal/dialog and user asks to fill/edit/select/submit, operate in that open modal/dialog in place
- Do not navigate away or reopen a creation flow unless the user explicitly requested navigation/new flow

GAZE:
- Gaze context (gazeTarget) is provided for voice commands and indicates where the user was looking when they started speaking
- Use gaze context only when it is semantically relevant to the command, such as 'this', 'that', 'here', 'it', or another on-screen reference without an explicit name
- If the command is self-contained and unambiguous without gaze context (for example 'create a new ticket', 'navigate to reports', 'filter by critical priority'), ignore gazeTarget and resolve from the command alone
- When gaze context is relevant, map it to the closest app-map label target

Complete the full task end to end. Never stop halfway.`;
    const userPrompt = [
      `User command: ${command}`,
      `Resolution priority: ${priorityDecision.priority} (${priorityDecision.reason})`,
      `Runtime context: ${runtimeContext ? JSON.stringify(runtimeContext) : 'none'}`,
      `DOM context: ${JSON.stringify(contextForClaude)}`,
      `Current page: ${compressed.currentRoute}`,
      `Gaze target: ${compressed.gazeTargetId || 'none'}`,
      `Input method: ${contextInputMethod}`
    ].join('\n\n');

    try {
      const stream = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        temperature: 0,
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        stream: true
      });

      let fullText = '';
      const parser = createIncrementalStepParser((step) => {
        callbacks.onStep?.(step);
      });

      for await (const event of stream as AsyncIterable<Anthropic.RawMessageStreamEvent>) {
        if (event.type === 'message_delta') {
          continue;
        }

        if (event.type === 'content_block_start') {
          continue;
        }

        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          const deltaText = event.delta.text || '';
          if (!deltaText) {
            continue;
          }
          fullText += deltaText;
          parser.pushText(deltaText);
        }
      }

      const steps = parser.reconcileFromText(fullText);
      if (steps.length) {
        if (this.debug) {
          // eslint-disable-next-line no-console
          console.log('[Exocor] DOM steps from streamed context resolve:', JSON.stringify(steps, null, 2));
        }
        return {
          type: 'dom_steps',
          plan: { source: 'claude', rawCommand: command, confidence: 0.85, steps },
          resolutionPriority: priorityDecision.priority
        };
      }

      if (fullText.trim()) {
        return { type: 'text_response', text: fullText.trim() };
      }

      if (this.debug) {
        // eslint-disable-next-line no-console
        console.warn('[Exocor] resolveWithContextStreamInternal returned no valid steps. Failing gracefully.');
      }
      return null;
    } catch (error) {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.warn('[Exocor] resolveWithContextStreamInternal failed.', error);
      }
      return null;
    }
  }

  private async resolveWithClaude(
    command: string,
    compressedMap: CompressedCapabilityMap,
    runtimeState: RuntimeStateSnapshot,
    appMap: AppMap | null | undefined,
    toolCapabilityMap: IntentResolutionInput['toolCapabilityMap'],
    failureContext: { failedStep: IntentStep; failureReason: string } | null
  ): Promise<IntentStep[]> {
    if (!this.client) {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.warn('[Exocor] Anthropic API key missing; resolver unavailable.');
      }
      return [];
    }

    const contextForClaude = this.buildResolverContext(compressedMap, appMap, runtimeState, toolCapabilityMap);

    const userPrompt = failureContext
      ? [
          `User intent: ${command}`,
          `Current page: ${compressedMap.currentRoute}`,
          `Gaze target: ${compressedMap.gazeTargetId || 'null'}`,
          `Failed step: ${JSON.stringify(failureContext.failedStep)}`,
          `Failure reason: ${failureContext.failureReason}`,
          `App context: ${JSON.stringify(contextForClaude)}`,
          'Provide corrected remaining steps only.'
        ].join('\n\n')
      : [
          `User intent: ${command}`,
          `Current page: ${compressedMap.currentRoute}`,
          `Gaze target: ${compressedMap.gazeTargetId || 'null'}`,
          `App context: ${JSON.stringify(contextForClaude)}`
        ].join('\n\n');

    return this.callClaude(userPrompt);
  }

  private async callClaude(userPrompt: string): Promise<IntentStep[]> {
    if (!this.client) {
      return [];
    }

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        temperature: 0,
        max_tokens: 800,
        system: CLAUDE_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }]
      });

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      const steps = parseSteps(text);
      // eslint-disable-next-line no-console
      console.log('[Exocor] Anthropic plan:', JSON.stringify(steps, null, 2));
      return steps;
    } catch (error) {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.warn('[Exocor] Anthropic resolver call failed.', error);
      }
      return [];
    }
  }
}
