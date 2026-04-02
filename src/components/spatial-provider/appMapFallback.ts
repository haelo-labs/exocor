import { APP_MAP_VERSION } from '../../core/DOMScanner';
import type { AppMap, DOMCapabilityMap } from '../../types';

function toLabelKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function buildFallbackAppMapFromDom(map: DOMCapabilityMap): AppMap {
  const path = map.currentRoute || window.location.pathname || '/';
  const visibleSurface = map.dialogs.find((dialog) => dialog.isOpen);
  const routeTitle = map.pageTitle || document.title || path;
  const formFields = map.formState.map((field) => ({
    elementId: field.selector,
    label: field.label || field.name || field.selector,
    type: field.type || 'input',
    required: false,
    selectorCandidates: [field.selector]
  }));
  const buttons = map.buttonsState.map((button) => ({
    elementId: button.selector,
    label: button.label || button.selector,
    selectorCandidates: [button.selector]
  }));
  const locators = [
    ...map.navigation.map((entry) => ({
      id: `${path}::navigation::${toLabelKey(entry.label || entry.href || 'navigate')}::${toLabelKey(entry.selector)}`,
      kind: 'navigation' as const,
      label: entry.label || entry.href || 'Navigate',
      labelKey: toLabelKey(entry.label || entry.href || 'navigate'),
      selectorCandidates: [entry.selector],
      path: entry.href || path,
      clickable: true,
      tagName: 'a',
      role: 'link'
    })),
    ...formFields.map((field) => ({
      id: `${path}::formField::${toLabelKey(field.label)}::${toLabelKey(field.elementId)}`,
      kind: 'formField' as const,
      label: field.label,
      labelKey: toLabelKey(field.label),
      selectorCandidates: field.selectorCandidates || [],
      fillable: true
    })),
    ...buttons.map((button) => ({
      id: `${path}::${
        /\b(create|save|submit|add|confirm|apply|finish|complete)\b/i.test(button.label) ? 'submit' : 'button'
      }::${toLabelKey(button.label)}::${toLabelKey(button.elementId)}`,
      kind: /\b(create|save|submit|add|confirm|apply|finish|complete)\b/i.test(button.label)
        ? ('submit' as const)
        : ('button' as const),
      label: button.label,
      labelKey: toLabelKey(button.label),
      selectorCandidates: button.selectorCandidates || [],
      clickable: true,
      tagName: 'button',
      role: 'button'
    }))
  ];

  return {
    version: APP_MAP_VERSION,
    discoveredAt: Date.now(),
    routeCount: 1,
    routes: [
      {
        path,
        componentName: 'FallbackRoute',
        title: routeTitle,
        navigationLinks: map.navigation.map((entry) => ({
          label: entry.label || entry.href || 'Navigate',
          path: entry.href || path,
          elementId: entry.selector,
          selectorCandidates: [entry.selector]
        })),
        modalTriggers:
          visibleSurface && (formFields.length || buttons.length)
            ? [
                {
                  elementId: visibleSurface.selector,
                  label: visibleSurface.label || `${routeTitle} Form`,
                  selectorCandidates: [visibleSurface.selector],
                  modalContents: {
                    formFields: formFields.map((field) => ({
                      label: field.label,
                      type: field.type,
                      required: field.required,
                      elementId: field.elementId,
                      selectorCandidates: field.selectorCandidates
                    })),
                    buttons
                  }
                }
              ]
            : [],
        formFields,
        buttons,
        filters: [],
        tabs: [],
        locators,
        headings: map.headings.map((heading) => heading.text).filter(Boolean)
      }
    ]
  };
}
