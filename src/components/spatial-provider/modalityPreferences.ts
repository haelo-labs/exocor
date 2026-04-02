import type { Modality } from '../../types';
import { isRecord } from './commandRuntime';

export const DEFAULT_MODALITIES: Array<'voice' | 'gaze' | 'gesture'> = ['voice', 'gaze', 'gesture'];
export const ACTIVE_MODALITIES_STORAGE_KEY = 'exocor.active-modalities.v1';

export type ActiveModalities = Record<Modality, boolean>;

export function normalizeActiveModalities(
  availableModalities: readonly Modality[],
  activeModalities: ActiveModalities
): ActiveModalities {
  const available = new Set<Modality>(availableModalities);
  const next: ActiveModalities = {
    voice: available.has('voice') ? activeModalities.voice : false,
    gaze: available.has('gaze') ? activeModalities.gaze : false,
    gesture: available.has('gesture') ? activeModalities.gesture : false
  };

  if (available.has('gaze') && next.gesture) {
    next.gaze = true;
  }

  return next;
}

export function defaultActiveModalities(availableModalities: readonly Modality[]): ActiveModalities {
  const available = new Set<Modality>(availableModalities);
  return normalizeActiveModalities(availableModalities, {
    voice: false,
    gaze: available.has('gaze'),
    gesture: available.has('gesture')
  });
}

export function sanitizePersistedActiveModalities(raw: unknown): Partial<ActiveModalities> | null {
  if (!isRecord(raw)) {
    return null;
  }

  const next: Partial<ActiveModalities> = {};
  for (const modality of DEFAULT_MODALITIES) {
    const value = raw[modality];
    if (typeof value === 'boolean') {
      next[modality] = value;
    }
  }

  return next;
}

export function readPersistedActiveModalities(storageKey: string): Partial<ActiveModalities> | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const raw = window.localStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }

  try {
    return sanitizePersistedActiveModalities(JSON.parse(raw) as unknown);
  } catch {
    window.localStorage.removeItem(storageKey);
    return null;
  }
}

export function createActiveModalities(
  availableModalities: readonly Modality[],
  ...sources: Array<Partial<ActiveModalities> | null | undefined>
): ActiveModalities {
  const defaults = defaultActiveModalities(availableModalities);
  const available = new Set<Modality>(availableModalities);
  const next = { ...defaults };

  for (const modality of DEFAULT_MODALITIES) {
    if (!available.has(modality)) {
      next[modality] = false;
      continue;
    }

    for (const source of sources) {
      if (typeof source?.[modality] === 'boolean') {
        next[modality] = source[modality] as boolean;
        break;
      }
    }
  }

  return normalizeActiveModalities(availableModalities, next);
}
