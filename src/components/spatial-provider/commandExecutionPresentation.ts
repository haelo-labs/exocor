import type { IntentAction, IntentStep } from '../../types';

export function stepToIntent(
  step: IntentStep,
  source: IntentAction['source'],
  rawCommand: string
): IntentAction | null {
  if (step.action === 'wait') {
    return null;
  }

  const toolId = step.toolId || step.target || '';
  return {
    action: step.action,
    target: step.target || toolId,
    value: step.value ?? null,
    ...(toolId ? { toolId } : {}),
    ...(step.args ? { args: step.args } : {}),
    confidence: 0.9,
    source,
    rawCommand
  };
}

export function formatProgress(step: IntentStep): string {
  if (step.action === 'tool') {
    const toolId = step.toolId || step.target || 'unknown-tool';
    return `Used app-native tool: ${toolId}`;
  }
  const reason = step.reason || step.action;
  return `${reason.charAt(0).toUpperCase()}${reason.slice(1)}...`;
}
