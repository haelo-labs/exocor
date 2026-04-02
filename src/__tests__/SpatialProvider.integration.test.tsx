import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionExecutor } from '../core/ActionExecutor';
import type { AppMap } from '../types';
import { createCapabilityMap } from '../core/CapabilityMap';

let speechOptions: any;
let faceCursorOptions: any;
let speechStartSpy: ReturnType<typeof vi.fn>;
let speechStopSpy: ReturnType<typeof vi.fn>;
let speechRestartSpy: ReturnType<typeof vi.fn>;
let resolveSpy: ReturnType<typeof vi.fn>;
let resolveStreamSpy: ReturnType<typeof vi.fn>;
let resolvePreferredToolIntentSpy: ReturnType<typeof vi.fn>;
let resolvePreferredToolRetrySpy: ReturnType<typeof vi.fn>;
let resolveForFailedStepSpy: ReturnType<typeof vi.fn>;
let resolveForNewElementsSpy: ReturnType<typeof vi.fn>;

function buildPlan(command: string) {
  const createNamedMatch = command.match(/create a ticket called (.+?) with priority (.+)$/i);
  if (createNamedMatch) {
    return {
      source: 'claude',
      rawCommand: command,
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
          value: createNamedMatch[1].trim(),
          waitForDOM: false,
          reason: 'fill ticket title'
        },
        {
          action: 'fill',
          target: 'Priority',
          value: createNamedMatch[2].trim(),
          waitForDOM: false,
          reason: 'fill ticket priority'
        },
        {
          action: 'click',
          target: 'Create',
          value: null,
          waitForDOM: true,
          reason: 'submit ticket'
        }
      ]
    };
  }

  const equipmentFilterMatch = command.match(/navigate to equipment and filter for (.+)$/i);
  if (equipmentFilterMatch) {
    return {
      source: 'claude',
      rawCommand: command,
      confidence: 0.9,
      steps: [
        {
          action: 'navigate',
          target: '/equipment',
          value: null,
          waitForDOM: true,
          reason: 'navigate to equipment'
        },
        {
          action: 'click',
          target: equipmentFilterMatch[1].trim(),
          value: null,
          waitForDOM: false,
          reason: 'apply equipment filter'
        }
      ]
    };
  }

  const assignMatch = command.match(/assign\s+to\s+(.+)/i);
  if (assignMatch) {
    return {
      source: 'claude',
      rawCommand: command,
      confidence: 0.9,
      steps: [
        {
          action: 'fill',
          target: '#ticket-assignee',
          value: assignMatch[1].trim(),
          waitForDOM: false,
          reason: 'filling assignee'
        }
      ]
    };
  }

  const ticketMatch = command.match(/ticket\s+for\s+(.+)/i);
  const title = ticketMatch?.[1]?.trim() || 'new ticket';
  return {
    source: 'claude',
    rawCommand: command,
    confidence: 0.9,
    steps: [
      {
        action: 'click',
        target: 'button:contains(New Ticket)',
        value: null,
        waitForDOM: false,
        reason: 'opening form'
      },
      {
        action: 'fill',
        target: '#ticket-title',
        value: title,
        waitForDOM: false,
        reason: 'filling title'
      }
    ]
  };
}

vi.mock('../utils/speech', () => ({
  createSpeechController: (options: any) => {
    speechOptions = options;
    return {
      isSupported: true,
      start: speechStartSpy,
      stop: speechStopSpy,
      restart: speechRestartSpy,
      destroy: () => {}
    };
  }
}));

vi.mock('../utils/mediapipe', () => ({
  useFaceNoseCursor: (options: any) => {
    faceCursorOptions = options;
    return {
      videoRef: { current: null },
      cursorRef: { current: null },
      dragCursorRef: { current: null },
      isTracking: false,
      isPinching: false,
      isDragging: false,
      isLoading: false,
      showCursor: false,
      status: 'Idle',
      error: '',
      startTracking: async () => {},
      stopTracking: () => {},
      recalibrate: () => {}
    };
  }
}));

vi.mock('../core/RemoteIntentResolver', () => ({
  RemoteIntentResolver: class {
    async resolve(input: { command: string }, signal?: AbortSignal) {
      if (signal?.aborted) {
        throw new DOMException('Stopped by user.', 'AbortError');
      }
      return resolveSpy(input);
    }

    async resolveWithContextStreamInternal(
      input: { command: string },
      runtimeContext?: Record<string, unknown>,
      callbacks?: {
        onResolutionPriority?: (priority: 'app_map_only' | 'route_then_dom' | 'dom_only') => void;
        onStep?: (step: any) => void;
      },
      signal?: AbortSignal
    ) {
      if (signal?.aborted) {
        throw new DOMException('Stopped by user.', 'AbortError');
      }
      const resolved = await resolveStreamSpy(input, runtimeContext);
      if (resolved?.type === 'dom_steps') {
        callbacks?.onResolutionPriority?.(resolved.resolutionPriority);
        const stepDelayMs =
          typeof (resolved as any).__streamStepDelayMs === 'number'
            ? Number((resolved as any).__streamStepDelayMs)
            : 0;
        for (const step of resolved.plan.steps) {
          if (signal?.aborted) {
            throw new DOMException('Stopped by user.', 'AbortError');
          }
          if (stepDelayMs > 0) {
            await new Promise((resolve, reject) => {
              const timeoutId = window.setTimeout(() => {
                signal?.removeEventListener('abort', onAbort);
                resolve(undefined);
              }, stepDelayMs);
              const onAbort = (): void => {
                window.clearTimeout(timeoutId);
                signal?.removeEventListener('abort', onAbort);
                reject(new DOMException('Stopped by user.', 'AbortError'));
              };

              signal?.addEventListener('abort', onAbort, { once: true });
            });
          }
          callbacks?.onStep?.(step);
        }
      }
      return resolved;
    }

    async resolvePreferredToolIntent(...args: any[]) {
      return resolvePreferredToolIntentSpy(...args);
    }

    async resolveWithPreferredToolRetry(...args: any[]) {
      return resolvePreferredToolRetrySpy(...args);
    }

    async resolveForFailedStep(...args: any[]) {
      return resolveForFailedStepSpy(...args);
    }

    async resolveForNewElements(...args: any[]) {
      return resolveForNewElementsSpy(...args);
    }

    async resolveFollowUp() {
      return [];
    }

    async resolveAdditionalSteps() {
      return [];
    }
  }
}));

import { SpatialProvider } from '../components/SpatialProvider';
import * as DOMScannerModule from '../core/DOMScanner';
import { useGaze } from '../hooks/useGaze';
import { useGesture } from '../hooks/useGesture';
import { useIntent } from '../hooks/useIntent';

const HISTORY_STORAGE_KEY = 'exocor.command-history.v1';
const LEGACY_HISTORY_STORAGE_KEY = 'haelo.command-history.v1';

function HostOpsFieldMock(): JSX.Element {
  return (
    <div>
      <button type="button">
        New Ticket
      </button>
      <form>
        <label htmlFor="ticket-title">Ticket Title</label>
        <input id="ticket-title" name="title" />
        <label htmlFor="ticket-assignee">Assignee</label>
        <input id="ticket-assignee" name="assignee" />
      </form>
    </div>
  );
}

function ModalityProbe(): JSX.Element {
  const gaze = useGaze();
  const gesture = useGesture();
  const intent = useIntent();

  return (
    <div>
      <div data-testid="probe-gaze-target">{gaze.gazeTarget || 'none'}</div>
      <div data-testid="probe-gesture">{gesture.gesture}</div>
      <div data-testid="probe-progress">{intent.progressMessage || 'none'}</div>
    </div>
  );
}

function HostStructuredAppMock(): JSX.Element {
  const [currentPath, setCurrentPath] = React.useState(() => window.location.pathname || '/');
  const [ticketModalOpen, setTicketModalOpen] = React.useState(false);
  const [ticketTitle, setTicketTitle] = React.useState('');
  const [ticketPriority, setTicketPriority] = React.useState('low');
  const [tickets, setTickets] = React.useState<Array<{ title: string; priority: string }>>([]);
  const [equipmentFilter, setEquipmentFilter] = React.useState('all');

  React.useEffect(() => {
    const onPopState = (): void => {
      setCurrentPath(window.location.pathname || '/');
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  React.useEffect(() => {
    if (currentPath !== '/tickets' && ticketModalOpen) {
      setTicketModalOpen(false);
    }
  }, [currentPath, ticketModalOpen]);

  return (
    <div>
      <div data-testid="current-path">{currentPath}</div>
      <nav aria-label="Primary Navigation">
        <button id="nav-tickets" type="button" onClick={() => setCurrentPath('/tickets')}>
          Tickets
        </button>
        <button id="nav-equipment" type="button" onClick={() => setCurrentPath('/equipment')}>
          Equipment
        </button>
      </nav>
      {currentPath === '/tickets' ? (
        <section>
          <button id="new-ticket-trigger" type="button" onClick={() => setTicketModalOpen(true)}>
            New Ticket
          </button>
          <button id="tickets-critical-filter" type="button">
            Critical
          </button>
          {ticketModalOpen ? (
            <div role="dialog" aria-label="New Ticket Modal">
              <label htmlFor="ticket-title">Title</label>
              <input
                id="ticket-title"
                value={ticketTitle}
                onChange={(event) => setTicketTitle(event.target.value)}
              />
              <label htmlFor="ticket-priority">Priority</label>
              <select
                id="ticket-priority"
                value={ticketPriority}
                onChange={(event) => setTicketPriority(event.target.value)}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="critical">Critical</option>
              </select>
              <button
                id="create-ticket-submit"
                type="button"
                onClick={() => {
                  setTickets((previous) => [...previous, { title: ticketTitle, priority: ticketPriority }]);
                  setTicketModalOpen(false);
                  setTicketTitle('');
                  setTicketPriority('low');
                }}
              >
                Create
              </button>
            </div>
          ) : null}
          <ul>
            {tickets.map((ticket, index) => (
              <li key={`${ticket.title}-${index}`}>
                {ticket.title} - {ticket.priority}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {currentPath === '/equipment' ? (
        <section>
          <button id="equipment-critical-filter" type="button" aria-pressed={equipmentFilter === 'critical'} onClick={() => setEquipmentFilter('critical')}>
            Critical
          </button>
          <button id="equipment-all-filter" type="button" aria-pressed={equipmentFilter === 'all'} onClick={() => setEquipmentFilter('all')}>
            All
          </button>
          <div data-testid="equipment-filter-state">Filter: {equipmentFilter}</div>
        </section>
      ) : null}
    </div>
  );
}

function HostPartialLocatorTargetsMock(): JSX.Element {
  const [currentPath, setCurrentPath] = React.useState(() => window.location.pathname || '/workspace');
  const [activeTab, setActiveTab] = React.useState('overview');
  const [lastAction, setLastAction] = React.useState('idle');

  React.useEffect(() => {
    const onPopState = (): void => {
      setCurrentPath(window.location.pathname || '/workspace');
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  return (
    <div>
      <div data-testid="partial-current-path">{currentPath}</div>
      {currentPath === '/workspace' ? (
        <section>
          <button id="create-ticket-button" type="button" onClick={() => setLastAction('create-ticket')}>
            Create Ticket
          </button>
          <div role="tablist" aria-label="Workspace Tabs">
            <button
              id="overview-tab"
              role="tab"
              aria-selected={activeTab === 'overview'}
              type="button"
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              id="activity-tab"
              role="tab"
              aria-selected={activeTab === 'activity'}
              type="button"
              onClick={() => setActiveTab('activity')}
            >
              Activity
            </button>
          </div>
          <div data-testid="partial-active-tab">{activeTab}</div>
          <div data-testid="partial-last-action">{lastAction}</div>
        </section>
      ) : null}
    </div>
  );
}

function HostAmbiguousOpenMock(): JSX.Element {
  const [currentPath, setCurrentPath] = React.useState(() => window.location.pathname || '/tickets');

  React.useEffect(() => {
    const onPopState = (): void => {
      setCurrentPath(window.location.pathname || '/tickets');
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  return (
    <div>
      <div data-testid="current-path">{currentPath}</div>
      {currentPath === '/tickets' ? (
        <div>
          <button id="ambiguous-equipment-button-primary" type="button">
            Equipment
          </button>
          <button id="ambiguous-equipment-button-secondary" type="button">
            Equipment
          </button>
        </div>
      ) : null}
      {currentPath === '/equipment' ? <div data-testid="equipment-route">Equipment Route</div> : null}
    </div>
  );
}

function HostToolRouteMock(): JSX.Element {
  const [currentPath, setCurrentPath] = React.useState(() => window.location.pathname || '/');

  React.useEffect(() => {
    const onPopState = (): void => {
      setCurrentPath(window.location.pathname || '/');
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  return (
    <div>
      <div data-testid="tool-current-path">{currentPath}</div>
      {currentPath === '/tickets' ? <div data-testid="tool-tickets-route">Tickets Route</div> : null}
      {currentPath !== '/tickets' ? <div data-testid="tool-other-route">Other Route</div> : null}
    </div>
  );
}

function structuredAppMapFixture(): AppMap {
  return {
    version: 'v3',
    discoveredAt: Date.now(),
    routeCount: 1,
    routes: [
      {
        path: '/tickets',
        componentName: 'TicketsRoute',
        title: 'Tickets',
        navigationLinks: [{ label: 'Tickets', path: '/tickets' }],
        modalTriggers: [
          {
            elementId: '#new-ticket-trigger',
            label: 'New Ticket',
            modalContents: {
              formFields: [
                { label: 'Title', type: 'text', required: true },
                { label: 'Priority', type: 'select', required: true, options: ['Low', 'Medium', 'Critical'] }
              ],
              buttons: [{ label: 'Create' }]
            }
          }
        ],
        formFields: [
          { elementId: '#ticket-title', label: 'Title', type: 'text', required: true },
          { elementId: '#ticket-priority', label: 'Priority', type: 'select', required: true, options: ['Low', 'Medium', 'Critical'] }
        ],
        buttons: [
          { elementId: '#new-ticket-trigger', label: 'New Ticket' },
          { elementId: '#create-ticket-submit', label: 'Create' }
        ],
        filters: [],
        tabs: [],
        locators: [
          {
            id: '/tickets::modalTrigger::newticket::0',
            kind: 'modalTrigger',
            label: 'New Ticket',
            labelKey: 'newticket',
            selectorCandidates: ['#new-ticket-trigger'],
            clickable: true
          },
          {
            id: '/tickets::formField::title::0',
            kind: 'formField',
            label: 'Title',
            labelKey: 'title',
            selectorCandidates: ['#ticket-title'],
            fillable: true
          },
          {
            id: '/tickets::formField::priority::0',
            kind: 'formField',
            label: 'Priority',
            labelKey: 'priority',
            selectorCandidates: ['#ticket-priority'],
            fillable: true
          },
          {
            id: '/tickets::submit::create::0',
            kind: 'submit',
            label: 'Create',
            labelKey: 'create',
            selectorCandidates: ['#create-ticket-submit'],
            clickable: true
          }
        ],
        headings: ['Tickets']
      },
      {
        path: '/equipment',
        componentName: 'EquipmentRoute',
        title: 'Equipment',
        navigationLinks: [{ label: 'Equipment', path: '/equipment' }],
        modalTriggers: [],
        formFields: [],
        buttons: [],
        filters: [{ elementId: '#equipment-critical-filter', label: 'Critical', options: ['Critical', 'All'] }],
        tabs: [{ elementId: '#equipment-critical-filter', label: 'Critical' }],
        locators: [
          {
            id: '/equipment::filter::critical::0',
            kind: 'filter',
            label: 'Critical',
            labelKey: 'critical',
            selectorCandidates: ['#equipment-critical-filter'],
            clickable: true
          }
        ],
        headings: ['Equipment']
      }
    ]
  };
}

function partialLocatorTargetsAppMapFixture(): AppMap {
  return {
    version: 'v3',
    discoveredAt: Date.now(),
    routeCount: 1,
    routes: [
      {
        path: '/workspace',
        componentName: 'WorkspaceRoute',
        title: 'Workspace',
        navigationLinks: [{ label: 'Home', path: '/' }],
        modalTriggers: [],
        formFields: [],
        buttons: [{ elementId: '#create-ticket-button', label: 'Create Ticket' }],
        filters: [],
        tabs: [
          { elementId: '#overview-tab', label: 'Overview' },
          { elementId: '#activity-tab', label: 'Activity' }
        ],
        locators: [
          {
            id: '/workspace::navigation::home::0',
            kind: 'navigation',
            label: 'Home',
            labelKey: 'home',
            selectorCandidates: ['#home-link'],
            clickable: true
          }
        ],
        headings: ['Workspace']
      }
    ]
  };
}

function discoveredMapFixture(): AppMap {
  return {
    version: 'v3',
    discoveredAt: Date.now(),
    routeCount: 1,
    routes: [
      {
        path: '/',
        componentName: 'UnknownRoute',
        title: 'Root',
        navigationLinks: [{ label: 'Home', path: '/' }],
        modalTriggers: [],
        formFields: [],
        buttons: [],
        filters: [],
        tabs: [],
        headings: ['Root'],
        locators: []
      }
    ]
  };
}

function ambiguousOpenAppMapFixture(): AppMap {
  return {
    version: 'v3',
    discoveredAt: Date.now(),
    routeCount: 2,
    routes: [
      {
        path: '/tickets',
        componentName: 'TicketsRoute',
        title: 'Tickets',
        navigationLinks: [],
        modalTriggers: [],
        formFields: [],
        buttons: [{ elementId: '#ambiguous-equipment-button', label: 'Equipment' }],
        filters: [],
        tabs: [],
        locators: [
          {
            id: '/tickets::button::equipment::0',
            kind: 'button',
            label: 'Equipment',
            labelKey: 'equipment',
            selectorCandidates: ['#ambiguous-equipment-button'],
            clickable: true
          }
        ],
        headings: ['Tickets']
      },
      {
        path: '/equipment',
        componentName: 'EquipmentRoute',
        title: 'Equipment',
        navigationLinks: [{ label: 'Equipment', path: '/equipment' }],
        modalTriggers: [],
        formFields: [],
        buttons: [],
        filters: [],
        tabs: [],
        locators: [],
        headings: ['Equipment']
      }
    ]
  };
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    const timerController = vi as unknown as {
      advanceTimersByTimeAsync?: (duration: number) => Promise<void>;
      advanceTimersByTime: (duration: number) => void;
    };

    if (typeof timerController.advanceTimersByTimeAsync === 'function') {
      await timerController.advanceTimersByTimeAsync(ms);
      return;
    }

    timerController.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advanceUntil(
  assertion: () => void,
  {
    stepMs = 250,
    attempts = 20
  }: {
    stepMs?: number;
    attempts?: number;
  } = {}
): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await advance(stepMs);
    }
  }

  if (lastError) {
    throw lastError;
  }
}

function mockRefreshMap(domMap: ReturnType<typeof createCapabilityMap>) {
  return vi.spyOn(DOMScannerModule.DOMScanner.prototype, 'refresh').mockImplementation(function (this: any) {
    this.onUpdate(domMap);
    return domMap;
  });
}

describe('SpatialProvider integration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    speechOptions = undefined;
    faceCursorOptions = undefined;
    speechStartSpy = vi.fn();
    speechStopSpy = vi.fn();
    speechRestartSpy = vi.fn();
    document.title = 'OpsField Demo';
    window.history.pushState({}, '', '/');
    window.sessionStorage.clear();
    window.localStorage.clear();
    resolveSpy = vi.fn(async (input: { command: string }) => buildPlan(input.command));
    resolveStreamSpy = vi.fn(async (input: { command: string }) => ({
      type: 'dom_steps',
      plan: buildPlan(input.command),
      resolutionPriority: 'dom_only'
    }));
    resolvePreferredToolIntentSpy = vi.fn(async () => ({
      status: 'fallback',
      reason: 'No preferred tool intent configured for this test.'
    }));
    resolvePreferredToolRetrySpy = vi.fn(async () => []);
    resolveForFailedStepSpy = vi.fn(async () => []);
    resolveForNewElementsSpy = vi.fn(async () => []);
  });

  afterEach(() => {
    act(() => {
      vi.runOnlyPendingTimers();
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function getSdkRoot(): HTMLElement {
    return screen.getByTestId('exocor-sdk-root');
  }

  function sdkQueries() {
    const root = getSdkRoot();
    const container = (root.shadowRoot?.querySelector('[data-exocor-ui="true"]') || root) as HTMLElement;
    return within(container);
  }

  function getScopedAppMapKeys() {
    const scope = DOMScannerModule.resolveCurrentAppCacheScope();
    return DOMScannerModule.getScopedAppMapStorageKeys(scope);
  }

  function getScopedHistoryKey() {
    const origin = window.location.origin || 'unknown-origin';
    const normalizedRoute = (() => {
      const route = (window.location.pathname || '/').trim();
      if (!route) {
        return '/';
      }
      return route.length > 1 && route.endsWith('/') ? route.slice(0, -1) : route;
    })();
    const normalizedTitle = (document.title || 'untitled').trim().replace(/\s+/g, ' ').toLowerCase() || 'untitled';
    const signature = `${origin}||route:${normalizedRoute}||title:${normalizedTitle}`;
    let hash = 2166136261;
    for (let index = 0; index < signature.length; index += 1) {
      hash ^= signature.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${HISTORY_STORAGE_KEY}::scope-${(hash >>> 0).toString(16)}`;
  }

  function seedScopedAppMapCache(
    appMap: AppMap,
    metadataOverrides: Partial<ReturnType<typeof DOMScannerModule.getCurrentAppMapCacheMetadata>> = {}
  ) {
    const scope = DOMScannerModule.resolveCurrentAppCacheScope();
    const keys = DOMScannerModule.getScopedAppMapStorageKeys(scope);
    const metadata = {
      ...DOMScannerModule.getCurrentAppMapCacheMetadata(scope),
      ...metadataOverrides
    };
    window.localStorage.setItem(keys.appMap, JSON.stringify(appMap));
    window.localStorage.setItem(keys.schemaVersion, metadata.schemaVersion);
    window.localStorage.setItem(keys.metadata, JSON.stringify(metadata));
    return keys;
  }

  async function openPanel(): Promise<void> {
    const sdk = sdkQueries();
    await act(async () => {
      fireEvent.click(sdk.getByLabelText('Open Exocor command panel'));
    });
  }

  async function enableMicrophoneFromPanel(): Promise<void> {
    const sdk = sdkQueries();
    await openPanel();
    await act(async () => {
      fireEvent.click(sdk.getByLabelText('Turn microphone on'));
    });
  }

  async function submitTypedCommand(command: string): Promise<void> {
    const sdk = sdkQueries();
    await openPanel();

    await act(async () => {
      fireEvent.change(sdk.getByLabelText('Exocor command input'), {
        target: { value: command }
      });
      fireEvent.click(sdk.getByLabelText('Send command'));
    });
  }

  async function emitGaze(target: HTMLElement | null, x: number, y: number, isCalibrated = true): Promise<void> {
    await act(async () => {
      faceCursorOptions?.onGaze?.({ target, x, y, isCalibrated });
    });
  }

  async function emitPinchState(isPinching: boolean): Promise<void> {
    await act(async () => {
      faceCursorOptions?.onPinchState?.({ isPinching });
    });
  }

  async function emitPinchClick(target: HTMLElement | null, x = 40, y = 24): Promise<void> {
    await act(async () => {
      faceCursorOptions?.onPinchClick?.({ target, x, y });
    });
  }

  it('keeps microphone off by default and toggles listening from the chat panel', async () => {
    render(
      <SpatialProvider modalities={['voice', 'gaze']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    expect(speechStartSpy).not.toHaveBeenCalled();

    await enableMicrophoneFromPanel();
    expect(speechStartSpy).toHaveBeenCalledTimes(1);

    const stopCallsBeforeToggleOff = speechStopSpy.mock.calls.length;
    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Turn microphone off'));
    });
    expect(speechStopSpy.mock.calls.length).toBe(stopCallsBeforeToggleOff + 1);
  });

  it('shows gaze as available and lets the user toggle it from the chat panel', async () => {
    render(
      <SpatialProvider modalities={['gaze']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await openPanel();
    expect(sdkQueries().getByLabelText('Turn gaze off')).toBeTruthy();

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Turn gaze off'));
    });

    expect(sdkQueries().queryByLabelText('Turn gaze off')).toBeNull();
    expect(sdkQueries().getByLabelText('Turn gaze on')).toBeTruthy();
  });

  it('shows gesture as available and lets the user toggle it from the chat panel', async () => {
    render(
      <SpatialProvider modalities={['gesture']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await openPanel();
    expect(sdkQueries().getByLabelText('Turn gesture off')).toBeTruthy();

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Turn gesture off'));
    });

    expect(sdkQueries().queryByLabelText('Turn gesture off')).toBeNull();
    expect(sdkQueries().getByLabelText('Turn gesture on')).toBeTruthy();
  });

  it('hides unavailable modalities from the chat panel', async () => {
    render(
      <SpatialProvider modalities={['voice']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await openPanel();

    expect(sdkQueries().getByLabelText('Turn microphone on')).toBeTruthy();
    expect(sdkQueries().queryByLabelText('Turn gaze on')).toBeNull();
    expect(sdkQueries().queryByLabelText('Turn gaze off')).toBeNull();
    expect(sdkQueries().queryByLabelText('Turn gesture on')).toBeNull();
    expect(sdkQueries().queryByLabelText('Turn gesture off')).toBeNull();
  });

  it('stops gaze and gesture runtime updates when those modalities are toggled off', async () => {
    render(
      <SpatialProvider modalities={['gaze', 'gesture']}>
        <>
          <HostOpsFieldMock />
          <ModalityProbe />
        </>
      </SpatialProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    const target = screen.getByLabelText('Assignee');

    await emitGaze(target, 40, 24);
    expect(screen.getByTestId('probe-gaze-target').textContent).not.toBe('none');

    await emitPinchState(true);
    expect(screen.getByTestId('probe-gesture').textContent).toBe('pinch');

    await openPanel();

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Turn gaze off'));
    });

    expect(screen.getByTestId('probe-gaze-target').textContent).toBe('none');
    expect(screen.getByTestId('probe-gesture').textContent).toBe('none');
    expect(sdkQueries().getByLabelText('Turn gaze on')).toBeTruthy();
    expect(sdkQueries().getByLabelText('Turn gesture on')).toBeTruthy();

    await emitGaze(target, 120, 80);
    expect(screen.getByTestId('probe-gaze-target').textContent).toBe('none');

    await emitPinchState(true);
    expect(screen.getByTestId('probe-gesture').textContent).toBe('none');

    await emitPinchClick(target);
    expect(screen.getByTestId('probe-progress').textContent).toBe('none');
  });

  it('reactivates gaze when gesture is turned back on while both modalities are available', async () => {
    render(
      <SpatialProvider modalities={['gaze', 'gesture']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await openPanel();

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Turn gaze off'));
    });

    expect(sdkQueries().getByLabelText('Turn gaze on')).toBeTruthy();
    expect(sdkQueries().getByLabelText('Turn gesture on')).toBeTruthy();

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Turn gesture on'));
    });

    expect(sdkQueries().getByLabelText('Turn gaze off')).toBeTruthy();
    expect(sdkQueries().getByLabelText('Turn gesture off')).toBeTruthy();
  });

  it('mounts SDK UI into an in-tree SDK root container', async () => {
    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    const root = getSdkRoot();

    expect(root).toBeTruthy();
    expect(root.getAttribute('data-exocor-ui')).toBe('true');
    expect(root.style.pointerEvents).toBe('none');
    expect(root.shadowRoot).toBeTruthy();
  });

  it('keeps SDK light-dom controls out of the scanned capability map', async () => {
    render(
      <SpatialProvider modalities={['voice', 'gaze']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    const domMap = DOMScannerModule.scanDOM();
    const selectorValues = Object.values(domMap.compressed.selectorMap);
    const leakedLabels = [
      'Turn microphone on',
      'Clear command history',
      'Close command panel',
      'Send command',
      'Exocor command input'
    ];
    const serialized = JSON.stringify(domMap);

    expect(sdkQueries().queryByLabelText('Close command panel')).toBeTruthy();
    expect(sdkQueries().queryByLabelText('Turn microphone on')).toBeTruthy();

    for (const leakedLabel of leakedLabels) {
      expect(selectorValues.some((selector) => selector.includes(leakedLabel))).toBe(false);
      expect(serialized).not.toContain(leakedLabel);
    }
  });

  it('auto-submits voice command on silence without rendering a listening toast', async () => {
    render(
      <SpatialProvider modalities={['voice', 'gaze']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await enableMicrophoneFromPanel();

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'create a ticket for pump maintenance',
        confidence: 0.92,
        isFinal: false
      });
    });

    expect(sdkQueries().queryByText('Listening')).toBeNull();

    await advance(1200);
    await advance(700);

    const titleInput = screen.getByLabelText('Ticket Title') as HTMLInputElement;
    expect(titleInput.value.toLowerCase()).toContain('pump maintenance');
  });

  it('stops an active typed command before the next host action executes', async () => {
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'dom_steps',
      resolutionPriority: 'dom_only',
      plan: {
        source: 'claude',
        rawCommand: 'assign to Alex',
        confidence: 0.9,
        steps: [
          {
            action: 'wait',
            ms: 5000,
            reason: 'waiting before filling assignee'
          },
          {
            action: 'fill',
            target: '#ticket-assignee',
            value: 'Alex',
            waitForDOM: false,
            reason: 'filling assignee'
          }
        ]
      }
    });

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await submitTypedCommand('assign to Alex');
    await advanceUntil(() => {
      expect(sdkQueries().getByLabelText('Stop command')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Stop command'));
    });

    await advance(5200);

    expect((screen.getByLabelText('Assignee') as HTMLInputElement).value).toBe('');
    expect(sdkQueries().getAllByText('Stopped').length).toBeGreaterThan(0);
  });

  it('submits final voice transcripts immediately and cancels any pending silence submit', async () => {
    render(
      <SpatialProvider modalities={['voice']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await enableMicrophoneFromPanel();

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'create a ticket for old title',
        confidence: 0.9,
        isFinal: false
      });
    });

    await advance(600);

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'create a ticket for final title',
        confidence: 0.93,
        isFinal: true
      });
    });

    await advance(700);

    expect(resolveStreamSpy).toHaveBeenCalledTimes(1);
    const titleInput = screen.getByLabelText('Ticket Title') as HTMLInputElement;
    expect(titleInput.value.toLowerCase()).toContain('final title');

    await advance(1400);
    expect(resolveStreamSpy).toHaveBeenCalledTimes(1);
  });

  it('treats each voice utterance as a fresh command session', async () => {
    speechRestartSpy.mockImplementation(() => {
      speechOptions.onListening(false);
      speechOptions.onListening(true);
    });

    render(
      <SpatialProvider modalities={['voice']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await enableMicrophoneFromPanel();

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'create a ticket for pump maintenance',
        confidence: 0.93,
        isFinal: true
      });
    });

    await advance(700);

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'create a ticket for pump maintenance',
        confidence: 0.94,
        isFinal: true
      });
    });

    await advance(700);

    expect(resolveStreamSpy).toHaveBeenCalledTimes(2);
    expect(speechRestartSpy).toHaveBeenCalledTimes(2);
  });

  it('debounces silence submit and uses latest transcript', async () => {
    render(
      <SpatialProvider modalities={['voice']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await enableMicrophoneFromPanel();

    await act(async () => {
      speechOptions.onTranscript({ transcript: 'create a ticket for old title', confidence: 0.9, isFinal: false });
    });

    await advance(600);

    await act(async () => {
      speechOptions.onTranscript({ transcript: 'create a ticket for valve repair', confidence: 0.9, isFinal: false });
    });

    await advance(1200);
    await advance(700);

    const titleInput = screen.getByLabelText('Ticket Title') as HTMLInputElement;
    expect(titleInput.value.toLowerCase()).toContain('valve repair');
  });

  it('clears pending voice silence submit when recognition stops', async () => {
    render(
      <SpatialProvider modalities={['voice']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await enableMicrophoneFromPanel();

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'create a ticket for stale draft',
        confidence: 0.9,
        isFinal: false
      });
    });

    await act(async () => {
      speechOptions.onListening(false);
    });

    await advance(1400);

    expect(resolveStreamSpy).not.toHaveBeenCalled();
  });

  it('clears pending voice silence submit when speech recognition errors', async () => {
    render(
      <SpatialProvider modalities={['voice']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await enableMicrophoneFromPanel();

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'create a ticket for stale error',
        confidence: 0.9,
        isFinal: false
      });
    });

    await act(async () => {
      speechOptions.onError('network');
    });

    await advance(1400);

    expect(resolveStreamSpy).not.toHaveBeenCalled();
  });

  it('submits typed command through same pipeline and reports incomplete partial workflow', async () => {
    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    const commandInput = sdkQueries().getByLabelText('Exocor command input');

    await act(async () => {
      fireEvent.change(commandInput, {
        target: { value: 'create a ticket for pump maintenance' }
      });
    });

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });

    await advance(1700);

    expect(resolveStreamSpy).toHaveBeenCalled();
    expect(window.localStorage.getItem(getScopedAppMapKeys().appMap)).toBeTruthy();

    await advance(3000);
  });

  it('does not call the remote resolver when remoteResolver is disabled', async () => {
    render(
      <SpatialProvider
        modalities={[]}
        trustPolicy={{
          features: {
            remoteResolver: false
          }
        }}
      >
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    await act(async () => {
      fireEvent.change(sdkQueries().getByLabelText('Exocor command input'), {
        target: { value: 'create a ticket for remote disabled' }
      });
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });

    await advance(700);

    expect(resolveStreamSpy).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Ticket Title') as HTMLInputElement).value).toBe('');
  });

  it('keeps registered tools out of planning when tools are disabled', async () => {
    window.history.pushState({}, '', '/dashboard');
    const refreshHandler = vi.fn().mockResolvedValue(undefined);
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'text_response',
      text: 'Planner path'
    });

    render(
      <SpatialProvider
        modalities={[]}
        tools={[
          {
            id: 'refreshDashboard',
            description: 'Refresh dashboard',
            safety: 'read',
            handler: refreshHandler
          }
        ]}
        trustPolicy={{
          features: {
            tools: false
          }
        }}
      >
        <HostToolRouteMock />
      </SpatialProvider>
    );

    await submitTypedCommand('please refresh the dashboard');
    await advance(700);

    expect(refreshHandler).not.toHaveBeenCalled();
    expect(resolvePreferredToolIntentSpy).not.toHaveBeenCalled();
    expect(resolveStreamSpy).toHaveBeenCalledTimes(1);
    expect(resolveStreamSpy.mock.calls[0]?.[0]).toMatchObject({
      toolCapabilityMap: null
    });
  });

  it('starts discovery on mount and shows overlay when cache is missing', async () => {
    const discoverSpy = vi
      .spyOn(DOMScannerModule, 'discoverAppMap')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            window.setTimeout(() => {
              resolve(discoveredMapFixture());
            }, 500);
          })
      );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(discoverSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith('[Exocor Discovery] mount bootstrap reason:', 'no_cache');
    expect(sdkQueries().getByText(/Analyzing app structure/)).toBeTruthy();

    await advance(600);
    expect(sdkQueries().queryByText(/Analyzing app structure/)).toBeNull();
  });

  it('uses scoped cached app map on mount without rerunning discovery', async () => {
    seedScopedAppMapCache(discoveredMapFixture());
    const discoverSpy = vi
      .spyOn(DOMScannerModule, 'discoverAppMap')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            window.setTimeout(() => {
              resolve(discoveredMapFixture());
            }, 500);
          })
      );

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(discoverSpy).not.toHaveBeenCalled();
    expect(sdkQueries().queryByText(/Analyzing app structure/)).toBeNull();
  });

  it('skips app-map discovery when disabled and uses the local fallback map', async () => {
    const discoverSpy = vi.spyOn(DOMScannerModule, 'discoverAppMap');
    const onAppMapped = vi.fn();

    render(
      <SpatialProvider
        modalities={[]}
        trustPolicy={{
          features: {
            appMapDiscovery: false
          }
        }}
        onAppMapped={onAppMapped}
      >
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(discoverSpy).not.toHaveBeenCalled();
    expect(sdkQueries().queryByText(/Analyzing app structure/)).toBeNull();
    expect(onAppMapped).toHaveBeenCalled();
    expect(onAppMapped.mock.calls.at(-1)?.[0]).toMatchObject({
      routeCount: 1
    });
  });

  it('reruns discovery when scoped app-map metadata mismatches', async () => {
    const keys = seedScopedAppMapCache(discoveredMapFixture(), {
      sdkBuildVersion: 'legacy-build'
    });

    const discoverSpy = vi
      .spyOn(DOMScannerModule, 'discoverAppMap')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            window.setTimeout(() => {
              resolve(discoveredMapFixture());
            }, 500);
          })
      );

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(discoverSpy).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(keys.appMap)).toBeNull();
  });

  it('waits for mount-started discovery and does not start discovery from command execution', async () => {
    const discoverSpy = vi
      .spyOn(DOMScannerModule, 'discoverAppMap')
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            window.setTimeout(() => {
              resolve(discoveredMapFixture());
            }, 600);
          })
      );

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await submitTypedCommand('assign to alex');
    expect(discoverSpy).toHaveBeenCalledTimes(1);

    await advance(300);
    expect((screen.getByLabelText('Assignee') as HTMLInputElement).value).toBe('');

    await advance(1300);
    expect((screen.getByLabelText('Assignee') as HTMLInputElement).value.toLowerCase()).toContain('alex');
    expect(discoverSpy).toHaveBeenCalledTimes(1);
  });

  it('bypasses the remote resolver for voice gaze "open" commands on an interactive target', async () => {
    window.history.pushState({}, '', '/tickets');
    seedScopedAppMapCache(structuredAppMapFixture());
    const domMap = createCapabilityMap({
      elements: [
        {
          id: 'voice-open-target',
          selector: '#new-ticket-trigger',
          label: 'New Ticket',
          text: 'New Ticket',
          role: 'button',
          tagName: 'button',
          rect: { x: 20, y: 10, width: 160, height: 40 }
        }
      ],
      routes: ['/tickets'],
      currentRoute: '/tickets',
      currentUrl: 'http://localhost/tickets',
      routeParams: {},
      pageTitle: 'Tickets',
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
    vi.spyOn(DOMScannerModule.DOMScanner.prototype, 'refresh').mockImplementation(function (this: any) {
      this.onUpdate(domMap);
      return domMap;
    });

    render(
      <SpatialProvider modalities={['voice', 'gaze']}>
        <HostStructuredAppMock />
      </SpatialProvider>
    );

    await enableMicrophoneFromPanel();
    await advance(0);

    const target = screen.getByRole('button', { name: 'New Ticket' });
    await emitGaze(target, 40, 24);

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'open',
        confidence: 0.95,
        isFinal: true
      });
    });

    await advance(700);

    expect(resolveStreamSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'New Ticket Modal' })).toBeTruthy();
  });

  it('bypasses the remote resolver for voice gaze confirmation commands on an interactive target', async () => {
    window.history.pushState({}, '', '/tickets');
    seedScopedAppMapCache(structuredAppMapFixture());
    const domMap = createCapabilityMap({
      elements: [
        {
          id: 'voice-confirm-target',
          selector: '#new-ticket-trigger',
          label: 'New Ticket',
          text: 'New Ticket',
          role: 'button',
          tagName: 'button',
          rect: { x: 20, y: 10, width: 160, height: 40 }
        }
      ],
      routes: ['/tickets'],
      currentRoute: '/tickets',
      currentUrl: 'http://localhost/tickets',
      routeParams: {},
      pageTitle: 'Tickets',
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
    vi.spyOn(DOMScannerModule.DOMScanner.prototype, 'refresh').mockImplementation(function (this: any) {
      this.onUpdate(domMap);
      return domMap;
    });

    render(
      <SpatialProvider modalities={['voice', 'gaze']}>
        <HostStructuredAppMock />
      </SpatialProvider>
    );

    await enableMicrophoneFromPanel();
    await advance(0);

    const target = screen.getByRole('button', { name: 'New Ticket' });
    await emitGaze(target, 40, 24);

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'yes',
        confidence: 0.95,
        isFinal: true
      });
    });

    await advance(700);

    expect(resolveStreamSpy).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'New Ticket Modal' })).toBeTruthy();
  });

  it('bypasses the remote resolver for typed direct navigation commands when the target is visibly rendered', async () => {
    window.history.pushState({}, '', '/tickets');
    seedScopedAppMapCache(structuredAppMapFixture());
    mockRefreshMap(
      createCapabilityMap({
        elements: [
          {
            id: 'typed-nav-equipment',
            selector: '#nav-equipment',
            label: 'Equipment',
            text: 'Equipment',
            role: 'button',
            tagName: 'button',
            rect: { x: 20, y: 10, width: 160, height: 40 }
          }
        ],
        routes: ['/tickets', '/equipment'],
        currentRoute: '/tickets',
        currentUrl: 'http://localhost/tickets',
        routeParams: {},
        pageTitle: 'Tickets',
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
      })
    );

    render(
      <SpatialProvider modalities={[]}>
        <HostStructuredAppMock />
      </SpatialProvider>
    );

    await submitTypedCommand('go to equipment');
    await advance(3000);

    expect(resolveStreamSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('current-path').textContent).toBe('/equipment');
  });

  it('bypasses the remote resolver for typed direct activation commands with a unique visible target', async () => {
    window.history.pushState({}, '', '/equipment');
    seedScopedAppMapCache(structuredAppMapFixture());
    mockRefreshMap(
      createCapabilityMap({
        elements: [
          {
            id: 'typed-critical-target',
            selector: '#equipment-critical-filter',
            label: 'Critical',
            text: 'Critical',
            role: 'button',
            tagName: 'button',
            rect: { x: 20, y: 10, width: 160, height: 40 }
          }
        ],
        routes: ['/equipment'],
        currentRoute: '/equipment',
        currentUrl: 'http://localhost/equipment',
        routeParams: {},
        pageTitle: 'Equipment',
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
      })
    );

    render(
      <SpatialProvider modalities={[]}>
        <HostStructuredAppMock />
      </SpatialProvider>
    );

    await submitTypedCommand('click critical');
    await advance(700);

    expect(resolveStreamSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('equipment-filter-state').textContent).toContain('critical');
    expect(screen.getByRole('button', { name: 'Critical' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('bypasses the remote resolver for typed direct activation when a visible button matches exactly', async () => {
    window.history.pushState({}, '', '/workspace');
    seedScopedAppMapCache(partialLocatorTargetsAppMapFixture());
    mockRefreshMap(
      createCapabilityMap({
        elements: [
          {
            id: 'typed-create-ticket',
            selector: '#create-ticket-button',
            label: 'Create Ticket',
            text: 'Create Ticket',
            role: 'button',
            tagName: 'button',
            rect: { x: 20, y: 10, width: 180, height: 40 }
          }
        ],
        routes: ['/workspace'],
        currentRoute: '/workspace',
        currentUrl: 'http://localhost/workspace',
        routeParams: {},
        pageTitle: 'Workspace',
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
      })
    );

    render(
      <SpatialProvider modalities={[]}>
        <HostPartialLocatorTargetsMock />
      </SpatialProvider>
    );

    await submitTypedCommand('select create ticket');
    await advance(700);

    expect(resolveStreamSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('partial-last-action').textContent).toBe('create-ticket');
  });

  it('bypasses the remote resolver for typed direct activation when a visible tab matches exactly', async () => {
    window.history.pushState({}, '', '/workspace');
    seedScopedAppMapCache(partialLocatorTargetsAppMapFixture());
    mockRefreshMap(
      createCapabilityMap({
        elements: [
          {
            id: 'typed-activity-tab',
            selector: '#activity-tab',
            label: 'Activity',
            text: 'Activity',
            role: 'tab',
            tagName: 'button',
            rect: { x: 20, y: 10, width: 160, height: 40 }
          }
        ],
        routes: ['/workspace'],
        currentRoute: '/workspace',
        currentUrl: 'http://localhost/workspace',
        routeParams: {},
        pageTitle: 'Workspace',
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
      })
    );

    render(
      <SpatialProvider modalities={[]}>
        <HostPartialLocatorTargetsMock />
      </SpatialProvider>
    );

    await submitTypedCommand('select activity');
    await advance(700);

    expect(resolveStreamSpy).not.toHaveBeenCalled();
    expect(screen.getByTestId('partial-active-tab').textContent).toBe('activity');
    expect(screen.getByRole('tab', { name: 'Activity' }).getAttribute('aria-selected')).toBe('true');
  });

  it('treats completed deterministic actions as terminal and skips dynamic follow-up planning', async () => {
    window.history.pushState({}, '', '/workspace');
    seedScopedAppMapCache(partialLocatorTargetsAppMapFixture());
    mockRefreshMap(
      createCapabilityMap({
        elements: [
          {
            id: 'typed-create-ticket',
            selector: '#create-ticket-button',
            label: 'Create Ticket',
            text: 'Create Ticket',
            role: 'button',
            tagName: 'button',
            rect: { x: 20, y: 10, width: 180, height: 40 }
          }
        ],
        routes: ['/workspace'],
        currentRoute: '/workspace',
        currentUrl: 'http://localhost/workspace',
        routeParams: {},
        pageTitle: 'Workspace',
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
      })
    );

    const originalExecuteSequence = ActionExecutor.prototype.executeSequence;
    vi.spyOn(ActionExecutor.prototype, 'executeSequence').mockImplementation(async function (
      this: ActionExecutor,
      ...args
    ) {
      const actual = await originalExecuteSequence.apply(this, args as Parameters<typeof originalExecuteSequence>);
      return {
        ...actual,
        executed: false,
        failedStep: undefined,
        failedStepReason: 'Incomplete — stopped at click Create Ticket. Try again or type the command.'
      };
    });

    render(
      <SpatialProvider modalities={[]}>
        <HostPartialLocatorTargetsMock />
      </SpatialProvider>
    );

    await submitTypedCommand('click create ticket');
    await advance(700);

    expect(screen.getByTestId('partial-last-action').textContent).toBe('create-ticket');
    expect(resolveForNewElementsSpy).not.toHaveBeenCalled();
    expect(resolveStreamSpy).not.toHaveBeenCalled();
    expect(sdkQueries().queryByText(/Planning dynamic follow-up steps/i)).toBeNull();
  });

  it('falls back to the remote resolver for ambiguous visible open targets', async () => {
    window.history.pushState({}, '', '/tickets');
    seedScopedAppMapCache(ambiguousOpenAppMapFixture());
    mockRefreshMap(
      createCapabilityMap({
        elements: [
          {
            id: 'ambiguous-equipment-primary',
            selector: '#ambiguous-equipment-button-primary',
            label: 'Equipment',
            text: 'Equipment',
            role: 'button',
            tagName: 'button',
            rect: { x: 20, y: 10, width: 160, height: 40 }
          },
          {
            id: 'ambiguous-equipment-secondary',
            selector: '#ambiguous-equipment-button-secondary',
            label: 'Equipment',
            text: 'Equipment',
            role: 'button',
            tagName: 'button',
            rect: { x: 20, y: 60, width: 160, height: 40 }
          }
        ],
        routes: ['/tickets'],
        currentRoute: '/tickets',
        currentUrl: 'http://localhost/tickets',
        routeParams: {},
        pageTitle: 'Tickets',
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
      })
    );
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'text_response',
      text: 'Which equipment view do you want?'
    });

    render(
      <SpatialProvider modalities={[]}>
        <HostAmbiguousOpenMock />
      </SpatialProvider>
    );

    await submitTypedCommand('open equipment');
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveStreamSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to the remote resolver for multi-step or data-bearing commands', async () => {
    window.history.pushState({}, '', '/tickets');
    seedScopedAppMapCache(structuredAppMapFixture());
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'text_response',
      text: 'Planning remote workflow'
    });

    render(
      <SpatialProvider modalities={[]}>
        <HostStructuredAppMock />
      </SpatialProvider>
    );

    await submitTypedCommand('create a ticket called Pump Failure with priority critical');
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveStreamSpy).toHaveBeenCalledTimes(1);
  });

  it('falls back to the remote resolver for retrieval or understanding commands', async () => {
    window.history.pushState({}, '', '/tickets');
    seedScopedAppMapCache(structuredAppMapFixture());
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'text_response',
      text: 'Looking up ticket details'
    });

    render(
      <SpatialProvider modalities={[]}>
        <HostStructuredAppMock />
      </SpatialProvider>
    );

    await submitTypedCommand('show me details of ticket 4');
    await act(async () => {
      await Promise.resolve();
    });

    expect(resolveStreamSpy).toHaveBeenCalledTimes(1);
  });

  it('executes create ticket workflow app-map-first from label targets', async () => {
    vi.spyOn(DOMScannerModule, 'discoverAppMap').mockResolvedValue(structuredAppMapFixture());
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'dom_steps',
      plan: buildPlan('create a ticket called Pump Failure with priority critical'),
      resolutionPriority: 'app_map_only'
    });

    render(
      <SpatialProvider modalities={[]}>
        <HostStructuredAppMock />
      </SpatialProvider>
    );

    await submitTypedCommand('create a ticket called Pump Failure with priority critical');
    for (let index = 0; index < 20; index += 1) {
      await advance(400);
    }

    expect(screen.getByTestId('current-path').textContent).toBe('/tickets');
    expect(screen.getByText(/Pump Failure - critical/i)).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'New Ticket Modal' })).toBeNull();
  });

  it('uses an authoritative direct path for a unique strong global tool', async () => {
    window.history.pushState({}, '', '/dashboard');
    const refreshHandler = vi.fn().mockResolvedValue(undefined);

    render(
      <SpatialProvider
        modalities={[]}
        tools={[
          {
            id: 'refreshDashboard',
            description: 'Refresh dashboard',
            safety: 'read',
            handler: refreshHandler
          }
        ]}
      >
        <HostToolRouteMock />
      </SpatialProvider>
    );

    await submitTypedCommand('please refresh the dashboard');
    await advance(1500);

    expect(refreshHandler).toHaveBeenCalledWith({});
    expect(resolveStreamSpy).not.toHaveBeenCalled();
    const rawHistory = window.localStorage.getItem(getScopedHistoryKey()) || '';
    expect(rawHistory).toContain('Preferred tool candidate: refreshDashboard');
    expect(rawHistory).toContain('Using authoritative preferred tool directly: refreshDashboard');
    expect(rawHistory).toContain('Used app-native tool: refreshDashboard');
  });

  it('uses an authoritative navigate-then-tool path for a unique off-route preferred tool', async () => {
    window.history.pushState({}, '', '/dashboard');
    const createTicketHandler = vi.fn().mockResolvedValue(undefined);
    const historyKey = getScopedHistoryKey();

    resolvePreferredToolIntentSpy.mockImplementationOnce(async (input: { toolCapabilityMap?: any }) => {
      expect(input.toolCapabilityMap?.tools).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: 'createTicket',
            isGlobal: false,
            routes: ['/tickets'],
            currentRouteMatches: false,
            requiresNavigation: true
          })
        ])
      );
      expect(input.toolCapabilityMap?.preferredToolIds).toEqual(['createTicket']);

      return {
        status: 'ready',
        args: { title: 'Pump Failure' }
      };
    });

    render(
      <SpatialProvider
        modalities={[]}
        tools={[
          {
            id: 'createTicket',
            description: 'Create ticket',
            routes: ['/tickets'],
            parameters: [
              {
                name: 'title',
                description: 'Ticket title',
                type: 'string',
                required: true
              }
            ],
            handler: createTicketHandler
          }
        ]}
      >
        <HostToolRouteMock />
      </SpatialProvider>
    );

    await submitTypedCommand('create a ticket called Pump Failure');
    await advanceUntil(() => {
      expect(screen.getByTestId('tool-current-path').textContent).toBe('/tickets');
      expect(createTicketHandler).toHaveBeenCalledWith({ title: 'Pump Failure' });
    });

    expect(resolvePreferredToolIntentSpy).toHaveBeenCalledTimes(1);
    expect(resolveStreamSpy).not.toHaveBeenCalled();
    const rawHistory = window.localStorage.getItem(historyKey) || '';
    expect(rawHistory).toContain('Preferred tool candidate: createTicket');
    expect(rawHistory).toContain('Preferred tool is off-route: /tickets');
    expect(rawHistory).toContain('Resolving arguments for preferred tool: createTicket');
    expect(rawHistory).toContain('Using authoritative navigate -> tool path: createTicket');
  });

  it('uses an authoritative direct tool path when the unique preferred tool is already on-route', async () => {
    window.history.pushState({}, '', '/tickets');
    const createTicketHandler = vi.fn().mockResolvedValue(undefined);
    const historyKey = getScopedHistoryKey();

    resolvePreferredToolIntentSpy.mockResolvedValueOnce({
      status: 'ready',
      args: { title: 'Pump Failure' }
    });

    render(
      <SpatialProvider
        modalities={[]}
        tools={[
          {
            id: 'createTicket',
            description: 'Create ticket',
            routes: ['/tickets'],
            parameters: [
              {
                name: 'title',
                description: 'Ticket title',
                type: 'string',
                required: true
              }
            ],
            handler: createTicketHandler
          }
        ]}
      >
        <HostToolRouteMock />
      </SpatialProvider>
    );

    await submitTypedCommand('create a ticket called Pump Failure');
    await advanceUntil(() => {
      expect(createTicketHandler).toHaveBeenCalledWith({ title: 'Pump Failure' });
    });

    expect(resolvePreferredToolIntentSpy).toHaveBeenCalledTimes(1);
    expect(resolveStreamSpy).not.toHaveBeenCalled();
    const rawHistory = window.localStorage.getItem(historyKey) || '';
    expect(rawHistory).toContain('Preferred tool candidate: createTicket');
    expect(rawHistory).toContain('Using authoritative preferred tool directly: createTicket');
  });

  it('falls back to the planner when authoritative preferred-tool arguments fail validation', async () => {
    window.history.pushState({}, '', '/dashboard');
    resolvePreferredToolIntentSpy.mockResolvedValueOnce({
      status: 'ready',
      args: { name: 'Pump Failure' }
    });
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'text_response',
      text: 'Which ticket title should I use?'
    });

    render(
      <SpatialProvider
        modalities={[]}
        tools={[
          {
            id: 'createTicket',
            description: 'Create ticket',
            routes: ['/tickets'],
            parameters: [
              {
                name: 'title',
                description: 'Ticket title',
                type: 'string',
                required: true
              }
            ],
            handler: vi.fn().mockResolvedValue(undefined)
          }
        ]}
      >
        <HostToolRouteMock />
      </SpatialProvider>
    );

    await submitTypedCommand('create a ticket called Pump Failure');
    await advance(1000);

    expect(resolvePreferredToolIntentSpy).toHaveBeenCalledTimes(1);
    expect(resolveStreamSpy).toHaveBeenCalledTimes(1);
    const rawHistory = window.localStorage.getItem(getScopedHistoryKey()) || '';
    expect(rawHistory).toContain('Preferred tool arguments failed validation; using normal planner behavior');
    expect(rawHistory).toContain('does not declare argument');
  });

  it('records that no strong tool match existed when tools are present but the command is unrelated', async () => {
    window.history.pushState({}, '', '/dashboard');
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'text_response',
      text: 'Looking up ticket details'
    });

    render(
      <SpatialProvider
        modalities={[]}
        tools={[
          {
            id: 'createTicket',
            description: 'Create ticket',
            routes: ['/tickets'],
            parameters: [
              {
                name: 'title',
                description: 'Ticket title',
                type: 'string',
                required: true
              }
            ],
            handler: vi.fn().mockResolvedValue(undefined)
          }
        ]}
      >
        <HostToolRouteMock />
      </SpatialProvider>
    );

    await submitTypedCommand('show me details of ticket 4');
    await advance(1000);

    const rawHistory = window.localStorage.getItem(getScopedHistoryKey()) || '';
    expect(rawHistory).toContain('No strong tool match; using normal planner behavior');
  });

  it('replans cleanly after a route-mismatched tool step', async () => {
    window.history.pushState({}, '', '/dashboard');
    const createTicketHandler = vi.fn().mockResolvedValue(undefined);

    resolveStreamSpy.mockResolvedValueOnce({
      type: 'dom_steps',
      plan: {
        source: 'claude',
        rawCommand: 'please create a ticket',
        confidence: 0.9,
        steps: [
          {
            action: 'tool',
            toolId: 'createTicket',
            args: { title: 'Pump Failure' },
            reason: 'use explicit app-native tool'
          }
        ]
      },
      resolutionPriority: 'app_map_only'
    });
    resolveForFailedStepSpy.mockResolvedValueOnce([
      {
        action: 'navigate',
        target: '/tickets',
        value: null,
        waitForDOM: true,
        reason: 'navigate to tickets'
      },
      {
        action: 'tool',
        toolId: 'createTicket',
        args: { title: 'Pump Failure' },
        reason: 'use explicit app-native tool'
      }
    ]);

    render(
      <SpatialProvider
        modalities={[]}
        tools={[
          {
            id: 'createTicket',
            description: 'Create ticket',
            routes: ['/tickets'],
            parameters: [
              {
                name: 'title',
                description: 'Ticket title',
                type: 'string',
                required: true
              }
            ],
            handler: createTicketHandler
          }
        ]}
      >
        <HostToolRouteMock />
      </SpatialProvider>
    );

    await submitTypedCommand('please create a ticket');
    for (let index = 0; index < 12; index += 1) {
      await advance(250);
    }

    expect(resolveForFailedStepSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('tool-current-path').textContent).toBe('/tickets');
    expect(createTicketHandler).toHaveBeenCalledWith({ title: 'Pump Failure' });
  });

  it('dispatches streamed steps before full plan generation completes', async () => {
    vi.spyOn(DOMScannerModule, 'discoverAppMap').mockResolvedValue(structuredAppMapFixture());
    window.history.pushState({}, '', '/tickets');
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'dom_steps',
      plan: {
        source: 'claude',
        rawCommand: 'create a ticket called Pump Failure with priority critical',
        confidence: 0.9,
        steps: [
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
            action: 'fill',
            target: 'Priority',
            value: 'critical',
            waitForDOM: false,
            reason: 'fill ticket priority'
          },
          {
            action: 'click',
            target: 'Create',
            value: null,
            waitForDOM: true,
            reason: 'submit ticket'
          }
        ]
      },
      resolutionPriority: 'app_map_only',
      __streamStepDelayMs: 600
    } as any);

    render(
      <SpatialProvider modalities={[]}>
        <HostStructuredAppMock />
      </SpatialProvider>
    );

    await submitTypedCommand('create a ticket called Pump Failure with priority critical');

    let modalIsOpen = Boolean(screen.queryByRole('dialog', { name: 'New Ticket Modal' }));
    for (let index = 0; index < 8 && !modalIsOpen; index += 1) {
      await advance(300);
      modalIsOpen = Boolean(screen.queryByRole('dialog', { name: 'New Ticket Modal' }));
    }
    expect(modalIsOpen).toBe(true);
    expect(screen.queryByText(/Pump Failure - critical/i)).toBeNull();

    for (let index = 0; index < 20; index += 1) {
      await advance(400);
    }

    expect(screen.getByText(/Pump Failure - critical/i)).toBeTruthy();
  });

  it('removes trailing post-submit navigate steps when command did not request navigation', async () => {
    vi.spyOn(DOMScannerModule, 'discoverAppMap').mockResolvedValue(structuredAppMapFixture());
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'dom_steps',
      plan: {
        source: 'claude',
        rawCommand: 'create a ticket called Pump Failure with priority critical',
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
            action: 'fill',
            target: 'Priority',
            value: 'critical',
            waitForDOM: false,
            reason: 'fill ticket priority'
          },
          {
            action: 'click',
            target: 'Create',
            value: null,
            waitForDOM: true,
            reason: 'submit ticket'
          },
          {
            action: 'navigate',
            target: '/equipment',
            value: null,
            waitForDOM: true,
            reason: 'navigate to confirmation view'
          }
        ]
      },
      resolutionPriority: 'app_map_only'
    });

    render(
      <SpatialProvider modalities={[]}>
        <HostStructuredAppMock />
      </SpatialProvider>
    );

    await submitTypedCommand('create a ticket called Pump Failure with priority critical');
    for (let index = 0; index < 25; index += 1) {
      await advance(350);
    }

    expect(screen.getByTestId('current-path').textContent).toBe('/tickets');
    expect(screen.getByText(/Pump Failure - critical/i)).toBeTruthy();
  });

  it('keeps post-submit navigate steps when command explicitly requests navigation', async () => {
    vi.spyOn(DOMScannerModule, 'discoverAppMap').mockResolvedValue(structuredAppMapFixture());
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'dom_steps',
      plan: {
        source: 'claude',
        rawCommand: 'create a ticket called Pump Failure with priority critical and navigate to equipment',
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
            action: 'fill',
            target: 'Priority',
            value: 'critical',
            waitForDOM: false,
            reason: 'fill ticket priority'
          },
          {
            action: 'click',
            target: 'Create',
            value: null,
            waitForDOM: true,
            reason: 'submit ticket'
          },
          {
            action: 'navigate',
            target: '/equipment',
            value: null,
            waitForDOM: true,
            reason: 'navigate to equipment after creating ticket'
          }
        ]
      },
      resolutionPriority: 'app_map_only'
    });

    render(
      <SpatialProvider modalities={[]}>
        <HostStructuredAppMock />
      </SpatialProvider>
    );

    await submitTypedCommand('create a ticket called Pump Failure with priority critical and navigate to equipment');
    for (let index = 0; index < 30; index += 1) {
      await advance(400);
    }

    expect(screen.getByTestId('current-path').textContent).toBe('/equipment');
  });

  it('executes navigate-and-filter workflow app-map-first', async () => {
    vi.spyOn(DOMScannerModule, 'discoverAppMap').mockResolvedValue(structuredAppMapFixture());
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'dom_steps',
      plan: buildPlan('navigate to equipment and filter for critical'),
      resolutionPriority: 'app_map_only'
    });

    render(
      <SpatialProvider modalities={[]}>
        <HostStructuredAppMock />
      </SpatialProvider>
    );

    await submitTypedCommand('navigate to equipment and filter for critical');
    for (let index = 0; index < 10; index += 1) {
      await advance(300);
    }

    expect(screen.getByTestId('current-path').textContent).toBe('/equipment');
    expect(screen.getByTestId('equipment-filter-state').textContent).toContain('critical');
    expect(screen.getByRole('button', { name: 'Critical' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('persists command history in scoped localStorage across reloads', async () => {
    const { unmount } = render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    await act(async () => {
      fireEvent.change(sdkQueries().getByLabelText('Exocor command input'), {
        target: { value: 'assign to alex' }
      });
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });

    await advance(700);
    expect(sdkQueries().getAllByText(/assign to alex/i).length).toBeGreaterThan(0);
    expect(window.localStorage.getItem(getScopedHistoryKey())).toBeTruthy();

    unmount();

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    expect(sdkQueries().getAllByText(/assign to alex/i).length).toBeGreaterThan(0);
  });

  it('recovers app map from a compatible stored scope without losing current-app history', async () => {
    const legacyScopeKey = 'scope-recovery-legacy';
    const legacyMetadata = {
      ...DOMScannerModule.getCurrentAppMapCacheMetadata(),
      scopeSignature: 'legacy-signature'
    };

    window.localStorage.setItem(
      `haelo.appmap.v1::${legacyScopeKey}`,
      JSON.stringify(discoveredMapFixture())
    );
    window.localStorage.setItem(
      `haelo.appmap.schema-version::${legacyScopeKey}`,
      legacyMetadata.schemaVersion
    );
    window.localStorage.setItem(
      `haelo.appmap.cache-metadata::${legacyScopeKey}`,
      JSON.stringify(legacyMetadata)
    );
    window.localStorage.setItem(
      getScopedHistoryKey(),
      JSON.stringify([
        {
          id: 'legacy-history-1',
          command: 'assign to alex',
          status: 'done',
          inputMethod: 'text',
          createdAt: Date.now(),
          traces: []
        }
      ])
    );

    const discoverSpy = vi.spyOn(DOMScannerModule, 'discoverAppMap');

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(discoverSpy).not.toHaveBeenCalled();
    expect(sdkQueries().queryByText(/Analyzing app structure/)).toBeNull();

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    expect(sdkQueries().getAllByText(/assign to alex/i).length).toBeGreaterThan(0);
    expect(window.localStorage.getItem(getScopedHistoryKey())).toContain('assign to alex');
  });

  it('migrates legacy session history into scoped localStorage and sanitizes it', async () => {
    window.sessionStorage.setItem(
      LEGACY_HISTORY_STORAGE_KEY,
      JSON.stringify([
        {
          id: 'legacy-1',
          command: 'legacy entry',
          status: 'queued',
          inputMethod: 'text',
          createdAt: 'not-a-number',
          traces: [null, { id: 't1', label: 'legacy trace' }]
        }
      ])
    );

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    expect(sdkQueries().getByText('legacy entry')).toBeTruthy();
    expect(window.localStorage.getItem(getScopedHistoryKey())).toBeTruthy();
    expect(window.sessionStorage.getItem(LEGACY_HISTORY_STORAGE_KEY)).toBeNull();
  });

  it('keeps scoped cached app-map stable when it is already valid', async () => {
    const keys = seedScopedAppMapCache({
      version: 'v3',
      discoveredAt: Date.now() - 1000,
      routeCount: 1,
      routes: [
        {
          path: '/',
          componentName: 'UnknownRoute',
          title: '/',
          navigationLinks: [],
          modalTriggers: [],
          formFields: [],
          buttons: [],
          filters: [],
          tabs: [],
          headings: []
        }
      ]
    });
    const discoverSpy = vi.spyOn(DOMScannerModule, 'discoverAppMap');

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    await act(async () => {
      fireEvent.change(sdkQueries().getByLabelText('Exocor command input'), {
        target: { value: 'assign to alex' }
      });
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });

    await advance(700);

    const rawCached = window.localStorage.getItem(keys.appMap);
    expect(rawCached).toBeTruthy();
    const parsed = JSON.parse(rawCached as string) as { routeCount: number };
    expect(parsed.routeCount).toBe(1);
    expect(discoverSpy).not.toHaveBeenCalled();
  });

  it('does not crash when cached app map has sparse route entries', async () => {
    seedScopedAppMapCache({
      version: 'v3',
      discoveredAt: Date.now() - 1000,
      routeCount: 1,
      routes: [
        {
          path: '/legacy'
        }
      ]
    } as AppMap);

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    await act(async () => {
      fireEvent.change(sdkQueries().getByLabelText('Exocor command input'), {
        target: { value: 'assign to alex' }
      });
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });

    await advance(700);

    const assigneeInput = screen.getByLabelText('Assignee') as HTMLInputElement;
    expect(assigneeInput.value.toLowerCase()).toContain('alex');
  });

  it('scopes app-map and history caches per app route scope when router signals are weak', async () => {
    const { unmount } = render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await submitTypedCommand('assign to alex');
    await advance(700);

    const firstAppMapKey = getScopedAppMapKeys().appMap;
    const firstHistoryKey = getScopedHistoryKey();

    expect(window.localStorage.getItem(firstAppMapKey)).toBeTruthy();
    expect(window.localStorage.getItem(firstHistoryKey)).toContain('alex');

    unmount();
    window.history.pushState({}, '', '/tickets');

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await submitTypedCommand('assign to sam');
    await advance(700);

    const secondAppMapKey = getScopedAppMapKeys().appMap;
    const secondHistoryKey = getScopedHistoryKey();

    expect(secondAppMapKey).not.toBe(firstAppMapKey);
    expect(secondHistoryKey).not.toBe(firstHistoryKey);
    expect(window.localStorage.getItem(secondAppMapKey)).toBeTruthy();
    expect(window.localStorage.getItem(secondHistoryKey)).toContain('sam');
    expect(window.localStorage.getItem(firstHistoryKey)).toContain('alex');
  });

  it('does not reuse persisted history across different apps on the same localhost route', async () => {
    document.title = 'OpsField Demo';
    const { unmount } = render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await submitTypedCommand('assign to alex');
    await advance(700);

    const firstHistoryKey = getScopedHistoryKey();
    expect(window.localStorage.getItem(firstHistoryKey)).toContain('alex');

    unmount();

    document.title = 'Sales Console';
    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    expect(getScopedHistoryKey()).not.toBe(firstHistoryKey);
    expect(sdkQueries().queryByText(/assign to alex/i)).toBeNull();
  });

  it('refreshes a stale cached app map once and retries the remaining steps', async () => {
    window.history.pushState({}, '', '/tickets');
    seedScopedAppMapCache({
      version: 'v3',
      discoveredAt: Date.now(),
      routeCount: 1,
      routes: [
        {
          ...structuredAppMapFixture().routes[0],
          buttons: [
            { elementId: '#missing-ticket-trigger', label: 'New Ticket' },
            { elementId: '#create-ticket-submit', label: 'Create' }
          ],
          locators: [
            {
              id: '/tickets::modalTrigger::newticket::0',
              kind: 'modalTrigger',
              label: 'New Ticket',
              labelKey: 'newticket',
              selectorCandidates: ['#missing-ticket-trigger'],
              clickable: true
            },
            {
              id: '/tickets::formField::title::tickettitle',
              kind: 'formField',
              label: 'Title',
              labelKey: 'title',
              selectorCandidates: ['#ticket-title'],
              fillable: true
            },
            {
              id: '/tickets::formField::priority::ticketpriority',
              kind: 'formField',
              label: 'Priority',
              labelKey: 'priority',
              selectorCandidates: ['#ticket-priority'],
              fillable: true
            },
            {
              id: '/tickets::submit::create::createticketsubmit',
              kind: 'submit',
              label: 'Create',
              labelKey: 'create',
              selectorCandidates: ['#create-ticket-submit'],
              clickable: true,
              tagName: 'button',
              role: 'button'
            }
          ]
        }
      ]
    });
    const discoverSpy = vi.spyOn(DOMScannerModule, 'discoverAppMap').mockResolvedValue(structuredAppMapFixture());
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'dom_steps',
      plan: buildPlan('create a ticket called Pump Failure with priority critical'),
      resolutionPriority: 'app_map_only'
    });

    render(
      <SpatialProvider modalities={[]}>
        <HostStructuredAppMock />
      </SpatialProvider>
    );

    await submitTypedCommand('create a ticket called Pump Failure with priority critical');
    await advance(6000);

    expect(discoverSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Pump Failure - critical/i)).toBeTruthy();
  });

  it('keeps discovery invisible in command history and traces', async () => {
    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    await act(async () => {
      fireEvent.change(sdkQueries().getByLabelText('Exocor command input'), {
        target: { value: 'assign to alex' }
      });
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });

    await advance(700);

    const rawHistory = window.localStorage.getItem(getScopedHistoryKey());
    expect(rawHistory).toBeTruthy();
    const parsedHistory = JSON.parse(rawHistory as string) as Array<{ traces?: Array<{ label?: string }> }>;
    expect(parsedHistory.length).toBe(1);

    const traceLabels = (parsedHistory[0]?.traces || [])
      .map((trace) => trace?.label?.toLowerCase() || '')
      .filter(Boolean);

    expect(traceLabels.some((label) => label.includes('discover'))).toBe(false);
    expect(traceLabels.some((label) => label.includes('learning your app'))).toBe(false);
    expect(traceLabels.some((label) => label.includes('app map'))).toBe(false);
  });

  it('enriches typed input context with focused element and selected text', async () => {
    const selectionSpy = vi
      .spyOn(window, 'getSelection')
      .mockReturnValue({ toString: () => 'selected title text' } as Selection);

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      (screen.getByLabelText('Ticket Title') as HTMLInputElement).focus();
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    await act(async () => {
      fireEvent.change(sdkQueries().getByLabelText('Exocor command input'), {
        target: { value: 'assign to alex' }
      });
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });

    await advance(700);

    expect(resolveStreamSpy).toHaveBeenCalled();
    const [, runtimeContext] = resolveStreamSpy.mock.calls.at(-1) as [unknown, Record<string, unknown>];
    expect(runtimeContext.inputMethod).toBe('typed');
    expect(runtimeContext.selectedText).toBe('selected title text');
    expect(runtimeContext.focusedElement).toMatchObject({ type: 'text' });

    selectionSpy.mockRestore();
  });

  it('preserves the gaze snapshot from speech start for voice resolution context', async () => {
    const domMap = createCapabilityMap({
      elements: [
        {
          id: 'voice-start-target',
          selector: 'button',
          label: 'New Ticket',
          text: 'New Ticket',
          role: 'button',
          tagName: 'button',
          rect: { x: 100, y: 80, width: 180, height: 36 }
        },
        {
          id: 'voice-end-target',
          selector: '#ticket-assignee',
          label: 'Assignee',
          text: 'Assignee',
          role: 'textbox',
          tagName: 'input',
          rect: { x: 420, y: 220, width: 180, height: 36 },
          fillable: true
        }
      ],
      routes: [],
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

    vi.spyOn(DOMScannerModule.DOMScanner.prototype, 'refresh').mockImplementation(function (this: any) {
      this.onUpdate(domMap);
      return domMap;
    });

    render(
      <SpatialProvider modalities={['voice', 'gaze']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await enableMicrophoneFromPanel();
    await advance(0);

    const startTarget = screen.getByText('New Ticket');
    const endTarget = screen.getByLabelText('Assignee');

    await emitGaze(startTarget, 120, 80);

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'assign to robin',
        confidence: 0.92,
        isFinal: false
      });
    });

    await emitGaze(endTarget, 480, 220);

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'assign to robin',
        confidence: 0.96,
        isFinal: true
      });
    });

    await advance(700);

    expect(resolveStreamSpy).toHaveBeenCalled();
    const [inputArg, runtimeContext] = resolveStreamSpy.mock.calls.at(-1) as [
      { inputMethod: string; gazeTarget: string | null },
      Record<string, unknown>
    ];
    expect(inputArg.inputMethod).toBe('voice');
    expect(runtimeContext.inputMethod).toBe('voice');
    expect(inputArg.gazeTarget).toBeTruthy();
    expect(runtimeContext.gazeTarget).toMatchObject({
      elementId: inputArg.gazeTarget,
      text: 'New Ticket'
    });
    expect(runtimeContext.gazePosition).toMatchObject({ x: 120, y: 80 });
  });

  it('delegates ambiguous typed command handling to resolver context path', async () => {
    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    await act(async () => {
      fireEvent.change(sdkQueries().getByLabelText('Exocor command input'), {
        target: { value: 'open this' }
      });
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });

    await advance(700);

    expect(resolveStreamSpy).toHaveBeenCalled();
    const [inputArg, runtimeContext] = resolveStreamSpy.mock.calls.at(-1) as [
      { inputMethod: string },
      Record<string, unknown>
    ];
    expect(inputArg.inputMethod).toBe('text');
    expect(runtimeContext.inputMethod).toBe('typed');
  });

  it('shows clarification text responses as a temporary chat prompt', async () => {
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'text_response',
      text: 'Which ticket should I open?'
    });

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    await act(async () => {
      fireEvent.change(sdkQueries().getByLabelText('Exocor command input'), {
        target: { value: 'open this' }
      });
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });

    await advance(100);
    expect(sdkQueries().getAllByText('Which ticket should I open?').length).toBe(1);
    expect(sdkQueries().getByText('Clarification needed')).toBeTruthy();
  });

  it('shows clarification for typed ambiguous command without custom app context', async () => {
    resolveStreamSpy.mockResolvedValueOnce({
      type: 'text_response',
      text: 'Which item should I open?'
    });

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    await act(async () => {
      fireEvent.change(sdkQueries().getByLabelText('Exocor command input'), {
        target: { value: 'please open it' }
      });
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });

    await advance(100);
    expect(resolveStreamSpy).toHaveBeenCalled();
    expect(sdkQueries().getAllByText('Which item should I open?').length).toBe(1);
  });

  it('moves answered clarifications into the original intent details', async () => {
    resolveStreamSpy
      .mockResolvedValueOnce({
        type: 'text_response',
        text: 'Which ticket should I open?'
      })
      .mockResolvedValueOnce({
        type: 'dom_steps',
        plan: buildPlan('open this'),
        resolutionPriority: 'dom_only'
      });

    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    await act(async () => {
      fireEvent.change(sdkQueries().getByLabelText('Exocor command input'), {
        target: { value: 'open this' }
      });
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });

    await advance(100);
    expect(sdkQueries().getByText('Clarification needed')).toBeTruthy();
    expect(sdkQueries().getByText('Which ticket should I open?')).toBeTruthy();

    await act(async () => {
      fireEvent.change(sdkQueries().getByLabelText('Exocor command input'), {
        target: { value: 'Pump Maintenance' }
      });
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });

    await advance(700);

    const [clarifiedInputArg] = resolveStreamSpy.mock.calls.at(-1) as [{ command: string }];
    expect(clarifiedInputArg.command).toContain('Original intent: open this');
    expect(clarifiedInputArg.command).toContain('Clarification answer: Pump Maintenance');
    expect(sdkQueries().queryByText('Clarification needed')).toBeNull();
    expect(sdkQueries().queryByText('Which ticket should I open?')).toBeNull();

    await act(async () => {
      fireEvent.click(sdkQueries().getByText('open this'));
    });

    expect(sdkQueries().getByText('Clarification asked: Which ticket should I open?')).toBeTruthy();
    expect(sdkQueries().getByText('Clarification given: Pump Maintenance')).toBeTruthy();
  });

  it('clears typed chat input immediately after submit', async () => {
    render(
      <SpatialProvider modalities={[]}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Open Exocor command panel'));
    });

    const input = sdkQueries().getByLabelText('Exocor command input') as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, {
        target: { value: 'assign to alex' }
      });
    });
    expect(input.value).toBe('assign to alex');

    await act(async () => {
      fireEvent.click(sdkQueries().getByLabelText('Send command'));
    });
    expect(input.value).toBe('');
  });

  it('shows floating voice clarification and accepts spoken follow-up without actions', async () => {
    resolveStreamSpy
      .mockResolvedValueOnce({
        type: 'text_response',
        text: 'Which ticket should I open?'
      })
      .mockResolvedValueOnce({
        type: 'dom_steps',
        plan: buildPlan('open this'),
        resolutionPriority: 'dom_only'
      });

    render(
      <SpatialProvider modalities={['voice']}>
        <HostOpsFieldMock />
      </SpatialProvider>
    );

    await enableMicrophoneFromPanel();

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'open this',
        confidence: 0.9,
        isFinal: false
      });
    });

    await advance(1200);
    await advance(100);

    expect(sdkQueries().queryByText('Clarification Needed')).toBeNull();
    expect(sdkQueries().getAllByText('Which ticket should I open?')).toHaveLength(1);
    expect(sdkQueries().queryByText('Speak Answer')).toBeNull();
    expect(sdkQueries().queryByText('Dismiss')).toBeNull();

    await act(async () => {
      speechOptions.onTranscript({
        transcript: 'Pump Maintenance',
        confidence: 0.9,
        isFinal: false
      });
    });
    await advance(1200);
    await advance(100);

    const [clarifiedInputArg] = resolveStreamSpy.mock.calls.at(-1) as [{ command: string }];
    expect(clarifiedInputArg.command).toContain('Original intent: open this');
    expect(clarifiedInputArg.command).toContain('Clarification answer: Pump Maintenance');
    expect(sdkQueries().queryByText('Which ticket should I open?')).toBeNull();
  });
});
