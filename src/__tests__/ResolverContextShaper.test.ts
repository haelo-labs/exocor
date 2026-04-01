import { describe, expect, it } from 'vitest';
import { createCapabilityMap } from '../core/CapabilityMap';
import { shapeResolverContext } from '../core/ResolverContextShaper';
import { resolveContextPolicy, resolveTrustPolicy } from '../core/contextPolicy';
import type { AppMap, IntentResolutionInput, ToolCapabilityMap } from '../types';

function buildInput(overrides: Partial<IntentResolutionInput> = {}): IntentResolutionInput {
  const map = createCapabilityMap({
    elements: [
      {
        id: 'public-title',
        selector: '#ticket-title',
        label: 'Ticket Title',
        text: 'Pump Failure',
        value: 'Pump Failure',
        fillable: true,
        role: 'textbox',
        tagName: 'input',
        type: 'text',
        rect: { x: 20, y: 20, width: 220, height: 40 }
      },
      {
        id: 'secret-token',
        selector: '#secret-token',
        label: 'Secret Token',
        text: 'alpha-secret',
        value: 'alpha-secret',
        fillable: true,
        role: 'textbox',
        tagName: 'input',
        type: 'password',
        rect: { x: 20, y: 80, width: 220, height: 40 }
      },
      {
        id: 'create-ticket',
        selector: '#create-ticket',
        label: 'Create',
        text: 'Create',
        role: 'button',
        tagName: 'button',
        rect: { x: 20, y: 140, width: 120, height: 36 }
      }
    ],
    routes: ['/tickets'],
    currentRoute: '/tickets',
    currentUrl: 'http://localhost/tickets',
    routeParams: {},
    pageTitle: 'Tickets',
    headings: [{ level: 'h1', text: 'Tickets' }],
    navigation: [{ label: 'Tickets', href: '/tickets', selector: 'a[href="/tickets"]' }],
    formState: [
      {
        selector: '#ticket-title',
        name: 'title',
        label: 'Ticket Title',
        type: 'text',
        value: 'Pump Failure',
        disabled: false
      },
      {
        selector: '#secret-token',
        name: 'token',
        label: 'Secret Token',
        type: 'password',
        value: 'alpha-secret',
        disabled: false
      }
    ],
    buttonsState: [{ selector: '#create-ticket', label: 'Create', disabled: false, loading: false }],
    visibleErrors: [],
    dialogs: [{ selector: '#ticket-modal', label: 'New Ticket', isOpen: true }],
    tableRows: [],
    listItems: [],
    cards: [],
    statusBadges: [],
    stateHints: [],
    activeItems: [],
    countBadges: []
  });

  const appMap: AppMap = {
    version: 'v1',
    discoveredAt: Date.now(),
    routeCount: 1,
    routes: [
      {
        path: '/tickets',
        componentName: 'TicketsRoute',
        title: 'Tickets',
        navigationLinks: [{ label: 'Tickets', path: '/tickets', elementId: 'a[href="/tickets"]', selectorCandidates: ['a[href="/tickets"]'] }],
        modalTriggers: [
          {
            elementId: '#create-ticket',
            label: 'New Ticket',
            selectorCandidates: ['#create-ticket'],
            modalContents: {
              formFields: [
                {
                  elementId: '#ticket-title',
                  label: 'Ticket Title',
                  type: 'text',
                  required: true,
                  selectorCandidates: ['#ticket-title']
                },
                {
                  elementId: '#secret-token',
                  label: 'Secret Token',
                  type: 'password',
                  required: true,
                  selectorCandidates: ['#secret-token']
                }
              ],
              buttons: [{ label: 'Create', elementId: '#create-ticket', selectorCandidates: ['#create-ticket'] }]
            }
          }
        ],
        formFields: [
          {
            elementId: '#ticket-title',
            label: 'Ticket Title',
            type: 'text',
            required: true,
            selectorCandidates: ['#ticket-title']
          },
          {
            elementId: '#secret-token',
            label: 'Secret Token',
            type: 'password',
            required: true,
            selectorCandidates: ['#secret-token']
          }
        ],
        buttons: [{ elementId: '#create-ticket', label: 'Create', selectorCandidates: ['#create-ticket'] }],
        filters: [],
        tabs: [],
        headings: ['Tickets']
      }
    ]
  };

  const toolCapabilityMap: ToolCapabilityMap = {
    currentRoute: '/tickets',
    preferredToolIds: ['createTicket'],
    tools: [
      {
        id: 'createTicket',
        description: 'Create a ticket',
        parameters: [{ name: 'title', description: 'Title', type: 'string', required: true }],
        routes: ['/tickets'],
        safety: 'write',
        isGlobal: false,
        currentRouteMatches: true,
        requiresNavigation: false,
        semanticScore: 8,
        preferredForCommand: true,
        preferredReason: 'strong semantic match'
      },
      {
        id: 'refreshDashboard',
        description: 'Refresh dashboard',
        parameters: [],
        routes: ['/dashboard'],
        safety: 'read',
        isGlobal: false,
        currentRouteMatches: false,
        requiresNavigation: true,
        semanticScore: 3,
        preferredForCommand: false
      }
    ]
  };

  return {
    command: 'create ticket with title Pump Failure',
    inputMethod: 'text',
    map,
    appMap,
    toolCapabilityMap,
    gazeTarget: null,
    gesture: 'none',
    ...overrides
  };
}

describe('ResolverContextShaper', () => {
  it('filters never-send selectors and preserves a summarized app map', () => {
    const shaped = shapeResolverContext({
      input: buildInput(),
      runtimeContext: {
        inputMethod: 'typed',
        selectedText: 'Pump Failure',
        focusedElement: { elementId: 'public-title', type: 'text' }
      },
      contextPolicy: resolveContextPolicy({ mode: 'balanced' }),
      trustPolicy: resolveTrustPolicy({
        neverSend: ['#secret-token']
      })
    });

    expect(shaped.input.map.elements.map((element) => element.selector)).not.toContain('#secret-token');
    expect(shaped.input.map.formState.map((field) => field.selector)).not.toContain('#secret-token');
    expect(shaped.input.appMap).toBeTruthy();
    expect(JSON.stringify(shaped.input.appMap)).not.toContain('Secret Token');
    expect(JSON.stringify(shaped.input.appMap)).not.toContain('selectorCandidates');
    expect(shaped.report.filteredByNeverSend).toBeGreaterThan(0);
  });

  it('redacts configured fields and reports the redaction count', () => {
    const shaped = shapeResolverContext({
      input: buildInput({
        toolCapabilityMap: null
      }),
      runtimeContext: {
        inputMethod: 'typed',
        selectedText: 'Pump Failure',
        focusedElement: { elementId: 'public-title', type: 'text' }
      },
      contextPolicy: resolveContextPolicy({ mode: 'full' }),
      trustPolicy: resolveTrustPolicy({
        redact: [
          {
            selector: '#ticket-title',
            fields: ['label', 'value'],
            replace: '[masked]'
          }
        ]
      })
    });

    const titleElement = shaped.input.map.elements.find((element) => element.selector === '#ticket-title');
    const titleField = shaped.input.map.formState.find((field) => field.selector === '#ticket-title');
    expect(titleElement?.label).toBe('[masked]');
    expect(titleElement?.value).toBe('[masked]');
    expect(titleField?.label).toBe('[masked]');
    expect(titleField?.value).toBe('[masked]');
    expect(shaped.report.redactedFields).toBeGreaterThan(0);
  });

  it('honors lean mode and tool section exclusions', () => {
    const input = buildInput({
      command: 'open this'
    });
    const shaped = shapeResolverContext({
      input,
      runtimeContext: {
        inputMethod: 'voice',
        gazeTarget: { elementId: 'create-ticket', text: 'Create' },
        gazePosition: { x: 40, y: 140 }
      },
      contextPolicy: resolveContextPolicy({
        mode: 'lean',
        sections: {
          tools: 'never'
        }
      }),
      trustPolicy: resolveTrustPolicy({})
    });

    expect(shaped.input.toolCapabilityMap).toBeNull();
    expect(shaped.input.map.elements.length).toBeLessThanOrEqual(16);
    expect(shaped.input.appMap).toBeTruthy();
    expect(shaped.report.droppedSections).toContain('tools');
  });

  it('drops live DOM payloads when live DOM scanning is disabled', () => {
    const shaped = shapeResolverContext({
      input: buildInput(),
      runtimeContext: {
        inputMethod: 'typed'
      },
      contextPolicy: resolveContextPolicy({ mode: 'full' }),
      trustPolicy: resolveTrustPolicy({
        features: {
          liveDomScanning: false
        }
      })
    });

    expect(shaped.input.map.elements).toEqual([]);
    expect(shaped.report.droppedSections).toContain('liveDom');
  });
});
