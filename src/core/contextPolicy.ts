import type {
  ExocorContextMode,
  ExocorContextPolicy,
  ExocorRedactionField,
  ExocorRedactionRule,
  ExocorSectionMode,
  ExocorTrustPolicy
} from '../types';

export const DEFAULT_CONTEXT_MODE: ExocorContextMode = 'full';
export const DEFAULT_CONTEXT_TOKEN_BUDGETS: Record<ExocorContextMode, number> = {
  full: 2400,
  balanced: 1500,
  lean: 900
};

const DEFAULT_SECTION_MODE: ExocorSectionMode = 'auto';
const DEFAULT_REDACTION_REPLACEMENT = '[redacted]';

const REDACTION_FIELDS: ExocorRedactionField[] = ['label', 'text', 'value', 'placeholder', 'ariaLabel', 'name'];

export interface ResolvedExocorContextPolicy {
  mode: ExocorContextMode;
  maxContextTokens: number;
  sections: {
    appMap: ExocorSectionMode;
    liveDom: ExocorSectionMode;
    dialogs: ExocorSectionMode;
    forms: ExocorSectionMode;
    tablesAndLists: ExocorSectionMode;
    gaze: ExocorSectionMode;
    selectedText: ExocorSectionMode;
    tools: ExocorSectionMode;
  };
}

export interface ResolvedExocorRedactionRule {
  selector: string;
  fields: ExocorRedactionField[];
  replace: string;
}

export interface ResolvedExocorTrustPolicy {
  features: {
    remoteResolver: boolean;
    appMapDiscovery: boolean;
    liveDomScanning: boolean;
    reactHints: boolean;
    routerHints: boolean;
    tools: boolean;
  };
  neverScan: string[];
  neverSend: string[];
  redact: ResolvedExocorRedactionRule[];
}

function normalizeSelectorList(selectors: string[] | undefined): string[] {
  if (!Array.isArray(selectors)) {
    return [];
  }

  return selectors.map((selector) => selector.trim()).filter(Boolean);
}

function normalizeSectionMode(value: ExocorSectionMode | undefined): ExocorSectionMode {
  return value === 'always' || value === 'never' || value === 'auto' ? value : DEFAULT_SECTION_MODE;
}

function normalizeRedactionFields(fields: ExocorRedactionField[] | undefined): ExocorRedactionField[] {
  if (!Array.isArray(fields) || !fields.length) {
    return REDACTION_FIELDS;
  }

  return fields.filter((field, index) => REDACTION_FIELDS.includes(field) && fields.indexOf(field) === index);
}

export function resolveContextPolicy(policy: ExocorContextPolicy | undefined): ResolvedExocorContextPolicy {
  const mode = policy?.mode === 'balanced' || policy?.mode === 'lean' || policy?.mode === 'full'
    ? policy.mode
    : DEFAULT_CONTEXT_MODE;
  const maxContextTokens =
    typeof policy?.maxContextTokens === 'number' && Number.isFinite(policy.maxContextTokens) && policy.maxContextTokens > 0
      ? Math.round(policy.maxContextTokens)
      : DEFAULT_CONTEXT_TOKEN_BUDGETS[mode];

  return {
    mode,
    maxContextTokens,
    sections: {
      appMap: normalizeSectionMode(policy?.sections?.appMap),
      liveDom: normalizeSectionMode(policy?.sections?.liveDom),
      dialogs: normalizeSectionMode(policy?.sections?.dialogs),
      forms: normalizeSectionMode(policy?.sections?.forms),
      tablesAndLists: normalizeSectionMode(policy?.sections?.tablesAndLists),
      gaze: normalizeSectionMode(policy?.sections?.gaze),
      selectedText: normalizeSectionMode(policy?.sections?.selectedText),
      tools: normalizeSectionMode(policy?.sections?.tools)
    }
  };
}

export function resolveTrustPolicy(policy: ExocorTrustPolicy | undefined): ResolvedExocorTrustPolicy {
  return {
    features: {
      remoteResolver: policy?.features?.remoteResolver !== false,
      appMapDiscovery: policy?.features?.appMapDiscovery !== false,
      liveDomScanning: policy?.features?.liveDomScanning !== false,
      reactHints: policy?.features?.reactHints !== false,
      routerHints: policy?.features?.routerHints !== false,
      tools: policy?.features?.tools !== false
    },
    neverScan: normalizeSelectorList(policy?.neverScan),
    neverSend: normalizeSelectorList(policy?.neverSend),
    redact: Array.isArray(policy?.redact)
      ? policy.redact
          .map((rule) => normalizeRedactionRule(rule))
          .filter((rule): rule is ResolvedExocorRedactionRule => Boolean(rule))
      : []
  };
}

function normalizeRedactionRule(rule: ExocorRedactionRule | undefined): ResolvedExocorRedactionRule | null {
  const selector = rule?.selector?.trim() || '';
  if (!selector) {
    return null;
  }

  return {
    selector,
    fields: normalizeRedactionFields(rule.fields),
    replace: rule?.replace?.trim() || DEFAULT_REDACTION_REPLACEMENT
  };
}

function stringSelectorCandidateMatches(candidate: string, selector: string): boolean {
  const normalizedCandidate = candidate.trim();
  const normalizedSelector = selector.trim();
  if (!normalizedCandidate || !normalizedSelector) {
    return false;
  }

  return (
    normalizedCandidate === normalizedSelector ||
    normalizedCandidate.startsWith(`${normalizedSelector} `) ||
    normalizedCandidate.startsWith(`${normalizedSelector}>`) ||
    normalizedCandidate.includes(`${normalizedSelector} `) ||
    normalizedCandidate.includes(`${normalizedSelector}>`) ||
    normalizedCandidate.includes(normalizedSelector)
  );
}

export function matchesPolicySelectors(options: {
  policySelectors: readonly string[];
  element?: Element | null;
  selector?: string | null;
  selectorCandidates?: Array<string | null | undefined>;
}): boolean {
  const { policySelectors, element, selector, selectorCandidates } = options;
  if (!policySelectors.length) {
    return false;
  }

  for (const policySelector of policySelectors) {
    if (!policySelector) {
      continue;
    }

    if (element) {
      try {
        if (element.matches(policySelector) || Boolean(element.closest(policySelector))) {
          return true;
        }
      } catch {
        // Ignore invalid developer selectors here and fall back to string matching.
      }
    }

    const candidates = [
      selector,
      ...(Array.isArray(selectorCandidates) ? selectorCandidates : [])
    ]
      .map((candidate) => candidate?.trim() || '')
      .filter(Boolean);
    if (candidates.some((candidate) => stringSelectorCandidateMatches(candidate, policySelector))) {
      return true;
    }
  }

  return false;
}

export function findMatchingRedactionRule(options: {
  rules: readonly ResolvedExocorRedactionRule[];
  field: ExocorRedactionField;
  element?: Element | null;
  selector?: string | null;
  selectorCandidates?: Array<string | null | undefined>;
}): ResolvedExocorRedactionRule | null {
  const { rules, field, element, selector, selectorCandidates } = options;
  for (const rule of rules) {
    if (!rule.fields.includes(field)) {
      continue;
    }
    if (
      matchesPolicySelectors({
        policySelectors: [rule.selector],
        element,
        selector,
        selectorCandidates
      })
    ) {
      return rule;
    }
  }

  return null;
}

export function applyRedactionRule(
  value: string,
  options: {
    rules: readonly ResolvedExocorRedactionRule[];
    field: ExocorRedactionField;
    element?: Element | null;
    selector?: string | null;
    selectorCandidates?: Array<string | null | undefined>;
  }
): string {
  const rule = findMatchingRedactionRule(options);
  if (!rule || !value) {
    return value;
  }
  return rule.replace;
}
