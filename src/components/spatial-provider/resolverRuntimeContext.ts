import * as DOMScannerModule from '../../core/DOMScanner';
import type { DOMScannerPolicy } from '../../core/DOMScanner';
import type { CommandInputMethod, DOMCapabilityMap, GazeState } from '../../types';
import { resolveFocusedElement } from './hostDomUtils';

export function resolveGazeTarget(
  map: DOMCapabilityMap,
  gazeState: GazeState,
  scannerPolicy?: DOMScannerPolicy
): { elementId: string | null; componentName: string | null; text: string } | null {
  if (gazeState.gazeTarget) {
    const matchedElement =
      map.elements.find((element) => element.id === gazeState.gazeTarget) ||
      map.elements.find((element) => element.selector === gazeState.gazeTarget) ||
      DOMScannerModule.scanDOM(scannerPolicy).elements.find(
        (element) => element.id === gazeState.gazeTarget || element.selector === gazeState.gazeTarget
      );
    return {
      elementId: matchedElement?.id || gazeState.gazeTarget,
      componentName: matchedElement?.componentName || null,
      text: matchedElement?.text || matchedElement?.label || ''
    };
  }

  if (!gazeState.isCalibrated) {
    return null;
  }

  const { gazeX, gazeY } = gazeState;
  if (!Number.isFinite(gazeX) || !Number.isFinite(gazeY)) {
    return null;
  }

  const atPoint = map.elements
    .filter((element) => element.visible !== false)
    .filter((element) => {
      const { x, y, width, height } = element.rect;
      return gazeX >= x && gazeX <= x + width && gazeY >= y && gazeY <= y + height;
    })
    .sort((a, b) => a.rect.width * a.rect.height - (b.rect.width * b.rect.height));

  const fallback = atPoint[0];
  if (!fallback) {
    return null;
  }

  return {
    elementId: fallback.id,
    componentName: fallback.componentName || null,
    text: fallback.text || fallback.label || ''
  };
}

export function buildEnrichedContext(
  inputMethod: CommandInputMethod,
  map: DOMCapabilityMap,
  gazeState: GazeState,
  preferredFocusedElement: HTMLElement | null = null,
  preferredTextEntryElement: HTMLElement | null = null,
  scannerPolicy?: DOMScannerPolicy
): Record<string, unknown> {
  if (inputMethod === 'text') {
    return {
      inputMethod: 'typed',
      focusedElement: resolveFocusedElement(map, preferredFocusedElement, preferredTextEntryElement),
      selectedText: window.getSelection?.()?.toString() || ''
    };
  }

  return {
    inputMethod,
    gazeTarget: resolveGazeTarget(map, gazeState, scannerPolicy),
    gazePosition: {
      x: gazeState.gazeX,
      y: gazeState.gazeY
    }
  };
}
