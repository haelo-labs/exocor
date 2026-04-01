import Anthropic from '@anthropic-ai/sdk';
import { buildCompressedCapabilityMap } from './CapabilityMap';
import { summarizeAppMapForResolver } from './DOMScanner';
import {
  buildFollowUpUserPrompt,
  buildNewElementsUserPrompt,
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
  buildPreferredToolIntentSystemPrompt,
  buildPreferredToolIntentUserPrompt,
  buildPreferredToolRetrySystemPrompt,
  buildPreferredToolRetryUserPrompt,
  buildPromptContext as buildResolverPromptContext,
  buildResolveUserPrompt,
  buildRuntimeStateSnapshot as createResolverRuntimeStateSnapshot,
  buildTypedClarificationSystemPrompt,
  buildTypedClarificationUserPrompt,
  type PlannerPromptPriority,
  type ResolverRuntimeStateSnapshot
} from './resolverPrompts';
import type { ExocorPreferredToolIntentResult } from './resolverProtocol';
import type {
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

function parsePreferredToolIntentResult(text: string): ExocorPreferredToolIntentResult | null {
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

  if (!isRecord(parsed)) {
    return null;
  }

  const status = String(parsed.status || '').trim().toLowerCase();

  if (status === 'ready') {
    const args = parsed.args == null ? {} : isRecord(parsed.args) ? parsed.args : null;
    if (!args) {
      return null;
    }

    return {
      status: 'ready',
      args
    };
  }

  if (status === 'clarification') {
    const question = typeof parsed.question === 'string' ? parsed.question.trim() : '';
    if (!question) {
      return null;
    }

    return {
      status: 'clarification',
      question
    };
  }

  if (status === 'fallback') {
    const reason = typeof parsed.reason === 'string' ? parsed.reason.trim() : '';
    return {
      status: 'fallback',
      reason: reason || 'Preferred tool resolution could not determine safe arguments.'
    };
  }

  return null;
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

interface ResolutionPriorityDecision {
  priority: ResolutionPriority;
  reason: string;
  dynamicSignal?: string;
  routeAnchor?: string;
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

  private log(...args: unknown[]): void {
    if (!this.debug) {
      return;
    }
    // eslint-disable-next-line no-console
    console.log(...args);
  }

  private warn(...args: unknown[]): void {
    if (!this.debug) {
      return;
    }
    // eslint-disable-next-line no-console
    console.warn(...args);
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

  private hasAppMapContext(domContext: Record<string, unknown>): boolean {
    return Array.isArray(domContext.app) && domContext.app.length > 0;
  }

  private hasToolCapabilityContext(domContext: Record<string, unknown>): boolean {
    return Array.isArray(domContext.tools) && domContext.tools.length > 0;
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

    this.log(`[Exocor] Resolution priority: ${decision.priority} (reason: ${decision.reason})`);
    return decision;
  }

  private summarizeAppMapForPrompt(
    appMap: IntentResolutionInput['appMap'],
    currentRoute: string,
    tokenBudget = 800,
    anchorRoute?: string | null
  ): AppMapSummary | null {
    return summarizeAppMapForResolver(appMap || null, currentRoute, tokenBudget, anchorRoute);
  }

  private createRuntimeStateSnapshot(
    map: IntentResolutionInput['map'],
    compressed: CompressedCapabilityMap
  ): ResolverRuntimeStateSnapshot {
    return createResolverRuntimeStateSnapshot(map, compressed);
  }

  private createPromptContext(
    compressed: CompressedCapabilityMap,
    appMap: AppMapSummary | null | undefined,
    runtimeState: ResolverRuntimeStateSnapshot,
    toolCapabilityMap: IntentResolutionInput['toolCapabilityMap'],
    runtimeContext?: Record<string, unknown>
  ): Record<string, unknown> {
    return buildResolverPromptContext({
      compressed,
      appMap,
      runtimeState,
      toolCapabilityMap: toolCapabilityMap || null,
      runtimeContext
    });
  }

  private createAppMapFirstPromptContext(
    compressed: CompressedCapabilityMap,
    appMap: AppMapSummary | null | undefined,
    runtimeState: ResolverRuntimeStateSnapshot,
    toolCapabilityMap: IntentResolutionInput['toolCapabilityMap'],
    runtimeContext?: Record<string, unknown>
  ): Record<string, unknown> {
    return this.createPromptContext(
      {
        ...compressed,
        elements: [],
        tableSummary: '',
        listSummary: '',
        tokenEstimate: 0
      },
      appMap,
      runtimeState,
      toolCapabilityMap,
      runtimeContext
    );
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
    domContext: Record<string, unknown>
  ): Promise<string | null> {
    if (!this.client) {
      return null;
    }
    const userPrompt = buildTypedClarificationUserPrompt({
      command,
      context: {
        context: domContext,
        runtime:
          runtimeContext && Object.keys(runtimeContext).length
            ? runtimeContext
            : undefined
      }
    });

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        temperature: 0,
        max_tokens: 140,
        system: buildTypedClarificationSystemPrompt(),
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
      this.warn('[Exocor] Typed clarification gate failed.', error);
      return null;
    }
  }

  async resolve(input: IntentResolutionInput): Promise<IntentPlan | null> {
    const command = normalize(input.command);
    if (!command || !this.client) {
      return null;
    }

    const compressed = buildCompressedCapabilityMap(input.map, input.gazeTarget);
    const runtimeState = this.createRuntimeStateSnapshot(input.map, compressed);
    const appMapSummary = this.summarizeAppMapForPrompt(input.appMap, compressed.currentRoute);
    this.log('[Exocor] Capability map (full):', JSON.stringify(input.map, null, 2));
    this.log('[Exocor] Capability map:', JSON.stringify(compressed, null, 2));
    const steps = await this.resolveWithClaude(command, compressed, runtimeState, appMapSummary, input.toolCapabilityMap, null);

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

    const compressed = buildCompressedCapabilityMap(input.map, input.gazeTarget);
    const runtimeState = this.createRuntimeStateSnapshot(input.map, compressed);
    const appMapSummary = this.summarizeAppMapForPrompt(input.appMap, compressed.currentRoute);
    this.log('[Exocor] Capability map (full):', JSON.stringify(input.map, null, 2));
    this.log('[Exocor] Capability map:', JSON.stringify(compressed, null, 2));
    return this.resolveWithClaude(command, compressed, runtimeState, appMapSummary, input.toolCapabilityMap, {
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

    const compressed = buildCompressedCapabilityMap(input.map, input.gazeTarget);
    const runtimeState = this.createRuntimeStateSnapshot(input.map, compressed);
    const appMapSummary = this.summarizeAppMapForPrompt(input.appMap, compressed.currentRoute);
    this.log('[Exocor] Capability map (full):', JSON.stringify(input.map, null, 2));
    this.log('[Exocor] Capability map:', JSON.stringify(compressed, null, 2));
    const contextForClaude = this.createPromptContext(
      compressed,
      appMapSummary,
      runtimeState,
      input.toolCapabilityMap
    );

    return this.callClaude(
      buildNewElementsUserPrompt({
        command,
        context: contextForClaude,
        completedSteps,
        newElements
      })
    );
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

    const compressed = buildCompressedCapabilityMap(input.map, input.gazeTarget);
    const runtimeState = this.createRuntimeStateSnapshot(input.map, compressed);
    const appMapSummary = this.summarizeAppMapForPrompt(input.appMap, compressed.currentRoute);
    this.log('[Exocor] Capability map (full):', JSON.stringify(input.map, null, 2));
    this.log('[Exocor] Capability map:', JSON.stringify(compressed, null, 2));

    const contextForClaude = this.createPromptContext(
      compressed,
      appMapSummary,
      runtimeState,
      input.toolCapabilityMap
    );

    return this.callClaude(
      buildFollowUpUserPrompt({
        command,
        context: contextForClaude,
        completedSteps,
        instruction
      })
    );
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
    const runtimeState = this.createRuntimeStateSnapshot(input.map, compressed);
    const initialAppMapSummary = this.summarizeAppMapForPrompt(input.appMap, compressed.currentRoute, 800);
    const liveDomContextForClaude = this.createPromptContext(
      compressed,
      initialAppMapSummary,
      runtimeState,
      input.toolCapabilityMap,
      runtimeContext
    );
    const priorityDecision = this.classifyResolutionPriority(command, initialAppMapSummary);
    callbacks.onResolutionPriority?.(priorityDecision.priority);
    const appMapSummary = this.summarizeAppMapForPrompt(
      input.appMap,
      compressed.currentRoute,
      800,
      priorityDecision.routeAnchor
    );

    const contextForClaude =
      priorityDecision.priority === 'dom_only'
        ? liveDomContextForClaude
        : this.createAppMapFirstPromptContext(
            compressed,
            appMapSummary,
            runtimeState,
            input.toolCapabilityMap,
            runtimeContext
          );
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
    const systemPrompt = buildPlannerSystemPrompt();
    const userPrompt = buildPlannerUserPrompt({
      command,
      priority: priorityDecision.priority as PlannerPromptPriority,
      context: contextForClaude
    });

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
        this.log('[Exocor] DOM steps from streamed context resolve:', JSON.stringify(steps, null, 2));
        return {
          type: 'dom_steps',
          plan: { source: 'claude', rawCommand: command, confidence: 0.85, steps },
          resolutionPriority: priorityDecision.priority
        };
      }

      if (fullText.trim()) {
        return { type: 'text_response', text: fullText.trim() };
      }

      this.warn('[Exocor] resolveWithContextStreamInternal returned no valid steps. Failing gracefully.');
      return null;
    } catch (error) {
      this.warn('[Exocor] resolveWithContextStreamInternal failed.', error);
      return null;
    }
  }

  private async resolveWithClaude(
    command: string,
    compressedMap: CompressedCapabilityMap,
    runtimeState: ResolverRuntimeStateSnapshot,
    appMap: AppMapSummary | null | undefined,
    toolCapabilityMap: IntentResolutionInput['toolCapabilityMap'],
    failureContext: { failedStep: IntentStep; failureReason: string } | null
  ): Promise<IntentStep[]> {
    if (!this.client) {
      this.warn('[Exocor] Anthropic API key missing; resolver unavailable.');
      return [];
    }

    const contextForClaude = this.createPromptContext(
      compressedMap,
      appMap,
      runtimeState,
      toolCapabilityMap
    );

    return this.callClaude(
      buildResolveUserPrompt({
        command,
        context: contextForClaude,
        failureContext
      })
    );
  }

  async resolveWithPreferredToolRetry(
    input: IntentResolutionInput,
    preferredToolId: string,
    preferredReason: string,
    rejectedPlan: IntentPlan
  ): Promise<IntentStep[]> {
    const command = normalize(input.command);
    if (!command || !this.client) {
      return [];
    }

    const compressed = buildCompressedCapabilityMap(input.map, input.gazeTarget);
    const runtimeState = this.createRuntimeStateSnapshot(input.map, compressed);
    const appMapSummary = this.summarizeAppMapForPrompt(input.appMap, compressed.currentRoute);
    const contextForClaude = this.createPromptContext(
      compressed,
      appMapSummary,
      runtimeState,
      input.toolCapabilityMap
    );
    const preferredTool = input.toolCapabilityMap?.tools.find((tool) => tool.id === preferredToolId) || null;

    return this.callClaude(
      buildPreferredToolRetryUserPrompt({
        command,
        context: contextForClaude,
        preferredToolId,
        preferredReason: preferredReason || preferredTool?.preferredReason || 'strong semantic match',
        rejectedPlan
      }),
      buildPreferredToolRetrySystemPrompt(preferredToolId)
    );
  }

  async resolvePreferredToolIntent(
    input: IntentResolutionInput,
    preferredToolId: string,
    preferredReason = ''
  ): Promise<ExocorPreferredToolIntentResult> {
    const command = normalize(input.command);
    if (!command || !this.client) {
      return {
        status: 'fallback',
        reason: 'Preferred tool resolution is unavailable.'
      };
    }

    const compressed = buildCompressedCapabilityMap(input.map, input.gazeTarget);
    const runtimeState = this.createRuntimeStateSnapshot(input.map, compressed);
    const appMapSummary = this.summarizeAppMapForPrompt(input.appMap, compressed.currentRoute);
    const contextForClaude = this.createPromptContext(
      compressed,
      appMapSummary,
      runtimeState,
      input.toolCapabilityMap
    );
    const preferredTool = input.toolCapabilityMap?.tools.find((tool) => tool.id === preferredToolId) || null;

    if (!preferredTool) {
      return {
        status: 'fallback',
        reason: `Preferred tool "${preferredToolId}" was not found in the capability map.`
      };
    }

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        temperature: 0,
        max_tokens: 240,
        system: buildPreferredToolIntentSystemPrompt(),
        messages: [{
          role: 'user',
          content: buildPreferredToolIntentUserPrompt({
            command,
            context: contextForClaude,
            preferredReason: preferredReason || preferredTool.preferredReason || 'strong semantic match',
            selectedTool: preferredTool
          })
        }]
      });

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');

      return (
        parsePreferredToolIntentResult(text) || {
          status: 'fallback',
          reason: 'Preferred tool resolution returned an unreadable response.'
        }
      );
    } catch (error) {
      this.warn('[Exocor] Preferred tool resolution failed.', error);

      return {
        status: 'fallback',
        reason: 'Preferred tool resolution failed.'
      };
    }
  }

  private async callClaude(userPrompt: string, systemPrompt = buildPlannerSystemPrompt()): Promise<IntentStep[]> {
    if (!this.client) {
      return [];
    }

    try {
      const response = await this.client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        temperature: 0,
        max_tokens: 800,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      });

      const text = response.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      const steps = parseSteps(text);
      this.log('[Exocor] Anthropic plan:', JSON.stringify(steps, null, 2));
      return steps;
    } catch (error) {
      this.warn('[Exocor] Anthropic resolver call failed.', error);
      return [];
    }
  }
}
