import { SDK_LIGHT_DOM_STYLES } from './sdkUiStyles';

export const SDK_UI_ATTRIBUTE = 'data-exocor-ui';
export const SDK_UI_SELECTOR = `[${SDK_UI_ATTRIBUTE}="true"]`;
export const SDK_UI_MARKER = {
  [SDK_UI_ATTRIBUTE]: 'true'
} as const;

const SDK_STYLE_ELEMENT_ID = 'exocor-sdk-ui-styles';

export function isSdkUiElement(element: Element | null | undefined): boolean {
  if (!element) {
    return false;
  }

  if (element.closest(SDK_UI_SELECTOR)) {
    return true;
  }

  const root = typeof element.getRootNode === 'function' ? element.getRootNode() : null;
  if (root instanceof ShadowRoot) {
    return Boolean(root.host?.matches?.(SDK_UI_SELECTOR));
  }

  return false;
}

export function ensureSdkUiStylesInjected(target?: Document | ShadowRoot): void {
  if (typeof document === 'undefined') {
    return;
  }

  const resolvedTarget = target ?? document;
  const existing =
    resolvedTarget instanceof Document
      ? resolvedTarget.getElementById(SDK_STYLE_ELEMENT_ID)
      : resolvedTarget.querySelector(`#${SDK_STYLE_ELEMENT_ID}`);
  if (existing instanceof HTMLStyleElement) {
    if (existing.textContent !== SDK_LIGHT_DOM_STYLES) {
      existing.textContent = SDK_LIGHT_DOM_STYLES;
    }
    return;
  }

  const style = document.createElement('style');
  style.id = SDK_STYLE_ELEMENT_ID;
  style.textContent = SDK_LIGHT_DOM_STYLES;
  if (resolvedTarget instanceof Document) {
    resolvedTarget.head.appendChild(style);
    return;
  }

  resolvedTarget.appendChild(style);
}
