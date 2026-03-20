import type {
  ExocorToolDefinition,
  ExocorToolMetadata,
  ExocorToolParameter,
  ExocorToolParameterType,
  ExocorToolSafety,
  ToolCapabilityEntry,
  ToolCapabilityMap
} from '../types';

const DEFAULT_TOOL_SAFETY: ExocorToolSafety = 'write';
const VALID_PARAMETER_TYPES = new Set<ExocorToolParameterType>(['string', 'number', 'boolean', 'enum']);
const SEMANTIC_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'any',
  'for',
  'from',
  'in',
  'into',
  'it',
  'me',
  'my',
  'of',
  'on',
  'or',
  'please',
  'some',
  'that',
  'the',
  'this',
  'to',
  'with',
  'you',
  'your'
]);
const LOW_SIGNAL_ACTION_TOKENS = new Set([
  'add',
  'click',
  'create',
  'delete',
  'edit',
  'go',
  'new',
  'open',
  'page',
  'press',
  'remove',
  'save',
  'screen',
  'select',
  'show',
  'submit',
  'tool',
  'update',
  'view'
]);
const STRONG_TOOL_SCORE_THRESHOLD = 3;
const SINGLE_TOOL_MARGIN = 1.5;
const AMBIGUOUS_TOOL_MARGIN = 0.75;

interface SemanticToken {
  token: string;
  lowSignal: boolean;
}

interface ToolPreferenceResult {
  semanticScore: number;
  directMatchCount: number;
  hasPhraseMatch: boolean;
  preferredReason?: string;
}

interface RegisteredTool extends ExocorToolMetadata {
  id: string;
  description: string;
  parameters: ExocorToolParameter[];
  routes: string[];
  safety: ExocorToolSafety;
  isGlobal: boolean;
  handler: ExocorToolDefinition['handler'];
  idMatchKey: string;
  descriptionMatchKey: string;
  idPhrase: string;
  descriptionPhrase: string;
  idTokens: SemanticToken[];
  descriptionTokens: SemanticToken[];
  routeTokens: SemanticToken[];
  parameterTokens: SemanticToken[];
  requiredParameterNames: string[];
}

export interface ToolArgsValidationSuccess {
  ok: true;
  tool: RegisteredTool;
  args: Record<string, unknown>;
}

export interface ToolArgsValidationFailure {
  ok: false;
  tool: RegisteredTool | null;
  reason: string;
}

export type ToolArgsValidationResult = ToolArgsValidationSuccess | ToolArgsValidationFailure;

export type DirectToolShortcutMatch =
  | {
      type: 'direct_execute';
      tool: RegisteredTool;
    }
  | {
      type: 'planner_only';
      tool: RegisteredTool;
      reason: 'requires_params' | 'route_mismatch';
    };

export interface ToolRegistry {
  readonly tools: RegisteredTool[];
  hasTools: () => boolean;
  getTool: (toolId: string) => RegisteredTool | null;
  buildCapabilityMap: (currentRoute: string, command?: string) => ToolCapabilityMap;
  resolveDirectToolShortcut: (command: string, currentRoute: string) => DirectToolShortcutMatch | null;
  validateArgs: (toolId: string, args: unknown) => ToolArgsValidationResult;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeMatchValue(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
}

function toSemanticSource(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_/.-]+/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ');
}

function singularizeToken(token: string): string {
  if (token.length <= 3 || token.endsWith('ss')) {
    return token;
  }

  if (token.endsWith('ies') && token.length > 4) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.endsWith('s')) {
    return token.slice(0, -1);
  }

  return token;
}

function toSemanticTokens(value: string): SemanticToken[] {
  const rawTokens = toSemanticSource(value)
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .map((token) => singularizeToken(token))
    .filter((token) => token.length > 1 && !SEMANTIC_STOP_WORDS.has(token));

  const seen = new Set<string>();
  const tokens: SemanticToken[] = [];
  for (const token of rawTokens) {
    if (seen.has(token)) {
      continue;
    }
    seen.add(token);
    tokens.push({
      token,
      lowSignal: LOW_SIGNAL_ACTION_TOKENS.has(token)
    });
  }
  return tokens;
}

function toSemanticPhrase(value: string): string {
  return toSemanticTokens(value)
    .map((token) => token.token)
    .join(' ')
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function normalizeToolRoutePath(pathname: string): string {
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

function normalizeToolParameter(parameter: ExocorToolParameter, toolId: string, index: number): ExocorToolParameter {
  const name = normalizeWhitespace(parameter.name || '');
  const description = normalizeWhitespace(parameter.description || '');
  if (!name) {
    throw new Error(`Exocor tool "${toolId}" parameter at index ${index} is missing a name.`);
  }
  if (!description) {
    throw new Error(`Exocor tool "${toolId}" parameter "${name}" is missing a description.`);
  }

  const normalizedType =
    parameter.type && VALID_PARAMETER_TYPES.has(parameter.type) ? parameter.type : parameter.type ? undefined : undefined;
  if (parameter.type && !normalizedType) {
    throw new Error(
      `Exocor tool "${toolId}" parameter "${name}" has unsupported type "${String(parameter.type)}".`
    );
  }

  const options = Array.isArray(parameter.options)
    ? parameter.options.map((option) => normalizeWhitespace(String(option))).filter(Boolean)
    : [];
  const uniqueOptions = options.filter((option, optionIndex) => options.indexOf(option) === optionIndex);

  if (normalizedType === 'enum' && uniqueOptions.length === 0) {
    throw new Error(`Exocor tool "${toolId}" parameter "${name}" must declare options for enum type.`);
  }

  return {
    name,
    description,
    ...(normalizedType ? { type: normalizedType } : {}),
    ...(parameter.required ? { required: true } : {}),
    ...(uniqueOptions.length ? { options: uniqueOptions } : {})
  };
}

function normalizeToolDefinition(definition: ExocorToolDefinition, index: number): RegisteredTool {
  const id = normalizeWhitespace(definition.id || '');
  const description = normalizeWhitespace(definition.description || '');

  if (!id) {
    throw new Error(`Exocor tool at index ${index} is missing an id.`);
  }
  if (!description) {
    throw new Error(`Exocor tool "${id}" is missing a description.`);
  }
  if (typeof definition.handler !== 'function') {
    throw new Error(`Exocor tool "${id}" is missing a valid handler.`);
  }

  const parameters = Array.isArray(definition.parameters)
    ? definition.parameters.map((parameter, parameterIndex) => normalizeToolParameter(parameter, id, parameterIndex))
    : [];
  const parameterNameKeys = new Set<string>();
  for (const parameter of parameters) {
    const key = normalizeMatchValue(parameter.name);
    if (parameterNameKeys.has(key)) {
      throw new Error(`Exocor tool "${id}" declares duplicate parameter "${parameter.name}".`);
    }
    parameterNameKeys.add(key);
  }

  const routes = Array.isArray(definition.routes)
    ? definition.routes.map((route) => normalizeToolRoutePath(String(route))).filter(Boolean)
    : [];
  const uniqueRoutes = routes.filter((route, routeIndex) => routes.indexOf(route) === routeIndex);
  const safety = definition.safety || DEFAULT_TOOL_SAFETY;
  const routeTokens = uniqueRoutes.flatMap((route) => toSemanticTokens(route));
  const parameterTokens = parameters.flatMap((parameter) => [
    ...toSemanticTokens(parameter.name),
    ...toSemanticTokens(parameter.description)
  ]);

  return {
    id,
    description,
    parameters,
    routes: uniqueRoutes,
    safety,
    isGlobal: uniqueRoutes.length === 0,
    handler: definition.handler,
    idMatchKey: normalizeMatchValue(id),
    descriptionMatchKey: normalizeMatchValue(description),
    idPhrase: toSemanticPhrase(id),
    descriptionPhrase: toSemanticPhrase(description),
    idTokens: toSemanticTokens(id),
    descriptionTokens: toSemanticTokens(description),
    routeTokens,
    parameterTokens,
    requiredParameterNames: parameters.filter((parameter) => parameter.required).map((parameter) => parameter.name)
  };
}

export function toolMatchesCurrentRoute(tool: Pick<RegisteredTool, 'isGlobal' | 'routes'>, currentRoute: string): boolean {
  if (tool.isGlobal) {
    return true;
  }

  const normalizedCurrentRoute = normalizeToolRoutePath(currentRoute || '/');
  return tool.routes.some((route) => route === normalizedCurrentRoute);
}

function scoreTokenOverlap(
  commandTokens: SemanticToken[],
  toolTokens: SemanticToken[],
  strongWeight: number,
  lowSignalWeight: number
): { score: number; matchedTokens: string[] } {
  const toolTokenMap = new Map(toolTokens.map((token) => [token.token, token]));
  const matchedTokens: string[] = [];
  let score = 0;

  for (const commandToken of commandTokens) {
    const match = toolTokenMap.get(commandToken.token);
    if (!match) {
      continue;
    }

    matchedTokens.push(match.token);
    const useLowSignalWeight = commandToken.lowSignal || match.lowSignal;
    score += useLowSignalWeight ? lowSignalWeight : strongWeight;
  }

  return { score, matchedTokens };
}

function scoreToolForCommand(tool: RegisteredTool, command: string): ToolPreferenceResult {
  const semanticCommand = toSemanticPhrase(command);
  const commandTokens = toSemanticTokens(command);
  if (!semanticCommand || !commandTokens.length) {
    return { semanticScore: 0, directMatchCount: 0, hasPhraseMatch: false };
  }

  let semanticScore = 0;
  let hasPhraseMatch = false;
  const reasonParts: string[] = [];
  const matchedReasonTokens = new Set<string>();

  if (tool.descriptionPhrase && semanticCommand.includes(tool.descriptionPhrase)) {
    hasPhraseMatch = true;
    semanticScore += tool.descriptionPhrase.split(' ').length > 1 ? 4 : 2.5;
    reasonParts.push(`description phrase match: ${tool.descriptionPhrase}`);
  }

  if (tool.idPhrase && semanticCommand.includes(tool.idPhrase)) {
    hasPhraseMatch = true;
    semanticScore += tool.idPhrase.split(' ').length > 1 ? 3.5 : 2;
    reasonParts.push(`tool id phrase match: ${tool.idPhrase}`);
  }

  const descriptionScore = scoreTokenOverlap(commandTokens, tool.descriptionTokens, 2.2, 0.6);
  const idScore = scoreTokenOverlap(commandTokens, tool.idTokens, 1.8, 0.5);
  const routeScore = scoreTokenOverlap(commandTokens, tool.routeTokens, 1.1, 0.25);
  const parameterScore = scoreTokenOverlap(commandTokens, tool.parameterTokens, 0.75, 0.2);

  semanticScore += descriptionScore.score + idScore.score + routeScore.score + parameterScore.score;

  for (const token of [...descriptionScore.matchedTokens, ...idScore.matchedTokens]) {
    matchedReasonTokens.add(token);
  }

  const matchedRouteTokens = routeScore.matchedTokens.filter((token, index, tokens) => tokens.indexOf(token) === index);
  if (matchedReasonTokens.size > 0) {
    reasonParts.push(`matched terms: ${Array.from(matchedReasonTokens).join(', ')}`);
  }
  if (matchedRouteTokens.length > 0) {
    reasonParts.push(`route terms: ${matchedRouteTokens.join(', ')}`);
  }

  const directMatchCount = matchedReasonTokens.size;

  return {
    semanticScore: Number(semanticScore.toFixed(2)),
    directMatchCount,
    hasPhraseMatch,
    ...(reasonParts.length ? { preferredReason: reasonParts.join('; ') } : {})
  };
}

function selectPreferredToolIds(
  scoredTools: Array<{
    tool: RegisteredTool;
    semanticScore: number;
    directMatchCount: number;
    hasPhraseMatch: boolean;
  }>
): string[] {
  if (!scoredTools.length) {
    return [];
  }

  const qualifiesAsStrongSemanticMatch = (entry: {
    semanticScore: number;
    directMatchCount: number;
    hasPhraseMatch: boolean;
  }): boolean =>
    entry.semanticScore >= STRONG_TOOL_SCORE_THRESHOLD && (entry.hasPhraseMatch || entry.directMatchCount >= 2);

  const [top, second] = scoredTools;
  if (!top || !qualifiesAsStrongSemanticMatch(top)) {
    return [];
  }

  if (!second || !qualifiesAsStrongSemanticMatch(second)) {
    return [top.tool.id];
  }

  if (top.semanticScore - second.semanticScore >= SINGLE_TOOL_MARGIN) {
    return [top.tool.id];
  }

  if (top.semanticScore - second.semanticScore <= AMBIGUOUS_TOOL_MARGIN) {
    return [top.tool.id, second.tool.id];
  }

  return [top.tool.id];
}

function toPlannerEntry(
  tool: RegisteredTool,
  currentRoute: string,
  preference: ToolPreferenceResult,
  preferredToolIds: string[]
): ToolCapabilityEntry {
  const currentRouteMatches = toolMatchesCurrentRoute(tool, currentRoute);
  return {
    id: tool.id,
    description: tool.description,
    parameters: tool.parameters,
    routes: tool.routes,
    safety: tool.safety,
    isGlobal: tool.isGlobal,
    currentRouteMatches,
    requiresNavigation: !tool.isGlobal && !currentRouteMatches,
    semanticScore: preference.semanticScore,
    preferredForCommand: preferredToolIds.includes(tool.id),
    ...(preference.preferredReason ? { preferredReason: preference.preferredReason } : {})
  };
}

function toToolArgsRecord(args: unknown): Record<string, unknown> | null {
  if (args == null) {
    return {};
  }

  return isRecord(args) ? args : null;
}

function validateToolParameterValue(tool: RegisteredTool, parameter: ExocorToolParameter, value: unknown): string | null {
  if (parameter.type === 'string' && typeof value !== 'string') {
    return `Tool "${tool.id}" argument "${parameter.name}" must be a string.`;
  }

  if (parameter.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) {
    return `Tool "${tool.id}" argument "${parameter.name}" must be a finite number.`;
  }

  if (parameter.type === 'boolean' && typeof value !== 'boolean') {
    return `Tool "${tool.id}" argument "${parameter.name}" must be a boolean.`;
  }

  if (parameter.type === 'enum') {
    if (typeof value !== 'string') {
      return `Tool "${tool.id}" argument "${parameter.name}" must be one of: ${(parameter.options || []).join(', ')}.`;
    }

    const options = parameter.options || [];
    if (!options.includes(value)) {
      return `Tool "${tool.id}" argument "${parameter.name}" must be one of: ${options.join(', ')}.`;
    }
  }

  return null;
}

export function createToolRegistry(definitions: ExocorToolDefinition[] = []): ToolRegistry {
  const tools = definitions.map((definition, index) => normalizeToolDefinition(definition, index));
  const toolLookup = new Map<string, RegisteredTool>();

  for (const tool of tools) {
    const key = normalizeMatchValue(tool.id);
    if (toolLookup.has(key)) {
      throw new Error(`Exocor tool id "${tool.id}" is registered more than once.`);
    }
    toolLookup.set(key, tool);
  }

  return {
    tools,
    hasTools: (): boolean => tools.length > 0,
    getTool: (toolId: string): RegisteredTool | null => toolLookup.get(normalizeMatchValue(toolId || '')) || null,
    buildCapabilityMap: (currentRoute: string, command = ''): ToolCapabilityMap => {
      const normalizedCurrentRoute = normalizeToolRoutePath(currentRoute || '/');
      const scoredTools = tools
        .map((tool) => ({
          tool,
          ...scoreToolForCommand(tool, command)
        }))
        .sort((left, right) => right.semanticScore - left.semanticScore || left.tool.id.localeCompare(right.tool.id));
      const preferredToolIds = selectPreferredToolIds(scoredTools);
      const preferenceById = new Map(scoredTools.map((entry) => [entry.tool.id, entry] as const));
      const orderedTools = [...tools].sort((left, right) => {
        const leftPreference = preferenceById.get(left.id);
        const rightPreference = preferenceById.get(right.id);
        const leftPreferred = preferredToolIds.includes(left.id) ? 1 : 0;
        const rightPreferred = preferredToolIds.includes(right.id) ? 1 : 0;
        if (leftPreferred !== rightPreferred) {
          return rightPreferred - leftPreferred;
        }

        const leftRouteMatch = toolMatchesCurrentRoute(left, normalizedCurrentRoute) ? 1 : 0;
        const rightRouteMatch = toolMatchesCurrentRoute(right, normalizedCurrentRoute) ? 1 : 0;
        if (leftRouteMatch !== rightRouteMatch) {
          return rightRouteMatch - leftRouteMatch;
        }

        const scoreDelta = (rightPreference?.semanticScore || 0) - (leftPreference?.semanticScore || 0);
        if (scoreDelta !== 0) {
          return scoreDelta;
        }

        return left.id.localeCompare(right.id);
      });

      return {
        currentRoute: normalizedCurrentRoute,
        preferredToolIds,
        tools: orderedTools.map((tool) => {
          const preference = preferenceById.get(tool.id) || {
            tool,
            semanticScore: 0,
            directMatchCount: 0,
            hasPhraseMatch: false
          };
          return toPlannerEntry(tool, normalizedCurrentRoute, preference, preferredToolIds);
        })
      };
    },
    resolveDirectToolShortcut: (command: string, currentRoute: string): DirectToolShortcutMatch | null => {
      const matchKey = normalizeMatchValue(command || '');
      if (!matchKey) {
        return null;
      }

      const matches = tools.filter((tool) => tool.idMatchKey === matchKey || tool.descriptionMatchKey === matchKey);
      if (matches.length !== 1) {
        return null;
      }

      const tool = matches[0];
      if (tool.requiredParameterNames.length > 0) {
        return { type: 'planner_only', tool, reason: 'requires_params' };
      }

      if (!toolMatchesCurrentRoute(tool, currentRoute)) {
        return { type: 'planner_only', tool, reason: 'route_mismatch' };
      }

      return {
        type: 'direct_execute',
        tool
      };
    },
    validateArgs: (toolId: string, args: unknown): ToolArgsValidationResult => {
      const tool = toolLookup.get(normalizeMatchValue(toolId || '')) || null;
      if (!tool) {
        return {
          ok: false,
          tool: null,
          reason: `Tool "${toolId}" is not registered.`
        };
      }

      const argsRecord = toToolArgsRecord(args);
      if (!argsRecord) {
        return {
          ok: false,
          tool,
          reason: `Tool "${tool.id}" arguments must be an object.`
        };
      }

      const parameterMap = new Map(tool.parameters.map((parameter) => [parameter.name, parameter]));

      for (const key of Object.keys(argsRecord)) {
        if (!parameterMap.has(key)) {
          return {
            ok: false,
            tool,
            reason: `Tool "${tool.id}" does not declare argument "${key}".`
          };
        }
      }

      for (const parameter of tool.parameters) {
        const hasValue = Object.prototype.hasOwnProperty.call(argsRecord, parameter.name);
        const value = argsRecord[parameter.name];

        if (parameter.required && (!hasValue || value == null)) {
          return {
            ok: false,
            tool,
            reason: `Tool "${tool.id}" requires argument "${parameter.name}".`
          };
        }

        if (!hasValue || value == null) {
          continue;
        }

        const valueError = validateToolParameterValue(tool, parameter, value);
        if (valueError) {
          return {
            ok: false,
            tool,
            reason: valueError
          };
        }
      }

      return {
        ok: true,
        tool,
        args: argsRecord
      };
    }
  };
}
