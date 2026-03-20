import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapabilityMap } from '../core/CapabilityMap';
import { IntentResolver } from '../core/IntentResolver';
import type { AppMap, AppMapSummary, DOMCapabilityMap, DOMElementDescriptor, IntentStep, ToolCapabilityMap } from '../types';

const { createMessageSpy } = vi.hoisted(() => ({
  createMessageSpy: vi.fn()
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class AnthropicMock {
    messages = {
      create: createMessageSpy
    };
  }
}));

function buildDescriptor(overrides: Partial<DOMElementDescriptor> = {}): DOMElementDescriptor {
  return {
    id: overrides.id || 'e1',
    selector: overrides.selector || '#dynamic-target',
    label: overrides.label || 'Dynamic Target',
    text: overrides.text || 'Ticket 4',
    role: overrides.role || 'button',
    tagName: overrides.tagName || 'button',
    rect: overrides.rect || { x: 0, y: 0, width: 120, height: 32 },
    ...(overrides.fillable !== undefined ? { fillable: overrides.fillable } : {}),
    ...(overrides.componentName !== undefined ? { componentName: overrides.componentName } : {}),
    ...(overrides.handlers !== undefined ? { handlers: overrides.handlers } : {}),
    ...(overrides.type !== undefined ? { type: overrides.type } : {}),
    ...(overrides.placeholder !== undefined ? { placeholder: overrides.placeholder } : {}),
    ...(overrides.value !== undefined ? { value: overrides.value } : {}),
    ...(overrides.disabled !== undefined ? { disabled: overrides.disabled } : {})
  };
}

function buildMap(elements: DOMElementDescriptor[]): DOMCapabilityMap {
  return createCapabilityMap({
    elements,
    routes: ['/tickets', '/settings'],
    currentRoute: '/',
    currentUrl: 'http://localhost/',
    routeParams: {},
    pageTitle: 'Test',
    headings: [],
    navigation: [],
    formState: [],
    buttonsState: [],
    visibleErrors: [],
    dialogs: [],
    tableRows: [],
    listItems: [],
    cards: [],
    statusBadges: [],
    stateHints: [],
    activeItems: [],
    countBadges: []
  });
}

function buildMapWithRuntime(elements: DOMElementDescriptor[]): DOMCapabilityMap {
  return createCapabilityMap({
    elements,
    routes: ['/tickets', '/settings'],
    currentRoute: '/tickets',
    currentUrl: 'http://localhost/tickets',
    routeParams: {},
    pageTitle: 'Tickets',
    headings: [],
    navigation: [],
    formState: [
      {
        selector: 'input[name="title"]',
        name: 'title',
        label: 'title',
        type: 'text',
        value: 'Pump Failure',
        disabled: false
      }
    ],
    buttonsState: [
      {
        selector: 'button[type="submit"]',
        label: 'Create Ticket',
        disabled: false,
        loading: false
      }
    ],
    visibleErrors: [],
    dialogs: [{ selector: '#new-ticket-modal', label: 'New Ticket', isOpen: true }],
    tableRows: [],
    listItems: [],
    cards: [],
    statusBadges: [],
    stateHints: [],
    activeItems: [],
    countBadges: []
  });
}

function buildAppMap(): AppMap {
  return {
    version: 'v1',
    discoveredAt: Date.now(),
    routeCount: 2,
    routes: [
      {
        path: '/tickets',
        componentName: 'TicketsRoute',
        title: 'Tickets',
        navigationLinks: [
          {
            label: 'Tickets',
            path: '/tickets',
            elementId: 'a[href="/tickets"]',
            selectorCandidates: ['a[href="/tickets"]']
          }
        ],
        modalTriggers: [
          {
            elementId: '#new-ticket',
            label: 'New Ticket',
            selectorCandidates: ['#new-ticket'],
            modalContents: {
              formFields: [
                {
                  label: 'Enter ticket title',
                  type: 'text',
                  required: true,
                  elementId: 'input[name="ticket-title"]',
                  selectorCandidates: ['input[name="ticket-title"]']
                },
                {
                  label: 'lowmediumhighcritical',
                  type: 'select',
                  required: true,
                  options: ['low', 'medium', 'high', 'critical'],
                  elementId: 'select[name="priority"]',
                  selectorCandidates: ['select[name="priority"]']
                }
              ],
              buttons: [
                {
                  label: 'Create Ticket',
                  elementId: 'button[type="submit"]',
                  selectorCandidates: ['button[type="submit"]']
                }
              ]
            }
          }
        ],
        formFields: [
          {
            elementId: 'input[name="ticket-title"]',
            label: 'Enter ticket title',
            type: 'text',
            required: true,
            selectorCandidates: ['input[name="ticket-title"]']
          },
          {
            elementId: 'select[name="priority"]',
            label: 'lowmediumhighcritical',
            type: 'select',
            required: true,
            selectorCandidates: ['select[name="priority"]'],
            options: ['low', 'medium', 'high', 'critical']
          }
        ],
        buttons: [
          {
            elementId: '#new-ticket',
            label: 'New Ticket',
            selectorCandidates: ['#new-ticket']
          }
        ],
        filters: [
          {
            elementId: '#critical',
            label: 'Critical',
            options: ['Critical', 'High'],
            selectorCandidates: ['#critical']
          }
        ],
        tabs: [{ elementId: '#open', label: 'Open', selectorCandidates: ['#open'] }],
        headings: ['Tickets'],
        locators: [
          {
            id: '/tickets::modalTrigger::newticket::0',
            kind: 'modalTrigger',
            label: 'New Ticket',
            labelKey: 'newticket',
            selectorCandidates: ['#new-ticket'],
            clickable: true
          },
          {
            id: '/tickets::formField::entertickettitle::0',
            kind: 'formField',
            label: 'Enter ticket title',
            labelKey: 'entertickettitle',
            selectorCandidates: ['input[name="ticket-title"]'],
            fillable: true
          },
          {
            id: '/tickets::formField::lowmediumhighcritical::0',
            kind: 'formField',
            label: 'lowmediumhighcritical',
            labelKey: 'lowmediumhighcritical',
            selectorCandidates: ['select[name="priority"]'],
            fillable: true
          },
          {
            id: '/tickets::submit::createticket::0',
            kind: 'submit',
            label: 'Create Ticket',
            labelKey: 'createticket',
            selectorCandidates: ['button[type="submit"]'],
            clickable: true
          }
        ]
      },
      {
        path: '/settings',
        componentName: 'SettingsRoute',
        title: 'Settings',
        navigationLinks: [
          {
            label: 'Settings',
            path: '/settings',
            elementId: 'a[href="/settings"]',
            selectorCandidates: ['a[href="/settings"]']
          }
        ],
        modalTriggers: [],
        formFields: [],
        buttons: [{ elementId: '#save', label: 'Save', selectorCandidates: ['#save'] }],
        filters: [],
        tabs: [],
        headings: ['Settings'],
        locators: [
          {
            id: '/settings::button::save::0',
            kind: 'button',
            label: 'Save',
            labelKey: 'save',
            selectorCandidates: ['#save'],
            clickable: true
          }
        ]
      }
    ]
  };
}

function buildAppMapSummary(): AppMapSummary {
  return {
    version: 'v1',
    routeCount: 2,
    tokenEstimate: 0,
    routes: [
      {
        path: '/tickets',
        title: 'Tickets',
        navigationLinks: [{ label: 'Tickets', path: '/tickets' }],
        buttons: ['New Ticket'],
        tabs: ['Open'],
        modalTriggers: [{ label: 'New Ticket', formFields: [{ label: 'Title', type: 'text' }], submitButton: 'Create' }],
        filters: ['Critical']
      },
      {
        path: '/settings',
        title: 'Settings',
        navigationLinks: [{ label: 'Settings', path: '/settings' }],
        buttons: ['Save'],
        tabs: [],
        modalTriggers: [],
        filters: []
      }
    ]
  };
}

function buildToolCapabilityMap(currentRoute: string = '/dashboard'): ToolCapabilityMap {
  return {
    currentRoute,
    preferredToolIds: currentRoute === '/dashboard' ? ['createTicket'] : ['createTicket'],
    tools: [
      {
        id: 'refreshDashboard',
        description: 'Refresh dashboard',
        parameters: [],
        routes: [],
        safety: 'read',
        isGlobal: true,
        currentRouteMatches: true,
        requiresNavigation: false,
        semanticScore: 0.6,
        preferredForCommand: false,
        preferredReason: 'matched terms: dashboard'
      },
      {
        id: 'createTicket',
        description: 'Create ticket',
        parameters: [
          {
            name: 'title',
            description: 'Ticket title',
            type: 'string',
            required: true
          }
        ],
        routes: ['/tickets'],
        safety: 'write',
        isGlobal: false,
        currentRouteMatches: currentRoute === '/tickets',
        requiresNavigation: currentRoute !== '/tickets',
        semanticScore: 6.4,
        preferredForCommand: true,
        preferredReason: 'description phrase match: create ticket; matched terms: ticket'
      }
    ]
  };
}

async function waitForCondition(condition: () => boolean, attempts = 40): Promise<void> {
  for (let index = 0; index < attempts; index += 1) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
  }
}

function mockStreamedTextResponse(text: string, usage = { input_tokens: 12, output_tokens: 34 }): void {
  createMessageSpy.mockImplementationOnce(async (params: { stream?: boolean }) => {
    if (!params.stream) {
      return {
        usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'text', text: '[]' }]
      };
    }

    async function* eventStream() {
      yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text }
      };
      yield {
        type: 'message_delta',
        delta: { container: null, stop_reason: 'end_turn', stop_sequence: null },
        usage: {
          cache_creation_input_tokens: null,
          cache_read_input_tokens: null,
          input_tokens: usage.input_tokens,
          output_tokens: usage.output_tokens,
          server_tool_use: null
        }
      };
      yield { type: 'message_stop' };
    }

    return eventStream();
  });
}

describe('IntentResolver classification and context shaping', () => {
  beforeEach(() => {
    createMessageSpy.mockReset();
    createMessageSpy.mockResolvedValue({
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [
        {
          type: 'text',
          text: '[{"action":"navigate","target":"/tickets","value":null,"waitForDOM":true,"reason":"navigate to tickets"}]'
        }
      ]
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('classifies in isolation with required debug log reason', () => {
    const resolver = new IntentResolver();
    const appMapSummary = buildAppMapSummary();
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    const appMapOnly = (resolver as any).classifyResolutionPriority('open settings', appMapSummary);
    expect(appMapOnly).toMatchObject({
      priority: 'app_map_only',
      reason: 'no dynamic target signal'
    });
    expect(logSpy).toHaveBeenCalledWith(
      '[Exocor] Resolution priority: app_map_only (reason: no dynamic target signal)'
    );

    const routeThenDom = (resolver as any).classifyResolutionPriority('open ticket 4', appMapSummary);
    expect(routeThenDom).toMatchObject({
      priority: 'route_then_dom',
      dynamicSignal: 'ticket 4',
      routeAnchor: '/tickets'
    });
    expect(logSpy).toHaveBeenCalledWith(
      '[Exocor] Resolution priority: route_then_dom (reason: dynamic signal "ticket 4", route anchor "/tickets")'
    );

    const domOnly = (resolver as any).classifyResolutionPriority('select result #3', appMapSummary);
    expect(domOnly).toMatchObject({
      priority: 'dom_only',
      dynamicSignal: 'result #3'
    });
    expect(logSpy).toHaveBeenCalledWith(
      '[Exocor] Resolution priority: dom_only (reason: dynamic signal "result #3" without app-map route anchor)'
    );
  });

  it('omits live DOM elements in app_map_only and route_then_dom contexts', async () => {
    const resolver = new IntentResolver({ apiKey: 'test-key' });
    const map = buildMapWithRuntime([buildDescriptor()]);
    const appMap = buildAppMap();
    mockStreamedTextResponse(
      '[{"action":"navigate","target":"/tickets","value":null,"waitForDOM":true,"reason":"navigate to tickets"}]'
    );

    const appMapOnlyResult = await resolver.resolveWithContextStreamInternal(
      {
        command: 'open settings',
        inputMethod: 'text',
        map,
        appMap,
        gazeTarget: null,
        gesture: 'none'
      },
      { inputMethod: 'typed' }
    );

    expect(appMapOnlyResult?.type).toBe('dom_steps');
    if (appMapOnlyResult?.type === 'dom_steps') {
      expect(appMapOnlyResult.resolutionPriority).toBe('app_map_only');
    }

    const firstCall = createMessageSpy.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    const firstPrompt = firstCall.messages[0]?.content || '';
    expect(firstPrompt).toContain('Resolution priority: app_map_only');
    expect(firstPrompt).toContain('"elements":[]');
    expect(firstPrompt).not.toContain('"id":"e1"');
    expect(firstPrompt).toContain('"locators"');
    expect(firstPrompt).toContain('"selectorCandidates"');
    expect(firstPrompt).toContain('"labelKey":"entertickettitle"');
    expect(firstPrompt).toContain('"options":["low","medium","high","critical"]');
    expect(firstPrompt).toContain('"componentName":"SettingsRoute"');
    expect(firstPrompt).toContain('"runtimeState"');
    expect(firstPrompt).toContain('"dialogs":[{"label":"New Ticket","isOpen":true}]');
    expect(firstPrompt).toContain('"formState":[{"label":"title","name":"title","type":"text","value":"Pump Failure","disabled":false}]');
    expect(firstPrompt).toContain('"buttonsState":[{"label":"Create Ticket","disabled":false,"loading":false}]');

    mockStreamedTextResponse(
      '[{"action":"navigate","target":"/tickets","value":null,"waitForDOM":true,"reason":"navigate to tickets"}]'
    );

    const routeThenDomResult = await resolver.resolveWithContextStreamInternal(
      {
        command: 'open ticket 4',
        inputMethod: 'text',
        map,
        appMap,
        gazeTarget: null,
        gesture: 'none'
      },
      { inputMethod: 'typed' }
    );

    expect(routeThenDomResult?.type).toBe('dom_steps');
    if (routeThenDomResult?.type === 'dom_steps') {
      expect(routeThenDomResult.resolutionPriority).toBe('route_then_dom');
    }

    const secondCall = createMessageSpy.mock.calls[1]?.[0] as {
      messages: Array<{ content: string }>;
    };
    const secondPrompt = secondCall.messages[0]?.content || '';
    expect(secondPrompt).toContain('Resolution priority: route_then_dom');
    expect(secondPrompt).toContain('"elements":[]');
    expect(secondPrompt).not.toContain('"id":"e1"');
    expect(secondPrompt).toContain('"locators"');
    expect(secondPrompt).toContain('"labelKey":"lowmediumhighcritical"');
    expect(secondPrompt).toContain('"componentName":"SettingsRoute"');
    expect(secondPrompt).toContain('"runtimeState"');
    expect(secondPrompt).toContain('"dialogs":[{"label":"New Ticket","isOpen":true}]');
    expect(secondPrompt).toContain('"formState":[{"label":"title","name":"title","type":"text","value":"Pump Failure","disabled":false}]');
    expect(secondPrompt).toContain('"buttonsState":[{"label":"Create Ticket","disabled":false,"loading":false}]');
  });

  it('includes live DOM elements in dom_only context', async () => {
    const resolver = new IntentResolver({ apiKey: 'test-key' });
    const map = buildMapWithRuntime([buildDescriptor()]);
    const appMap = buildAppMap();
    mockStreamedTextResponse(
      '[{"action":"click","target":"New Ticket","value":null,"waitForDOM":true,"reason":"open modal"}]'
    );

    const domOnlyResult = await resolver.resolveWithContextStreamInternal(
      {
        command: 'select result #3',
        inputMethod: 'text',
        map,
        appMap,
        gazeTarget: null,
        gesture: 'none'
      },
      { inputMethod: 'typed' }
    );

    expect(domOnlyResult?.type).toBe('dom_steps');
    if (domOnlyResult?.type === 'dom_steps') {
      expect(domOnlyResult.resolutionPriority).toBe('dom_only');
    }

    const firstCall = createMessageSpy.mock.calls[0]?.[0] as {
      messages: Array<{ content: string }>;
    };
    const firstPrompt = firstCall.messages[0]?.content || '';
    expect(firstPrompt).toContain('Resolution priority: dom_only');
    expect(firstPrompt).toContain('"id":"e1"');
    expect(firstPrompt).toContain('"locators"');
    expect(firstPrompt).toContain('"options":["low","medium","high","critical"]');
    expect(firstPrompt).toContain('"runtimeState"');
    expect(firstPrompt).toContain('"dialogs":[{"label":"New Ticket","isOpen":true}]');
    expect(firstPrompt).toContain('"formState":[{"label":"title","name":"title","type":"text","value":"Pump Failure","disabled":false}]');
    expect(firstPrompt).toContain('"buttonsState":[{"label":"Create Ticket","disabled":false,"loading":false}]');
  });

  it('includes full app map payload in resolve, failed-step, new-elements, and follow-up prompt paths', async () => {
    const resolver = new IntentResolver({ apiKey: 'test-key' });
    const map = buildMapWithRuntime([buildDescriptor()]);
    const appMap = buildAppMap();

    await resolver.resolve({
      command: 'open tickets',
      inputMethod: 'text',
      map,
      appMap,
      gazeTarget: null,
      gesture: 'none'
    });

    await resolver.resolveForFailedStep(
      {
        command: 'open tickets',
        inputMethod: 'text',
        map,
        appMap,
        gazeTarget: null,
        gesture: 'none'
      },
      {
        action: 'click',
        target: 'New Ticket',
        value: null,
        waitForDOM: true,
        reason: 'open modal'
      },
      'target not found'
    );

    await resolver.resolveForNewElements(
      {
        command: 'create ticket',
        inputMethod: 'text',
        map,
        appMap,
        gazeTarget: null,
        gesture: 'none'
      },
      [buildDescriptor({ id: 'e22', selector: '#new-el', label: 'new field', text: '' })],
      [
        {
          action: 'click',
          target: 'New Ticket',
          value: null,
          waitForDOM: true,
          reason: 'open modal'
        }
      ]
    );

    await resolver.resolveFollowUp(
      {
        command: 'create ticket',
        inputMethod: 'text',
        map,
        appMap,
        gazeTarget: null,
        gesture: 'none'
      },
      [
        {
          action: 'click',
          target: 'New Ticket',
          value: null,
          waitForDOM: true,
          reason: 'open modal'
        }
      ],
      'Complete remaining steps'
    );

    expect(createMessageSpy.mock.calls.length).toBeGreaterThanOrEqual(4);
    const promptPayloads = createMessageSpy.mock.calls.map((call) => {
      const params = call[0] as { messages?: Array<{ content?: string }> };
      return params.messages?.[0]?.content || '';
    });

    for (const payload of promptPayloads) {
      expect(payload).toContain('"locators"');
      expect(payload).toContain('"selectorCandidates"');
      expect(payload).toContain('"labelKey":"entertickettitle"');
      expect(payload).toContain('"options":["low","medium","high","critical"]');
      expect(payload).toContain('"componentName":"SettingsRoute"');
      expect(payload).toContain('"runtimeState"');
      expect(payload).toContain('"dialogs":[{"label":"New Ticket","isOpen":true}]');
      expect(payload).toContain('"formState":[{"label":"title","name":"title","type":"text","value":"Pump Failure","disabled":false}]');
      expect(payload).toContain('"buttonsState":[{"label":"Create Ticket","disabled":false,"loading":false}]');
    }
  });

  it('includes the explicit tool capability map in streamed and non-streamed resolver prompt paths', async () => {
    const resolver = new IntentResolver({ apiKey: 'test-key' });
    const map = buildMapWithRuntime([buildDescriptor()]);
    const appMap = buildAppMap();
    const toolCapabilityMap = buildToolCapabilityMap('/dashboard');
    mockStreamedTextResponse(
      '[{"action":"navigate","target":"/tickets","value":null,"waitForDOM":true,"reason":"navigate to tickets"}]'
    );

    await resolver.resolveWithContextStreamInternal(
      {
        command: 'create ticket',
        inputMethod: 'text',
        map,
        appMap,
        toolCapabilityMap,
        gazeTarget: null,
        gesture: 'none'
      },
      { inputMethod: 'typed' }
    );

    await resolver.resolve({
      command: 'create ticket',
      inputMethod: 'text',
      map,
      appMap,
      toolCapabilityMap,
      gazeTarget: null,
      gesture: 'none'
    });

    const streamedPrompt = ((createMessageSpy.mock.calls[0]?.[0] as { messages?: Array<{ content?: string }> })?.messages?.[0]
      ?.content || '');
    const resolvePrompt = ((createMessageSpy.mock.calls[1]?.[0] as { messages?: Array<{ content?: string }> })?.messages?.[0]
      ?.content || '');

    for (const prompt of [streamedPrompt, resolvePrompt]) {
      expect(prompt).toContain('"toolCapabilityMap"');
      expect(prompt).toContain('"preferredToolIds":["createTicket"]');
      expect(prompt).toContain('"id":"refreshDashboard"');
      expect(prompt).toContain('"id":"createTicket"');
      expect(prompt).toContain('"isGlobal":true');
      expect(prompt).toContain('"requiresNavigation":true');
      expect(prompt).toContain('"currentRouteMatches":false');
      expect(prompt).toContain('"preferredForCommand":true');
      expect(prompt).toContain('"semanticScore":6.4');
    }
  });

  it('includes modal in-place instruction in system prompts', async () => {
    const resolver = new IntentResolver({ apiKey: 'test-key' });
    const map = buildMapWithRuntime([buildDescriptor()]);
    const appMap = buildAppMap();
    mockStreamedTextResponse(
      '[{"action":"fill","target":"Title","value":"pump failure","waitForDOM":false,"reason":"fill title"}]'
    );

    await resolver.resolveWithContextStreamInternal(
      {
        command: 'fill title as pump failure',
        inputMethod: 'text',
        map,
        appMap,
        gazeTarget: null,
        gesture: 'none'
      },
      { inputMethod: 'typed' }
    );

    await resolver.resolve({
      command: 'fill title as pump failure',
      inputMethod: 'text',
      map,
      appMap,
      gazeTarget: null,
      gesture: 'none'
    });

    const resolveWithContextSystemPrompt = (createMessageSpy.mock.calls[0]?.[0] as { system?: string }).system || '';
    const resolveSystemPrompt = (createMessageSpy.mock.calls[1]?.[0] as { system?: string }).system || '';

    expect(resolveWithContextSystemPrompt).toContain(
      'If runtimeState shows an open modal/dialog and user asks to fill/edit/select/submit, operate in that open modal/dialog in place'
    );
    expect(resolveSystemPrompt).toContain(
      'If runtime state shows an open modal/dialog and the command is about fill/edit/select/submit, operate in that open modal/dialog in place.'
    );
  });

  it('documents global tools, route-specific tools, and navigate-then-tool behavior in system prompts', async () => {
    const resolver = new IntentResolver({ apiKey: 'test-key' });
    const map = buildMapWithRuntime([buildDescriptor()]);
    const appMap = buildAppMap();
    const toolCapabilityMap = buildToolCapabilityMap('/dashboard');
    mockStreamedTextResponse(
      '[{"action":"navigate","target":"/tickets","value":null,"waitForDOM":true,"reason":"navigate to tickets"},{"action":"tool","toolId":"createTicket","args":{"title":"Pump Failure"},"reason":"use explicit app-native tool"}]'
    );

    await resolver.resolveWithContextStreamInternal(
      {
        command: 'create ticket',
        inputMethod: 'text',
        map,
        appMap,
        toolCapabilityMap,
        gazeTarget: null,
        gesture: 'none'
      },
      { inputMethod: 'typed' }
    );

    await resolver.resolve({
      command: 'create ticket',
      inputMethod: 'text',
      map,
      appMap,
      toolCapabilityMap,
      gazeTarget: null,
      gesture: 'none'
    });

    const streamedSystemPrompt = (createMessageSpy.mock.calls[0]?.[0] as { system?: string })?.system || '';
    const resolveSystemPrompt = (createMessageSpy.mock.calls[1]?.[0] as { system?: string })?.system || '';

    expect(streamedSystemPrompt).toContain(
      'toolCapabilityMap: explicit app-native tools, including global tools, route-specific tools, and preferred tools for this command'
    );
    expect(streamedSystemPrompt).toContain(
      'If one preferred tool fully covers the task, use it instead of reconstructing the same task with DOM/app-map steps'
    );
    expect(streamedSystemPrompt).toContain('Global tools can be used from any route');
    expect(streamedSystemPrompt).toContain(
      'Route-specific tools remain available even when the current route is different'
    );
    expect(streamedSystemPrompt).toContain('plan navigate first and then the tool');
    expect(streamedSystemPrompt).toContain('Example off-route preferred tool');
    expect(streamedSystemPrompt).toContain('"toolId":"createRecord"');
    expect(streamedSystemPrompt).toContain('"target":"/records"');
    expect(streamedSystemPrompt).toContain('navigate "/records" → click "New Record" → fill "Title" → click "Create"');
    expect(streamedSystemPrompt).toContain('Never invent tool ids');
    expect(resolveSystemPrompt).toContain(
      'If a preferred tool fully covers the task, use it instead of reconstructing the same workflow with DOM/app-map steps'
    );
    expect(resolveSystemPrompt).toContain(
      'Only when no preferred tool applies, CREATE or EDIT workflows should be completed with the full DOM or app-map path'
    );
    expect(resolveSystemPrompt).toContain(
      'Destructive tools should only be used for explicit destructive intent'
    );
  });

  it('resolves a selected preferred tool into validated args instead of returning workflow steps', async () => {
    const resolver = new IntentResolver({ apiKey: 'test-key' });
    const map = buildMapWithRuntime([buildDescriptor()]);
    const appMap = buildAppMap();
    const toolCapabilityMap = buildToolCapabilityMap('/dashboard');
    createMessageSpy.mockResolvedValueOnce({
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [
        {
          type: 'text',
          text: '{"status":"ready","args":{"title":"Pump Failure"}}'
        }
      ]
    });

    const result = await resolver.resolvePreferredToolIntent(
      {
        command: 'create a ticket called Pump Failure',
        inputMethod: 'text',
        map,
        appMap,
        toolCapabilityMap,
        gazeTarget: null,
        gesture: 'none'
      },
      'createTicket',
      'strong semantic match for ticket creation'
    );

    expect(result).toEqual({
      status: 'ready',
      args: { title: 'Pump Failure' }
    });

    const request = createMessageSpy.mock.calls[0]?.[0] as {
      system?: string;
      messages?: Array<{ role: string; content: string }>;
    };
    expect(request.system).toContain(
      'The host application has already selected one strong preferred tool as the authoritative execution path'
    );
    expect(request.system).toContain('Never return DOM plans');
    expect(request.system).toContain('Only use declared parameter names from the selected tool schema');
    expect(request.system).toContain(
      'If the tool is route-specific and the current route does not match, ignore navigation'
    );
    expect(request.messages?.[0]?.content || '').toContain('"id":"createTicket"');
  });

  it('asks for clarification when the authoritative preferred tool is missing a required argument', async () => {
    const resolver = new IntentResolver({ apiKey: 'test-key' });
    createMessageSpy.mockResolvedValueOnce({
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [
        {
          type: 'text',
          text: '{"status":"clarification","question":"What title should I use?"}'
        }
      ]
    });

    const result = await resolver.resolvePreferredToolIntent(
      {
        command: 'please create a ticket',
        inputMethod: 'text',
        map: buildMapWithRuntime([buildDescriptor()]),
        appMap: buildAppMap(),
        toolCapabilityMap: buildToolCapabilityMap('/dashboard'),
        gazeTarget: null,
        gesture: 'none'
      },
      'createTicket',
      'strong semantic match for ticket creation'
    );

    expect(result).toEqual({
      status: 'clarification',
      question: 'What title should I use?'
    });
  });

  it('retries with a stronger preferred-tool correction prompt when a strong tool was ignored', async () => {
    const resolver = new IntentResolver({ apiKey: 'test-key' });
    const map = buildMapWithRuntime([buildDescriptor()]);
    const appMap = buildAppMap();
    const toolCapabilityMap = buildToolCapabilityMap('/dashboard');
    createMessageSpy.mockResolvedValueOnce({
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [
        {
          type: 'text',
          text: '[{"action":"navigate","target":"/tickets","value":null,"waitForDOM":true,"reason":"navigate to tickets first"},{"action":"tool","toolId":"createTicket","args":{"title":"Pump Failure"},"reason":"use preferred app-native tool"}]'
        }
      ]
    });

    const steps = await resolver.resolveWithPreferredToolRetry(
      {
        command: 'create a ticket called Pump Failure',
        inputMethod: 'text',
        map,
        appMap,
        toolCapabilityMap,
        gazeTarget: null,
        gesture: 'none'
      },
      'createTicket',
      'strong semantic match for ticket creation',
      {
        source: 'claude',
        rawCommand: 'create a ticket called Pump Failure',
        confidence: 0.9,
        steps: [
          {
            action: 'navigate',
            target: '/tickets',
            value: null,
            waitForDOM: true,
            reason: 'navigate to tickets'
          },
          {
            action: 'click',
            target: 'New Ticket',
            value: null,
            waitForDOM: true,
            reason: 'open new ticket modal'
          },
          {
            action: 'fill',
            target: 'Title',
            value: 'Pump Failure',
            waitForDOM: false,
            reason: 'fill ticket title'
          },
          {
            action: 'click',
            target: 'Create',
            value: null,
            waitForDOM: true,
            reason: 'submit ticket'
          }
        ]
      }
    );

    expect(steps).toMatchObject([
      {
        action: 'navigate',
        target: '/tickets'
      },
      {
        action: 'tool',
        toolId: 'createTicket'
      }
    ]);

    const request = createMessageSpy.mock.calls[0]?.[0] as {
      system?: string;
      messages?: Array<{ content?: string }>;
    };
    expect(request.system || '').toContain('PREFERRED TOOL CORRECTION:');
    expect(request.system || '').toContain('you MUST use it instead of reconstructing the same workflow with DOM/app-map steps');
    expect(request.system || '').toContain('you MUST plan navigate first and then the tool');
    expect(request.messages?.[0]?.content || '').toContain('Preferred tool: createTicket');
    expect(request.messages?.[0]?.content || '').toContain('Preferred tool reasoning: strong semantic match for ticket creation');
    expect(request.messages?.[0]?.content || '').toContain('Previous plan to replace:');
  });

  it('instructs the streamed resolver to use voice gaze context only when semantically relevant', async () => {
    const resolver = new IntentResolver({ apiKey: 'test-key' });
    const map = buildMapWithRuntime([buildDescriptor()]);
    const appMap = buildAppMap();
    mockStreamedTextResponse(
      '[{"action":"click","target":"New Ticket","value":null,"waitForDOM":true,"reason":"open modal"}]'
    );

    await resolver.resolveWithContextStreamInternal(
      {
        command: 'open this',
        inputMethod: 'voice',
        map,
        appMap,
        gazeTarget: 'e1',
        gesture: 'none'
      },
      {
        inputMethod: 'voice',
        gazeTarget: {
          elementId: 'e1',
          componentName: 'TicketsRoute',
          text: 'New Ticket'
        },
        gazePosition: { x: 120, y: 80 }
      }
    );

    const systemPrompt = (createMessageSpy.mock.calls.at(-1)?.[0] as { system?: string })?.system || '';

    expect(systemPrompt).toContain(
      'Gaze context (gazeTarget) is provided for voice commands and indicates where the user was looking when they started speaking'
    );
    expect(systemPrompt).toContain(
      'Use gaze context only when it is semantically relevant to the command'
    );
    expect(systemPrompt).toContain("'create a new record', 'navigate to reports', 'filter by critical priority'");
    expect(systemPrompt).toContain('ignore gazeTarget and resolve from the command alone');
  });

  it('streams complete steps before message stop and reconciles without duplicates', async () => {
    const resolver = new IntentResolver({ apiKey: 'test-key' });
    const map = buildMapWithRuntime([buildDescriptor()]);
    const appMap = buildAppMap();
    const streamedSteps: IntentStep[] = [];

    let releaseStop: () => void = () => undefined;
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });

    createMessageSpy.mockImplementationOnce(async (params: { stream?: boolean }) => {
      if (!params.stream) {
        return {
          usage: { input_tokens: 1, output_tokens: 1 },
          content: [{ type: 'text', text: '[]' }]
        };
      }

      async function* eventStream() {
        yield { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '[{"action":"navigate","target":"/tickets","value":null,' }
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '"waitForDOM":true,"reason":"navigate to tickets"},' }
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '{"action":"click","target":"New Ticket","value":null,' }
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '"waitForDOM":true,"reason":"open modal"}]' }
        };

        await stopGate;

        yield {
          type: 'message_delta',
          delta: { container: null, stop_reason: 'end_turn', stop_sequence: null },
          usage: {
            cache_creation_input_tokens: null,
            cache_read_input_tokens: null,
            input_tokens: 12,
            output_tokens: 34,
            server_tool_use: null
          }
        };
        yield { type: 'message_stop' };
      }

      return eventStream();
    });

    const resolvedPromise = resolver.resolveWithContextStreamInternal(
      {
        command: 'create ticket',
        inputMethod: 'text',
        map,
        appMap,
        gazeTarget: null,
        gesture: 'none'
      },
      { inputMethod: 'typed' },
      {
        onStep: (step) => {
          streamedSteps.push(step);
        }
      }
    );

    await waitForCondition(() => streamedSteps.length >= 1);
    expect(streamedSteps[0]?.target).toBe('/tickets');

    releaseStop();
    const resolved = await resolvedPromise;

    expect(resolved?.type).toBe('dom_steps');
    if (resolved?.type === 'dom_steps') {
      expect(resolved.plan.steps.length).toBe(2);
      expect(resolved.plan.steps[0]?.target).toBe('/tickets');
      expect(resolved.plan.steps[1]?.target).toBe('New Ticket');
    }
    expect(streamedSteps.length).toBe(2);
  });

  it('parses tool steps from model output', async () => {
    const resolver = new IntentResolver({ apiKey: 'test-key' });
    const map = buildMapWithRuntime([buildDescriptor()]);
    const appMap = buildAppMap();
    const toolCapabilityMap = buildToolCapabilityMap('/dashboard');
    mockStreamedTextResponse(
      '[{"action":"navigate","target":"/tickets","value":null,"waitForDOM":true,"reason":"navigate to tickets"},{"action":"tool","toolId":"createTicket","args":{"title":"Pump Failure"},"reason":"use explicit app-native tool"}]'
    );

    const resolved = await resolver.resolveWithContextStreamInternal(
      {
        command: 'create ticket',
        inputMethod: 'text',
        map,
        appMap,
        toolCapabilityMap,
        gazeTarget: null,
        gesture: 'none'
      },
      { inputMethod: 'typed' }
    );

    expect(resolved?.type).toBe('dom_steps');
    if (resolved?.type === 'dom_steps') {
      expect(resolved.plan.steps).toMatchObject([
        {
          action: 'navigate',
          target: '/tickets'
        },
        {
          action: 'tool',
          toolId: 'createTicket',
          args: { title: 'Pump Failure' },
          reason: 'use explicit app-native tool'
        }
      ]);
    }
  });

});
