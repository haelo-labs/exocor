import type { CommandInputMethod } from '../../types';
import type {
  CommandHistoryItem,
  CommandInputMethod as CommandHistoryInputMethod
} from '../ChatPanel';
import { isRecord } from './commandRuntime';

export const HISTORY_STORAGE_KEY = 'exocor.command-history.v1';
export const LEGACY_HISTORY_STORAGE_KEY = 'haelo.command-history.v1';
export const HISTORY_SESSION_STORAGE_KEY = LEGACY_HISTORY_STORAGE_KEY;

const HISTORY_STATUSES = new Set<CommandHistoryItem['status']>([
  'planning',
  'executing',
  'done',
  'failed',
  'clarification'
]);

const HISTORY_INPUT_METHODS = new Set<CommandHistoryInputMethod>(['voice', 'typed', 'gaze']);

export function toHistoryInputMethod(inputMethod: CommandInputMethod): CommandHistoryInputMethod {
  if (inputMethod === 'voice') {
    return 'voice';
  }
  if (inputMethod === 'text') {
    return 'typed';
  }
  return 'gaze';
}

export function statusFromFailureMessage(_message: string): CommandHistoryItem['status'] {
  return 'failed';
}

export function sanitizePersistedHistory(raw: unknown): CommandHistoryItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const now = Date.now();
  const fallbackTraceAt = now;

  return raw
    .map((entry, index) => {
      if (!isRecord(entry)) {
        return null;
      }

      const rawStatus = typeof entry.status === 'string' ? entry.status : '';
      const status = HISTORY_STATUSES.has(rawStatus as CommandHistoryItem['status'])
        ? (rawStatus as CommandHistoryItem['status'])
        : 'failed';

      const rawInputMethod = typeof entry.inputMethod === 'string' ? entry.inputMethod : '';
      const inputMethod = HISTORY_INPUT_METHODS.has(rawInputMethod as CommandHistoryInputMethod)
        ? (rawInputMethod as CommandHistoryInputMethod)
        : 'typed';

      const traces = Array.isArray(entry.traces)
        ? entry.traces
            .map((trace, traceIndex) => {
              if (!isRecord(trace)) {
                return null;
              }
              const label = typeof trace.label === 'string' ? trace.label : '';
              if (!label) {
                return null;
              }

              return {
                id:
                  typeof trace.id === 'string' && trace.id
                    ? trace.id
                    : `trace-${fallbackTraceAt}-${index}-${traceIndex}`,
                label,
                at: typeof trace.at === 'number' && Number.isFinite(trace.at) ? trace.at : fallbackTraceAt
              };
            })
            .filter((trace): trace is CommandHistoryItem['traces'][number] => Boolean(trace))
        : [];

      return {
        id:
          typeof entry.id === 'string' && entry.id
            ? entry.id
            : `cmd-${fallbackTraceAt}-${index}`,
        command: typeof entry.command === 'string' ? entry.command : '',
        status,
        inputMethod,
        createdAt:
          typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt)
            ? entry.createdAt
            : fallbackTraceAt,
        traces,
        ...(typeof entry.message === 'string' ? { message: entry.message } : {})
      };
    })
    .filter((entry): entry is CommandHistoryItem => Boolean(entry));
}

export function normalizeHistoryStoragePath(pathname: string): string {
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

export function normalizeHistoryStorageTitle(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase() || 'untitled';
}

function hashHistoryStorageSignature(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function buildStableHistoryStorageKey(routePath: string, title: string, baseKey = HISTORY_STORAGE_KEY): string {
  const origin = typeof window === 'undefined' ? 'server' : window.location.origin || 'unknown-origin';
  const normalizedRoute = normalizeHistoryStoragePath(routePath);
  const normalizedTitle = normalizeHistoryStorageTitle(title);
  const signature = `${origin}||route:${normalizedRoute}||title:${normalizedTitle}`;
  return `${baseKey}::scope-${hashHistoryStorageSignature(signature)}`;
}

export function getAllHistoryStorageKeys(stableRoutePath: string, stableTitle: string): string[] {
  return [buildStableHistoryStorageKey(stableRoutePath, stableTitle)];
}

export function getLegacyHistoryStorageKeys(stableRoutePath: string, stableTitle: string): string[] {
  return [buildStableHistoryStorageKey(stableRoutePath, stableTitle, LEGACY_HISTORY_STORAGE_KEY)];
}
