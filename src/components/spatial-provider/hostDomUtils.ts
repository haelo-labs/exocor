import type { DOMCapabilityMap, DOMElementDescriptor } from '../../types';
import { isSdkUiElement } from '../../core/sdkUi';

function escapeCss(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

export function resolveSelectorForElement(element: Element | null): string | null {
  if (!element) {
    return null;
  }

  const htmlElement = element as HTMLElement;
  if (htmlElement.id) {
    return `#${escapeCss(htmlElement.id)}`;
  }

  const testId = htmlElement.getAttribute('data-testid') || htmlElement.getAttribute('data-test-id');
  if (testId) {
    return `[data-testid="${escapeCss(testId)}"]`;
  }

  const name = htmlElement.getAttribute('name');
  if (name) {
    return `${htmlElement.tagName.toLowerCase()}[name="${escapeCss(name)}"]`;
  }

  return htmlElement.tagName.toLowerCase();
}

export function isTextEntryElement(element: HTMLElement | null): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  const tagName = element.tagName.toLowerCase();
  if (tagName === 'textarea' || tagName === 'select') {
    return true;
  }

  if (tagName !== 'input') {
    return false;
  }

  const inputType = ((element as HTMLInputElement).type || '').toLowerCase();
  return !['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'hidden', 'image'].includes(
    inputType
  );
}

export function findElementByNode(node: HTMLElement, elements: DOMElementDescriptor[]): DOMElementDescriptor | null {
  for (const element of elements) {
    if (!element.selector) {
      continue;
    }

    try {
      if (node.matches(element.selector)) {
        return element;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function resolveFocusedElement(
  map: DOMCapabilityMap,
  preferredFocusedElement: HTMLElement | null = null,
  preferredTextEntryElement: HTMLElement | null = null
): { elementId: string | null; componentName: string | null; type: string | null } | null {
  const activeElement = document.activeElement;
  const fallbackFocusedElement =
    preferredFocusedElement instanceof HTMLElement && preferredFocusedElement.isConnected ? preferredFocusedElement : null;
  const fallbackTextEntryElement =
    preferredTextEntryElement instanceof HTMLElement && preferredTextEntryElement.isConnected
      ? preferredTextEntryElement
      : null;
  const resolvedElement =
    activeElement instanceof HTMLElement && !isSdkUiElement(activeElement)
      ? activeElement
      : fallbackTextEntryElement || fallbackFocusedElement;

  if (!(resolvedElement instanceof HTMLElement) || isSdkUiElement(resolvedElement)) {
    return null;
  }

  const matchedElement = findElementByNode(resolvedElement, map.elements);
  return {
    elementId: matchedElement?.id || null,
    componentName: matchedElement?.componentName || null,
    type:
      (resolvedElement as HTMLInputElement).type ||
      resolvedElement.getAttribute('role') ||
      resolvedElement.tagName.toLowerCase()
  };
}
