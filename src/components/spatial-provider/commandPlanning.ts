import { isSubmitLikeCompletionStep } from '../../core/ActionExecutor';
import type { IntentPlan, IntentStep, ToolCapabilityEntry, ToolCapabilityMap } from '../../types';
import { normalizeCommand } from './commandRuntime';

export function commandExplicitlyRequestsNavigation(command: string): boolean {
  const normalized = normalizeCommand(command).toLowerCase();
  if (!normalized) {
    return false;
  }

  if (/\/[a-z0-9/_-]+/.test(normalized)) {
    return true;
  }

  return /\b(navigate|go to|take me to|bring me to|switch to|open page|open route|visit|show page|show screen)\b/.test(
    normalized
  );
}

export function sanitizePlanStepsForUnrequestedPostSubmitNavigation(
  steps: IntentStep[],
  command: string
): IntentStep[] {
  if (!steps.length) {
    return steps;
  }
  const sanitizeStep = createStreamingStepSanitizer(command);
  const sanitized: IntentStep[] = [];
  for (const step of steps) {
    const accepted = sanitizeStep(step);
    if (accepted) {
      sanitized.push(accepted);
    }
  }
  return sanitized;
}

export function createStreamingStepSanitizer(command: string): (step: IntentStep) => IntentStep | null {
  if (commandExplicitlyRequestsNavigation(command)) {
    return (step: IntentStep) => step;
  }

  let submitLikeCompletionSeen = false;
  return (step: IntentStep): IntentStep | null => {
    if (
      submitLikeCompletionSeen &&
      step.action === 'navigate' &&
      step.target &&
      step.target.startsWith('/')
    ) {
      return null;
    }

    if (
      isSubmitLikeCompletionStep({
        step,
        resolvedTargetLabel: step.target || ''
      })
    ) {
      submitLikeCompletionSeen = true;
    }

    return step;
  };
}

export interface AsyncStepQueue {
  iterable: AsyncIterable<IntentStep>;
  push: (step: IntentStep) => void;
  close: () => void;
}

export function createAsyncStepQueue(): AsyncStepQueue {
  const values: IntentStep[] = [];
  const waiting: Array<(result: IteratorResult<IntentStep>) => void> = [];
  let closed = false;

  const iterable: AsyncIterable<IntentStep> = {
    [Symbol.asyncIterator](): AsyncIterator<IntentStep> {
      return {
        next(): Promise<IteratorResult<IntentStep>> {
          if (values.length) {
            const value = values.shift() as IntentStep;
            return Promise.resolve({ value, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve) => {
            waiting.push(resolve);
          });
        },
        return(): Promise<IteratorResult<IntentStep>> {
          closed = true;
          while (waiting.length) {
            const resolve = waiting.shift();
            resolve?.({ value: undefined, done: true });
          }
          return Promise.resolve({ value: undefined, done: true });
        }
      };
    }
  };

  return {
    iterable,
    push: (step: IntentStep): void => {
      if (closed) {
        return;
      }
      if (waiting.length) {
        const resolve = waiting.shift();
        resolve?.({ value: step, done: false });
        return;
      }
      values.push(step);
    },
    close: (): void => {
      if (closed) {
        return;
      }
      closed = true;
      while (waiting.length) {
        const resolve = waiting.shift();
        resolve?.({ value: undefined, done: true });
      }
    }
  };
}

export function buildDirectToolPlan(command: string, toolId: string): IntentPlan {
  return {
    source: 'deterministic',
    rawCommand: normalizeCommand(command),
    confidence: 0.99,
    steps: [
      {
        action: 'tool',
        toolId,
        args: {},
        reason: 'use explicit app-native tool'
      }
    ]
  };
}

export function buildAuthoritativePreferredToolPlan(
  command: string,
  preferredTool: ToolCapabilityEntry,
  args: Record<string, unknown>
): IntentPlan {
  const steps: IntentStep[] = [];

  if (!preferredTool.isGlobal && !preferredTool.currentRouteMatches && preferredTool.routes[0]) {
    steps.push({
      action: 'navigate',
      target: preferredTool.routes[0],
      value: null,
      waitForDOM: true,
      reason: `navigate to ${preferredTool.routes[0]} for app-native tool`
    });
  }

  steps.push({
    action: 'tool',
    toolId: preferredTool.id,
    args,
    reason: 'use preferred app-native tool'
  });

  return {
    source: 'deterministic',
    rawCommand: normalizeCommand(command),
    confidence: 0.99,
    steps
  };
}

export function getPreferredToolEntries(toolCapabilityMap: ToolCapabilityMap | null): ToolCapabilityEntry[] {
  if (!toolCapabilityMap?.preferredToolIds?.length) {
    return [];
  }

  return toolCapabilityMap.tools.filter((tool) => toolCapabilityMap.preferredToolIds.includes(tool.id));
}

export function getStrongPreferredTool(toolCapabilityMap: ToolCapabilityMap | null): ToolCapabilityEntry | null {
  const preferredTools = getPreferredToolEntries(toolCapabilityMap);
  return preferredTools.length === 1 ? preferredTools[0] : null;
}

export function planUsesTool(plan: IntentPlan, toolId: string): boolean {
  return plan.steps.some((step) => step.action === 'tool' && (step.toolId || step.target) === toolId);
}

export function isNavigateThenToolPlan(plan: IntentPlan, toolId: string): boolean {
  const steps = plan.steps.filter((step) => step.action !== 'wait');
  const toolIndex = steps.findIndex((step) => step.action === 'tool' && (step.toolId || step.target) === toolId);
  if (toolIndex <= 0) {
    return false;
  }

  return steps.slice(0, toolIndex).some((step) => step.action === 'navigate' && step.target?.startsWith('/'));
}
