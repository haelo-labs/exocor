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
  buildCapabilityMap: (currentRoute: string) => ToolCapabilityMap;
  resolveDirectToolShortcut: (command: string, currentRoute: string) => DirectToolShortcutMatch | null;
  validateArgs: (toolId: string, args: unknown) => ToolArgsValidationResult;
}

function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeMatchValue(value: string): string {
  return normalizeWhitespace(value).toLowerCase();
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

function toPlannerEntry(tool: RegisteredTool, currentRoute: string): ToolCapabilityEntry {
  const currentRouteMatches = toolMatchesCurrentRoute(tool, currentRoute);
  return {
    id: tool.id,
    description: tool.description,
    parameters: tool.parameters,
    routes: tool.routes,
    safety: tool.safety,
    isGlobal: tool.isGlobal,
    currentRouteMatches,
    requiresNavigation: !tool.isGlobal && !currentRouteMatches
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
    buildCapabilityMap: (currentRoute: string): ToolCapabilityMap => {
      const normalizedCurrentRoute = normalizeToolRoutePath(currentRoute || '/');
      return {
        currentRoute: normalizedCurrentRoute,
        tools: tools.map((tool) => toPlannerEntry(tool, normalizedCurrentRoute))
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
