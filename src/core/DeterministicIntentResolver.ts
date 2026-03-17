import type { DOMElementDescriptor, IntentPlan, IntentResolutionInput, ResolutionPriority } from '../types';

export interface DeterministicResolvedIntent {
  plan: IntentPlan;
  resolutionPriority: ResolutionPriority;
}

type ParsedCommand =
  | { type: 'gaze_activate'; rawTarget?: undefined }
  | { type: 'navigate'; rawTarget: string }
  | { type: 'activate'; rawTarget: string }
  | { type: 'open'; rawTarget: string };

interface TargetMetadata {
  normalized: string;
  labelKey: string;
}

interface LiveDomMatch {
  label: string;
  target: string;
}

const GAZE_ACTIVATION_PATTERNS = [
  /^(?:open|click|press|select|choose)$/i,
  /^(?:open|click|press|select|choose)\s+(?:this|that|it|there|here)$/i,
  /^(?:yes|ok|okay|confirm)$/i,
  /^(?:yes|ok|okay|confirm)\s+(?:this|that|it)$/i,
  /^go there$/i
] as const;
const NAVIGATION_PATTERN = /^(?:go to|navigate to|take me to|bring me to|switch to|visit)\s+(.+)$/i;
const DIRECT_ACTIVATION_PATTERN = /^(?:click|press|select)\s+(.+)$/i;
const OPEN_PATTERN = /^open\s+(.+)$/i;
const COMPLEX_TARGET_PATTERN = /(?:^|[\s,;:])(?:and|then|with|using|after|before)(?:[\s,;:]|$)/i;
const DYNAMIC_TARGET_PATTERNS: RegExp[] = [
  /\b(?:ticket|incident|order|user|task|case|item|result|row|record)\s+#?\d+\b/i,
  /\b(?:row|result|item|record)\s+(?:number|no\.?)\s*\d+\b/i,
  /\b(?:first|second|third|\d+(?:st|nd|rd|th))\s+(?:result|row|item)\b/i,
  /\bresult\s*#\s*\d+\b/i,
  /\bid\s*[:#]?\s*[a-z0-9-]{2,}\b/i
] as const;

function normalizeCommand(command: string): string {
  return command.trim().replace(/\s+/g, ' ');
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s/_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toLabelKey(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function buildTargetMetadata(rawTarget: string): TargetMetadata | null {
  const stripped = normalizeText(rawTarget)
    .replace(/^(?:the|a|an)\s+/i, '')
    .replace(/\b(?:page|screen|tab|route)\s*$/i, '')
    .trim();

  if (!stripped) {
    return null;
  }

  return {
    normalized: stripped,
    labelKey: toLabelKey(stripped)
  };
}

function matchesTarget(candidate: string, target: TargetMetadata): boolean {
  if (!candidate.trim()) {
    return false;
  }

  return normalizeText(candidate) === target.normalized || toLabelKey(candidate) === target.labelKey;
}

function isInteractiveElement(element: DOMElementDescriptor | null): boolean {
  if (!element || element.disabled || element.visible === false) {
    return false;
  }

  const tagName = element.tagName.toLowerCase();
  const role = (element.role || '').toLowerCase();
  const type = (element.type || '').toLowerCase();

  if (tagName === 'a' || tagName === 'button' || tagName === 'select') {
    return true;
  }

  if (tagName === 'input' && ['button', 'submit', 'reset', 'checkbox', 'radio'].includes(type)) {
    return true;
  }

  return ['button', 'link', 'tab', 'menuitem', 'option', 'checkbox', 'radio', 'switch', 'combobox'].includes(role);
}

function parseSupportedCommand(command: string): ParsedCommand | null {
  const normalized = normalizeCommand(command);
  if (!normalized) {
    return null;
  }

  if (GAZE_ACTIVATION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return { type: 'gaze_activate' };
  }

  const navigationMatch = normalized.match(NAVIGATION_PATTERN);
  if (navigationMatch?.[1]) {
    return { type: 'navigate', rawTarget: navigationMatch[1].trim() };
  }

  const activationMatch = normalized.match(DIRECT_ACTIVATION_PATTERN);
  if (activationMatch?.[1]) {
    return { type: 'activate', rawTarget: activationMatch[1].trim() };
  }

  const openMatch = normalized.match(OPEN_PATTERN);
  if (openMatch?.[1]) {
    return { type: 'open', rawTarget: openMatch[1].trim() };
  }

  return null;
}

function isResolvableSingleTarget(rawTarget: string): boolean {
  const normalized = normalizeCommand(rawTarget);
  if (!normalized) {
    return false;
  }

  if (COMPLEX_TARGET_PATTERN.test(normalized) || /[,;:]/.test(normalized)) {
    return false;
  }

  return !DYNAMIC_TARGET_PATTERNS.some((pattern) => pattern.test(normalized));
}

function elementMatchesTarget(element: DOMElementDescriptor, target: TargetMetadata): boolean {
  return [element.label, element.text, element.ariaLabel || '', element.href || ''].some((candidate) =>
    matchesTarget(candidate || '', target)
  );
}

function collectLiveDomMatches(
  map: IntentResolutionInput['map'],
  target: TargetMetadata,
  fallbackLabel: string
): LiveDomMatch[] {
  const byId = new Map<string, LiveDomMatch>();

  for (const element of map.elements) {
    if (!isInteractiveElement(element) || !elementMatchesTarget(element, target)) {
      continue;
    }

    byId.set(element.id, {
      label: element.label || element.text || element.ariaLabel || fallbackLabel,
      target: element.id
    });
  }

  return Array.from(byId.values());
}

function buildDeterministicPlan(command: string, target: string, reason: string): DeterministicResolvedIntent {
  return {
    plan: {
      source: 'deterministic',
      rawCommand: normalizeCommand(command),
      confidence: 0.99,
      steps: [
        {
          action: 'click',
          target,
          value: null,
          waitForDOM: true,
          reason
        }
      ]
    },
    resolutionPriority: 'dom_only'
  };
}

export class DeterministicIntentResolver {
  resolve(input: IntentResolutionInput): DeterministicResolvedIntent | null {
    const parsed = parseSupportedCommand(input.command);
    if (!parsed) {
      return null;
    }

    if (parsed.type === 'gaze_activate') {
      const gazeElement = input.map.elements.find((element) => element.id === input.gazeTarget) || null;
      if (!input.gazeTarget || !isInteractiveElement(gazeElement)) {
        return null;
      }

      return buildDeterministicPlan(input.command, input.gazeTarget, 'activate gaze target');
    }

    if (!isResolvableSingleTarget(parsed.rawTarget)) {
      return null;
    }

    const target = buildTargetMetadata(parsed.rawTarget);
    if (!target) {
      return null;
    }

    const matches = collectLiveDomMatches(input.map, target, parsed.rawTarget);
    if (matches.length !== 1) {
      return null;
    }

    const match = matches[0];
    if (parsed.type === 'navigate') {
      return buildDeterministicPlan(input.command, match.target, `navigate to ${match.label}`);
    }

    if (parsed.type === 'activate') {
      return buildDeterministicPlan(input.command, match.target, `click ${match.label}`);
    }

    return buildDeterministicPlan(input.command, match.target, `open ${match.label}`);
  }
}
