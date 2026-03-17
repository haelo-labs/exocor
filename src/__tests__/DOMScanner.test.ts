import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __DOM_SCANNER_TESTING__,
  discoverAppMap,
  readCachedAppMapWithReason,
  saveAppMapToCache,
  scanDOM,
  summarizeAppMapForResolver
} from '../core/DOMScanner';
import type { AppMap } from '../types';

const visibleRect: DOMRect = {
  x: 0,
  y: 0,
  width: 180,
  height: 28,
  top: 0,
  right: 180,
  bottom: 28,
  left: 0,
  toJSON: () => ({})
} as DOMRect;

function normalizePathFromUrl(value: string): string {
  try {
    const parsed = new URL(value, window.location.origin);
    return parsed.pathname || '/';
  } catch {
    return '/';
  }
}

describe('DOMScanner active discovery crawler', () => {
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  const originalGetComputedStyle = window.getComputedStyle;
  const originalPushState = window.history.pushState.bind(window.history);

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value() {
        return visibleRect;
      }
    });
    Object.defineProperty(window, 'getComputedStyle', {
      configurable: true,
      value(element: Element) {
        const htmlElement = element as HTMLElement;
        return {
          display: htmlElement.style.display || 'block',
          visibility: htmlElement.style.visibility || 'visible',
          opacity: htmlElement.style.opacity || '1'
        } as CSSStyleDeclaration;
      }
    });
    document.body.innerHTML = '';
    document.title = 'Test App';
    window.history.pushState({}, '', '/origin');
    window.localStorage.clear();
  });

  afterEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: originalGetBoundingClientRect
    });
    Object.defineProperty(window, 'getComputedStyle', {
      configurable: true,
      value: originalGetComputedStyle
    });
    window.history.pushState = originalPushState;
    vi.useRealTimers();
    document.body.innerHTML = '';
    window.localStorage.clear();
  });

  it('normalizes discovery paths to lowercase and strips trailing slash', () => {
    expect(__DOM_SCANNER_TESTING__.normalizeDiscoveryPath('/ADMIN/')).toBe('/admin');
    expect(__DOM_SCANNER_TESTING__.normalizeDiscoveryPath('/')).toBe('/');
  });

  it('polls until pathname matches and waits 300ms settle', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/origin');

    const delayedPushState = vi.fn((state: any, _: string, url?: string | URL | null) => {
      window.setTimeout(() => {
        originalPushState(state, '', url);
      }, 120);
    });
    window.history.pushState = delayedPushState as History['pushState'];

    const promise = __DOM_SCANNER_TESTING__.navigateForDiscovery('/target');
    let result: boolean | null = null;
    promise.then((value) => {
      result = value;
    });

    await vi.advanceTimersByTimeAsync(449);
    expect(result).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(result).toBe(true);
    expect(delayedPushState).toHaveBeenCalled();
  });

  it('returns false after timeout when path never updates', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/origin');

    const noopPushState = vi.fn(() => undefined);
    window.history.pushState = noopPushState as History['pushState'];

    const promise = __DOM_SCANNER_TESTING__.navigateForDiscovery('/missing-route');
    let result: boolean | null = null;
    promise.then((value) => {
      result = value;
    });

    await vi.advanceTimersByTimeAsync(2300);
    expect(result).toBe(false);
  });

  it('does not traverse into shadow roots during discovery', async () => {
    const lightButton = document.createElement('button');
    lightButton.textContent = 'Light DOM Button';
    document.body.appendChild(lightButton);

    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowButton = document.createElement('button');
    shadowButton.textContent = 'Shadow Button';
    shadow.appendChild(shadowButton);
    document.body.appendChild(host);

    const appMap = await discoverAppMap();
    const serialized = JSON.stringify(appMap);

    expect(serialized).toContain('Light DOM Button');
    expect(serialized).not.toContain('Shadow Button');
  });

  it('excludes SDK UI elements from fallback capability scans', () => {
    document.body.innerHTML = `
      <main>
        <button type="button">Host Action</button>
        <div data-exocor-ui="true">
          <button type="button" aria-label="Turn microphone on">Turn microphone on</button>
        </div>
      </main>
    `;

    const domMap = scanDOM();
    const selectorValues = Object.values(domMap.compressed.selectorMap);
    const serialized = JSON.stringify(domMap);

    expect(serialized).toContain('Host Action');
    expect(serialized).not.toContain('Turn microphone on');
    expect(selectorValues.some((selector) => selector.includes('Turn microphone on'))).toBe(false);
  });

  it('excludes light-dom SDK dialogs, fields, headings, and badges from capability collections', () => {
    document.body.innerHTML = `
      <main>
        <h1>Host Dashboard</h1>
        <button type="button">Host Action</button>
        <div role="dialog" aria-label="Host Dialog">
          <label for="host-title">Title</label>
          <input id="host-title" />
        </div>
        <span data-status="healthy">Host Healthy</span>
      </main>
      <div data-exocor-ui="true" data-testid="exocor-sdk-root">
        <h1>SDK Panel</h1>
        <div role="dialog" aria-label="SDK Dialog">
          <label for="sdk-command">Command</label>
          <input id="sdk-command" />
          <button type="button">Send command</button>
        </div>
        <span data-status="sdk">Listening</span>
      </div>
    `;

    const domMap = scanDOM();
    const serialized = JSON.stringify(domMap);

    expect(domMap.headings.map((heading) => heading.text)).toContain('Host Dashboard');
    expect(domMap.headings.map((heading) => heading.text)).not.toContain('SDK Panel');
    expect(domMap.dialogs.map((dialog) => dialog.label)).toContain('Host Dialog');
    expect(domMap.dialogs.map((dialog) => dialog.label)).not.toContain('SDK Dialog');
    expect(domMap.formState.map((field) => field.label)).toContain('Title');
    expect(domMap.formState.map((field) => field.label)).not.toContain('Command');
    expect(domMap.statusBadges.map((badge) => badge.text)).toContain('Host Healthy');
    expect(domMap.statusBadges.map((badge) => badge.text)).not.toContain('Listening');
    expect(serialized).not.toContain('Send command');
  });

  it('discovers host modal fields while excluding open SDK light-dom UI during app-map crawl', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/tickets');

    const openHostDialog = (): void => {
      if (document.getElementById('ticket-dialog')) {
        return;
      }
      const dialog = document.createElement('div');
      dialog.id = 'ticket-dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-label', 'New Ticket Modal');
      dialog.innerHTML = `
        <label for="ticket-title">Title</label>
        <input id="ticket-title" />
        <label for="ticket-priority">Priority</label>
        <select id="ticket-priority">
          <option value="low">Low</option>
          <option value="critical">Critical</option>
        </select>
        <button type="button">Create</button>
        <button type="button">Cancel</button>
      `;
      dialog.querySelectorAll('button').forEach((button) => {
        button.addEventListener('click', () => {
          dialog.remove();
        });
      });
      document.body.appendChild(dialog);
    };

    document.body.innerHTML = `
      <main>
        <h1>Tickets</h1>
        <button id="new-ticket-trigger" type="button" aria-haspopup="dialog">New Ticket</button>
      </main>
      <div data-exocor-ui="true" data-testid="exocor-sdk-root">
        <div role="dialog" aria-label="SDK Command Panel">
          <label for="sdk-command">Exocor command input</label>
          <input id="sdk-command" />
          <button type="button">Send command</button>
        </div>
      </div>
    `;
    document.getElementById('new-ticket-trigger')?.addEventListener('click', openHostDialog);

    const discoveryPromise = discoverAppMap();
    const discoveredLater = discoveryPromise.then((value) => value);

    await vi.advanceTimersByTimeAsync(5000);
    const appMap = await discoveredLater;
    const serialized = JSON.stringify(appMap);
    const route = appMap.routes.find((entry) => entry.path === '/tickets') || appMap.routes[0];

    expect(route?.modalTriggers.some((trigger) => trigger.label === 'New Ticket')).toBe(true);
    expect(route?.modalTriggers[0]?.modalContents?.formFields.some((field) => field.label === 'Title')).toBe(true);
    expect(route?.modalTriggers[0]?.modalContents?.formFields.some((field) => field.label === 'Priority')).toBe(true);
    expect(route?.modalTriggers[0]?.modalContents?.buttons.some((button) => button.label === 'Create')).toBe(true);
    expect(serialized).not.toContain('SDK Command Panel');
    expect(serialized).not.toContain('Exocor command input');
    expect(serialized).not.toContain('Send command');
  });

  it('uses discovery navigate driver before history fallback', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/origin');

    const pushSpy = vi.spyOn(window.history, 'pushState');
    const driver = vi.fn((path: string) => {
      originalPushState({}, '', path);
      window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
    });

    const promise = __DOM_SCANNER_TESTING__.navigateForDiscovery('/driver-target', driver);
    let result: boolean | null = null;
    promise.then((value) => {
      result = value;
    });

    await vi.advanceTimersByTimeAsync(320);
    expect(result).toBe(true);
    expect(driver).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledTimes(0);
  });

  it('waits for bootstrap readiness before app-map discovery starts', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/');

    document.body.innerHTML = '<main><div>Loading screen</div></main>';
    window.setTimeout(() => {
      document.body.innerHTML = `
        <main>
          <button id="ready-action" type="button">Ready</button>
        </main>
      `;
    }, 500);

    const discoveryPromise = discoverAppMap();
    let resolved = false;
    discoveryPromise.then((value) => {
      resolved = Boolean(value);
    });

    await vi.advanceTimersByTimeAsync(450);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(1200);
    const discovered = await discoveryPromise;
    expect(discovered.routes.length).toBeGreaterThan(0);
  });

  it('proceeds with best-effort discovery after bootstrap timeout', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/');
    document.body.innerHTML = '<main><div>Still loading</div></main>';

    const discoveryPromise = discoverAppMap();
    let resolved = false;
    discoveryPromise.then((value) => {
      resolved = Boolean(value);
    });

    await vi.advanceTimersByTimeAsync(2900);
    expect(resolved).toBe(false);

    await vi.advanceTimersByTimeAsync(900);
    const discovered = await discoveryPromise;
    expect(discovered.routes.map((route) => route.path)).toContain('/');
  });

  it('expands route crawl queue from discovered navigation links', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/');

    const renderRoute = (path: string): void => {
      const normalized = path === '/tickets' || path === '/equipment' ? path : '/';
      if (normalized === '/') {
        document.body.innerHTML = `
          <main>
            <nav>
              <a href="/tickets">Tickets</a>
              <a href="/equipment">Equipment</a>
            </nav>
            <button type="button">Home Action</button>
          </main>
        `;
        return;
      }

      if (normalized === '/tickets') {
        document.body.innerHTML = `
          <main>
            <nav><a href="/">Home</a></nav>
            <h1>Tickets</h1>
            <button type="button">New Ticket</button>
          </main>
        `;
        return;
      }

      document.body.innerHTML = `
        <main>
          <nav><a href="/">Home</a></nav>
          <h1>Equipment</h1>
          <button type="button">Critical</button>
        </main>
      `;
    };

    renderRoute('/');

    const routeAwarePushState = vi.fn((state: any, title: string, url?: string | URL | null) => {
      originalPushState(state, title, url);
      const raw = typeof url === 'string' ? url : url?.toString() || '/';
      const nextPath = normalizePathFromUrl(raw);
      renderRoute(nextPath);
    });
    window.history.pushState = routeAwarePushState as History['pushState'];

    const discoveryPromise = discoverAppMap();
    await vi.advanceTimersByTimeAsync(7000);
    const discovered = await discoveryPromise;
    const discoveredPaths = discovered.routes.map((route) => route.path);

    expect(discoveredPaths).toEqual(expect.arrayContaining(['/', '/tickets', '/equipment']));
    expect(discoveredPaths.length).toBeGreaterThanOrEqual(3);
  });

  it('actively clicks triggers and tabs, captures modal contents, and skips destructive clicks', async () => {
    vi.useFakeTimers();

    document.body.innerHTML = `
      <main>
        <nav>
          <a href="/dashboard">Dashboard</a>
          <div role="link" data-to="/settings">Settings</div>
        </nav>

        <h1>Main Heading</h1>
        <div role="heading" aria-level="2">Section Heading</div>

        <div role="tablist" aria-label="Main Tabs">
          <button id="overview-tab" role="tab">Overview</button>
          <button id="activity-tab" role="tab">Activity</button>
        </div>
        <div id="activity-panel" role="tabpanel" aria-label="Details Panel" style="display: none;">
          <button id="panel-action">Panel Action</button>
        </div>

        <button id="open-details" aria-haspopup="true">Open Details</button>
        <button id="delete-trigger" aria-haspopup="true">Delete Item</button>

        <div id="details-modal" role="dialog" aria-modal="true" style="display: none;">
          <label for="detail-name">Detail Name</label>
          <input id="detail-name" type="text" required />
          <label for="detail-type">Detail Type</label>
          <select id="detail-type">
            <option>Alpha</option>
            <option>Beta</option>
          </select>
          <button aria-label="Close">Close</button>
          <button>Submit</button>
        </div>

        <label for="status-filter">Status Filter</label>
        <select id="status-filter">
          <option>Open</option>
          <option>Closed</option>
        </select>
      </main>
    `;

    let destructiveClicks = 0;
    const deleteTrigger = document.getElementById('delete-trigger') as HTMLButtonElement;
    deleteTrigger.addEventListener('click', () => {
      destructiveClicks += 1;
    });

    const modal = document.getElementById('details-modal') as HTMLElement;
    const panel = document.getElementById('activity-panel') as HTMLElement;
    (document.getElementById('open-details') as HTMLButtonElement).addEventListener('click', () => {
      modal.style.display = 'block';
    });
    (document.getElementById('activity-tab') as HTMLButtonElement).addEventListener('click', () => {
      panel.style.display = 'block';
    });
    (modal.querySelector('button[aria-label="Close"]') as HTMLButtonElement).addEventListener('click', () => {
      modal.style.display = 'none';
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        modal.style.display = 'none';
      }
    });

    const promise = __DOM_SCANNER_TESTING__.scanRouteMap('/dashboard', 'DashboardRoute');
    await vi.advanceTimersByTimeAsync(4000);
    const routeMap = await promise;

    expect(routeMap.navigationLinks.some((entry) => entry.path === '/dashboard')).toBe(true);
    expect(routeMap.navigationLinks.some((entry) => entry.path === '/settings')).toBe(true);

    expect(routeMap.buttons.some((button) => button.elementId === '#panel-action')).toBe(true);
    expect(routeMap.tabs.some((tab) => tab.label.toLowerCase().includes('activity'))).toBe(true);

    const openDetailsTrigger = routeMap.modalTriggers.find((trigger) => trigger.elementId === '#open-details');
    expect(openDetailsTrigger).toBeTruthy();
    expect(openDetailsTrigger?.modalContents.formFields.some((field) => field.label.toLowerCase().includes('detail name'))).toBe(
      true
    );
    expect(openDetailsTrigger?.modalContents.buttons.some((button) => button.label.toLowerCase().includes('close'))).toBe(true);

    expect(routeMap.formFields.some((field) => field.label.toLowerCase().includes('detail name'))).toBe(true);
    expect(routeMap.filters.some((filter) => filter.label.toLowerCase().includes('status'))).toBe(true);
    expect(routeMap.headings).toEqual(expect.arrayContaining(['Main Heading', 'Section Heading']));
    expect(destructiveClicks).toBe(0);
  });

  it('captures unique modal field selectors for mixed input/select/textarea controls', async () => {
    vi.useFakeTimers();

    document.body.innerHTML = `
      <main>
        <button id="open-ticket-modal" aria-haspopup="true">New Ticket</button>
        <div id="ticket-modal" role="dialog" aria-modal="true" style="display: none;">
          <label for="ticket-title">Title</label>
          <input id="ticket-title" type="text" />

          <label>Priority
            <select name="ticket-level">
              <option>Low</option>
              <option>Critical</option>
            </select>
          </label>

          <label>Status
            <select name="ticket-level">
              <option>Open</option>
              <option>Closed</option>
            </select>
          </label>

          <label for="ticket-description">Description</label>
          <textarea id="ticket-description"></textarea>

          <button aria-label="Close">Close</button>
          <button>Create</button>
        </div>
      </main>
    `;

    const modal = document.getElementById('ticket-modal') as HTMLElement;
    const trigger = document.getElementById('open-ticket-modal') as HTMLButtonElement;
    trigger.addEventListener('click', () => {
      modal.style.display = 'block';
    });
    const closeButton = modal.querySelector('button[aria-label="Close"]') as HTMLButtonElement;
    closeButton.addEventListener('click', () => {
      modal.style.display = 'none';
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        modal.style.display = 'none';
      }
    });

    const promise = __DOM_SCANNER_TESTING__.scanRouteMap('/tickets', 'TicketsRoute');
    await vi.advanceTimersByTimeAsync(4000);
    const routeMap = await promise;

    const modalTrigger = routeMap.modalTriggers.find((entry) => entry.elementId === '#open-ticket-modal');
    expect(modalTrigger).toBeTruthy();
    const fields = modalTrigger?.modalContents.formFields || [];

    expect(fields.length).toBe(4);

    const uniqueSelectors = new Set(fields.map((field) => field.elementId));
    expect(uniqueSelectors.size).toBe(4);

    const titleField = fields.find((field) => field.label.toLowerCase() === 'title');
    const priorityField = fields.find((field) => field.label.toLowerCase() === 'priority');
    const statusField = fields.find((field) => field.label.toLowerCase() === 'status');
    const descriptionField = fields.find((field) => field.label.toLowerCase() === 'description');

    expect(titleField).toBeTruthy();
    expect(priorityField).toBeTruthy();
    expect(statusField).toBeTruthy();
    expect(descriptionField).toBeTruthy();

    const titleSelector = titleField?.elementId || '';
    const prioritySelector = priorityField?.elementId || '';
    const statusSelector = statusField?.elementId || '';
    const descriptionSelector = descriptionField?.elementId || '';

    const titleElement = titleSelector ? document.querySelector(titleSelector) : null;
    const priorityElement = prioritySelector ? document.querySelector(prioritySelector) : null;
    const statusElement = statusSelector ? document.querySelector(statusSelector) : null;
    const descriptionElement = descriptionSelector ? document.querySelector(descriptionSelector) : null;

    expect(titleElement?.tagName.toLowerCase()).toBe('input');
    expect(priorityElement?.tagName.toLowerCase()).toBe('select');
    expect(statusElement?.tagName.toLowerCase()).toBe('select');
    expect(descriptionElement?.tagName.toLowerCase()).toBe('textarea');
    expect(priorityField?.elementId).not.toBe(statusField?.elementId);
  });

  it('summarizes app map without element IDs and includes submitButton/navigationLinks', () => {
    const appMap: AppMap = {
      version: 'v1',
      discoveredAt: Date.now(),
      routeCount: 1,
      routes: [
        {
          path: '/tickets',
          componentName: 'TicketsRoute',
          title: 'Tickets',
          navigationLinks: [
            { label: 'Dashboard', path: '/dashboard' },
            { label: 'Tickets', path: '/tickets' }
          ],
          buttons: [
            { elementId: '#btn-new-ticket', label: 'New Ticket' },
            { elementId: '#btn-refresh', label: 'Refresh' }
          ],
          tabs: [
            { elementId: '#tab-open', label: 'Open' },
            { elementId: '#tab-closed', label: 'Closed' }
          ],
          modalTriggers: [
            {
              elementId: '#btn-new-ticket',
              label: 'New Ticket',
              modalContents: {
                formFields: [
                  { label: 'Title', type: 'text', required: true },
                  { label: 'Priority', type: 'select', required: false }
                ],
                buttons: [{ label: 'Cancel' }, { label: 'Create' }]
              }
            }
          ],
          formFields: [{ elementId: '#title-input', label: 'Title', type: 'text', required: true }],
          filters: [{ elementId: '#filter-status', label: 'Status', options: ['Open', 'Closed'] }],
          headings: ['Tickets']
        }
      ]
    };

    const summary = summarizeAppMapForResolver(appMap, '/tickets', 800);
    expect(summary).toBeTruthy();
    const firstRoute = summary?.routes[0];
    expect(firstRoute).toBeTruthy();
    expect(firstRoute?.navigationLinks).toEqual(
      expect.arrayContaining([
        { label: 'Dashboard', path: '/dashboard' },
        { label: 'Tickets', path: '/tickets' }
      ])
    );
    expect(firstRoute?.modalTriggers[0]?.submitButton).toBe('Create');
    const serialized = JSON.stringify(firstRoute);
    expect(serialized.includes('elementId')).toBe(false);
  });

  it('rejects cached app maps with duplicate modal field selector collisions', () => {
    saveAppMapToCache({
      version: 'v3',
      discoveredAt: Date.now(),
      routeCount: 1,
      routes: [
        {
          path: '/tickets',
          componentName: 'TicketsRoute',
          title: 'Tickets',
          navigationLinks: [],
          modalTriggers: [
            {
              elementId: '#new-ticket',
              label: 'New Ticket',
              modalContents: {
                formFields: [
                  { label: 'Title', type: 'text', required: true, elementId: '#ticket-title' },
                  { label: 'Priority', type: 'select', required: true, elementId: '#ticket-title' }
                ],
                buttons: []
              }
            }
          ],
          formFields: [],
          buttons: [],
          filters: [],
          tabs: [],
          headings: [],
          locators: [
            {
              id: '/tickets::modalTrigger::newticket::0',
              kind: 'modalTrigger',
              label: 'New Ticket',
              labelKey: 'newticket',
              selectorCandidates: ['#new-ticket'],
              clickable: true
            }
          ]
        }
      ]
    } as AppMap);

    const result = readCachedAppMapWithReason();
    expect(result.appMap).toBeNull();
    expect(result.reason).toBe('integrity_invalid');
  });

  it('rejects cached app maps with malformed locator entries', () => {
    saveAppMapToCache({
      version: 'v3',
      discoveredAt: Date.now(),
      routeCount: 1,
      routes: [
        {
          path: '/tickets',
          componentName: 'TicketsRoute',
          title: 'Tickets',
          navigationLinks: [],
          modalTriggers: [],
          formFields: [],
          buttons: [],
          filters: [],
          tabs: [],
          headings: [],
          locators: [
            {
              id: '/tickets::button::newticket::0',
              kind: 'button',
              label: 'New Ticket',
              labelKey: '',
              selectorCandidates: []
            }
          ]
        }
      ]
    } as AppMap);

    const result = readCachedAppMapWithReason();
    expect(result.appMap).toBeNull();
    expect(result.reason).toBe('integrity_invalid');
  });
});
