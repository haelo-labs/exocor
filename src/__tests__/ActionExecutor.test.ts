import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActionExecutor } from '../core/ActionExecutor';
import { createCapabilityMap } from '../core/CapabilityMap';
import type { AppMap, DOMCapabilityMap, DOMElementDescriptor, IntentStep } from '../types';

function descriptor(overrides: Partial<DOMElementDescriptor>): DOMElementDescriptor {
  return {
    id: overrides.id || 'e1',
    selector: overrides.selector || '#el',
    label: overrides.label || '',
    text: overrides.text || '',
    role: overrides.role || 'button',
    tagName: overrides.tagName || 'button',
    rect: overrides.rect || { x: 0, y: 0, width: 120, height: 32 },
    ...(overrides.fillable !== undefined ? { fillable: overrides.fillable } : {}),
    ...(overrides.type !== undefined ? { type: overrides.type } : {}),
    ...(overrides.ariaLabel !== undefined ? { ariaLabel: overrides.ariaLabel } : {}),
    ...(overrides.placeholder !== undefined ? { placeholder: overrides.placeholder } : {}),
    ...(overrides.disabled !== undefined ? { disabled: overrides.disabled } : {})
  };
}

function mapFrom(
  elements: DOMElementDescriptor[],
  currentRoute: string = '/',
  routes: string[] = [currentRoute]
): DOMCapabilityMap {
  return createCapabilityMap({
    elements,
    routes,
    currentRoute,
    currentUrl: `http://localhost${currentRoute}`,
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

describe('ActionExecutor label target resolution', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('prefers fillable candidates for fill actions when target is a label', async () => {
    document.body.innerHTML = `
      <button id="priority-button" type="button">Priority</button>
      <input id="priority-input" aria-label="Priority" />
    `;

    const map = mapFrom([
      descriptor({
        id: 'e1',
        selector: '#priority-button',
        label: 'Priority',
        text: 'Priority',
        role: 'button',
        tagName: 'button'
      }),
      descriptor({
        id: 'e2',
        selector: '#priority-input',
        label: 'Priority',
        text: '',
        role: 'textbox',
        tagName: 'input',
        fillable: true,
        type: 'text'
      })
    ]);

    const step: IntentStep = {
      action: 'fill',
      target: 'Priority',
      value: 'Critical',
      reason: 'set priority'
    };

    const executor = new ActionExecutor();
    const result = await executor.executeSequence([step], map, {
      originalIntent: 'set priority to critical'
    });

    expect(result.executed).toBe(true);
    expect((document.getElementById('priority-input') as HTMLInputElement).value).toBe('Critical');
  });

  it('prefers clickable candidates for click actions when target is a label', async () => {
    document.body.innerHTML = `
      <input id="create-input" aria-label="Create" />
      <button id="create-button" type="button">Create</button>
    `;

    let buttonClicks = 0;
    let inputClicks = 0;
    document.getElementById('create-button')?.addEventListener('click', () => {
      buttonClicks += 1;
    });
    document.getElementById('create-input')?.addEventListener('click', () => {
      inputClicks += 1;
    });

    const map = mapFrom([
      descriptor({
        id: 'e1',
        selector: '#create-input',
        label: 'Create',
        text: '',
        role: 'textbox',
        tagName: 'input',
        fillable: true,
        type: 'text'
      }),
      descriptor({
        id: 'e2',
        selector: '#create-button',
        label: 'Create',
        text: 'Create',
        role: 'button',
        tagName: 'button'
      })
    ]);

    const step: IntentStep = {
      action: 'click',
      target: 'Create',
      value: null,
      reason: 'click create'
    };

    const executor = new ActionExecutor();
    const result = await executor.executeSequence([step], map, {
      originalIntent: 'click create'
    });

    expect(result.completedSteps).toBe(1);
    expect(buttonClicks).toBe(1);
    expect(inputClicks).toBe(0);
  });

  it('bypasses label matching for e{number} targets', async () => {
    document.body.innerHTML = `
      <button id="submit-button" type="button">Submit</button>
    `;

    let submitClicks = 0;
    document.getElementById('submit-button')?.addEventListener('click', () => {
      submitClicks += 1;
    });

    const map = mapFrom([
      descriptor({
        id: 'e1',
        selector: '#missing-target',
        label: 'Submit',
        text: '',
        role: 'button',
        tagName: 'button'
      }),
      descriptor({
        id: 'e2',
        selector: '#submit-button',
        label: 'Submit',
        text: 'Submit',
        role: 'button',
        tagName: 'button'
      })
    ]);

    const step: IntentStep = {
      action: 'click',
      target: 'e1',
      value: null,
      reason: 'click e1'
    };

    const executor = new ActionExecutor();
    const result = await executor.executeSequence([step], map, {
      originalIntent: 'click e1'
    });

    expect(result.executed).toBe(false);
    expect(result.completedSteps).toBe(0);
    expect(result.failedStepReason).toContain('target not found');
    expect(submitClicks).toBe(0);
  });

  it('uses route-scoped app-map selectors deterministically for ambiguous labels', async () => {
    document.body.innerHTML = `
      <button id="new-equipment" type="button">New Ticket</button>
      <button id="new-ticket" type="button">New Ticket</button>
    `;
    window.history.pushState({}, '', '/tickets');

    let ticketsClicks = 0;
    let equipmentClicks = 0;
    document.getElementById('new-ticket')?.addEventListener('click', () => {
      ticketsClicks += 1;
      const marker = document.createElement('div');
      marker.id = 'tickets-clicked';
      document.body.appendChild(marker);
    });
    document.getElementById('new-equipment')?.addEventListener('click', () => {
      equipmentClicks += 1;
    });

    const map = mapFrom(
      [
        descriptor({
          id: 'e1',
          selector: '#new-equipment',
          label: 'New Ticket',
          text: 'New Ticket',
          role: 'button',
          tagName: 'button'
        }),
        descriptor({
          id: 'e2',
          selector: '#new-ticket',
          label: 'New Ticket',
          text: 'New Ticket',
          role: 'button',
          tagName: 'button'
        })
      ],
      '/tickets',
      ['/tickets', '/equipment']
    );

    const appMap: AppMap = {
      version: 'v1',
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
          buttons: [{ elementId: '#new-ticket', label: 'New Ticket' }],
          filters: [],
          tabs: [],
          headings: []
        },
        {
          path: '/equipment',
          componentName: 'EquipmentRoute',
          title: 'Equipment',
          navigationLinks: [],
          modalTriggers: [],
          formFields: [],
          buttons: [{ elementId: '#new-equipment', label: 'New Ticket' }],
          filters: [],
          tabs: [],
          headings: []
        }
      ]
    };

    const step: IntentStep = {
      action: 'click',
      target: 'New Ticket',
      value: null,
      reason: 'open new ticket'
    };

    const executor = new ActionExecutor();
    const result = await executor.executeSequence([step], map, {
      appMap,
      originalIntent: 'click ticket button'
    });

    expect(result.completedSteps).toBe(1);
    expect(result.executed).toBe(true);
    expect(ticketsClicks).toBe(1);
    expect(equipmentClicks).toBe(0);
    expect(document.getElementById('tickets-clicked')).toBeTruthy();
  });

  it('refreshes once on target miss and retries the same step', async () => {
    document.body.innerHTML = '';
    window.history.pushState({}, '', '/tickets');

    let clicks = 0;
    let refreshCalls = 0;

    const initialMap = mapFrom(
      [
        descriptor({
          id: 'e1',
          selector: '#new-ticket',
          label: 'New Ticket',
          text: 'New Ticket',
          role: 'button',
          tagName: 'button'
        })
      ],
      '/tickets',
      ['/tickets']
    );

    const refreshedMap = mapFrom(
      [
        descriptor({
          id: 'e1',
          selector: '#new-ticket',
          label: 'New Ticket',
          text: 'New Ticket',
          role: 'button',
          tagName: 'button'
        })
      ],
      '/tickets',
      ['/tickets']
    );

    const refreshMap = (): DOMCapabilityMap => {
      refreshCalls += 1;

      if (!document.getElementById('new-ticket')) {
        const button = document.createElement('button');
        button.id = 'new-ticket';
        button.type = 'button';
        button.textContent = 'New Ticket';
        button.addEventListener('click', () => {
          clicks += 1;
          const marker = document.createElement('div');
          marker.id = 'retry-clicked';
          document.body.appendChild(marker);
        });
        document.body.appendChild(button);
      }

      return refreshedMap;
    };

    const appMap: AppMap = {
      version: 'v1',
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
          buttons: [{ elementId: '#new-ticket', label: 'New Ticket' }],
          filters: [],
          tabs: [],
          headings: []
        }
      ]
    };

    const step: IntentStep = {
      action: 'click',
      target: 'New Ticket',
      value: null,
      reason: 'open new ticket'
    };

    const executor = new ActionExecutor();
    const result = await executor.executeSequence([step], initialMap, {
      appMap,
      refreshMap,
      originalIntent: 'click ticket button'
    });

    expect(result.executed).toBe(true);
    expect(result.completedSteps).toBe(1);
    expect(refreshCalls).toBe(2);
    expect(clicks).toBe(1);
    expect(document.getElementById('retry-clicked')).toBeTruthy();
  });

  it('treats action=submit as completion when submit executes without DOM confirmation signals', async () => {
    document.body.innerHTML = `
      <form id="ticket-form">
        <button id="submit-ticket" type="submit">Finalize</button>
      </form>
    `;
    window.history.pushState({}, '', '/tickets');

    const requestSubmitSpy = vi
      .spyOn(HTMLFormElement.prototype, 'requestSubmit')
      .mockImplementation(function requestSubmitMock(this: HTMLFormElement) {
        this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

    const map = mapFrom(
      [
        descriptor({
          id: 'e1',
          selector: '#submit-ticket',
          label: 'Finalize',
          text: 'Finalize',
          role: 'button',
          tagName: 'button'
        })
      ],
      '/tickets',
      ['/tickets']
    );

    const executor = new ActionExecutor();
    const result = await executor.executeSequence(
      [
        {
          action: 'submit',
          target: '#submit-ticket',
          value: null,
          reason: 'submit ticket form'
        }
      ],
      map,
      { originalIntent: 'create ticket' }
    );

    expect(result.executed).toBe(true);
    expect(result.successDescription).toContain('submit-like completion action executed');
    expect(requestSubmitSpy).toHaveBeenCalledTimes(1);
  });

  it('treats click on app-map submit locator as completion without DOM confirmation signals', async () => {
    document.body.innerHTML = `<button id="finalize-button" type="button">Finalize</button>`;
    window.history.pushState({}, '', '/tickets');

    let clicks = 0;
    document.getElementById('finalize-button')?.addEventListener('click', () => {
      clicks += 1;
    });

    const map = mapFrom(
      [
        descriptor({
          id: 'e1',
          selector: '#finalize-button',
          label: 'Finalize',
          text: 'Finalize',
          role: 'button',
          tagName: 'button'
        })
      ],
      '/tickets',
      ['/tickets']
    );

    const appMap: AppMap = {
      version: 'v1',
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
              id: '/tickets::submit::finalize::0',
              kind: 'submit',
              label: 'Finalize',
              labelKey: 'finalize',
              selectorCandidates: ['#finalize-button'],
              clickable: true
            }
          ]
        }
      ]
    };

    const executor = new ActionExecutor();
    const result = await executor.executeSequence(
      [
        {
          action: 'click',
          target: 'Finalize',
          value: null,
          reason: 'complete the form'
        }
      ],
      map,
      {
        appMap,
        originalIntent: 'create ticket'
      }
    );

    expect(result.executed).toBe(true);
    expect(result.successDescription).toContain('submit-like completion action executed');
    expect(clicks).toBe(1);
  });

  it('treats click as completion when reason includes submit-like keywords', async () => {
    document.body.innerHTML = `<button id="continue-button" type="button">Continue</button>`;
    window.history.pushState({}, '', '/tickets');

    let clicks = 0;
    document.getElementById('continue-button')?.addEventListener('click', () => {
      clicks += 1;
    });

    const map = mapFrom(
      [
        descriptor({
          id: 'e1',
          selector: '#continue-button',
          label: 'Continue',
          text: 'Continue',
          role: 'button',
          tagName: 'button'
        })
      ],
      '/tickets',
      ['/tickets']
    );

    const executor = new ActionExecutor();
    const result = await executor.executeSequence(
      [
        {
          action: 'click',
          target: '#continue-button',
          value: null,
          reason: 'Create the new ticket'
        }
      ],
      map,
      { originalIntent: 'create ticket' }
    );

    expect(result.executed).toBe(true);
    expect(result.successDescription).toContain('submit-like completion action executed');
    expect(clicks).toBe(1);
  });

  it('preserves refresh-on-miss, waitForDOM refresh, and strict success in streamed execution', async () => {
    document.body.innerHTML = '';
    window.history.pushState({}, '', '/tickets');

    let clicks = 0;
    let refreshCalls = 0;
    const baseMap = mapFrom(
      [
        descriptor({
          id: 'e1',
          selector: '#create-ticket',
          label: 'Create',
          text: 'Create',
          role: 'button',
          tagName: 'button'
        })
      ],
      '/tickets',
      ['/tickets']
    );

    const refreshMap = (): DOMCapabilityMap => {
      refreshCalls += 1;
      if (!document.getElementById('create-ticket')) {
        const button = document.createElement('button');
        button.id = 'create-ticket';
        button.type = 'button';
        button.textContent = 'Create';
        button.addEventListener('click', () => {
          clicks += 1;
        });
        document.body.appendChild(button);
      }
      return baseMap;
    };

    const appMap: AppMap = {
      version: 'v1',
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
              id: '/tickets::submit::create::0',
              kind: 'submit',
              label: 'Create',
              labelKey: 'create',
              selectorCandidates: ['#create-ticket'],
              clickable: true
            }
          ]
        }
      ]
    };

    async function* streamedSteps(): AsyncIterable<IntentStep> {
      yield {
        action: 'click',
        target: 'Create',
        value: null,
        waitForDOM: true,
        reason: 'submit the create form'
      };
    }

    const executor = new ActionExecutor();
    const result = await executor.executeStreamedSequence(streamedSteps(), baseMap, {
      appMap,
      refreshMap,
      originalIntent: 'create ticket'
    });

    expect(result.executed).toBe(true);
    expect(result.successDescription).toContain('submit-like completion action executed');
    expect(clicks).toBe(1);
    expect(refreshCalls).toBe(2);
  });

  it('waits for async modal render before the next streamed step even when waitForDOM is false', async () => {
    document.body.innerHTML = `<button id="open-ticket-modal" type="button">New Ticket</button>`;
    window.history.pushState({}, '', '/tickets');

    document.getElementById('open-ticket-modal')?.addEventListener('click', () => {
      window.setTimeout(() => {
        if (document.getElementById('ticket-title')) {
          return;
        }

        const dialog = document.createElement('div');
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-label', 'New Ticket Modal');

        const label = document.createElement('label');
        label.htmlFor = 'ticket-title';
        label.textContent = 'Title';

        const input = document.createElement('input');
        input.id = 'ticket-title';
        input.setAttribute('aria-label', 'Title');

        dialog.append(label, input);
        document.body.appendChild(dialog);
      }, 60);
    });

    const refreshMap = (): DOMCapabilityMap => {
      const elements: DOMElementDescriptor[] = [
        descriptor({
          id: 'e1',
          selector: '#open-ticket-modal',
          label: 'New Ticket',
          text: 'New Ticket',
          role: 'button',
          tagName: 'button'
        })
      ];

      if (document.getElementById('ticket-title')) {
        elements.push(
          descriptor({
            id: 'e2',
            selector: '#ticket-title',
            label: 'Title',
            text: '',
            role: 'textbox',
            tagName: 'input',
            fillable: true,
            type: 'text'
          })
        );
      }

      return mapFrom(elements, '/tickets', ['/tickets']);
    };

    const appMap: AppMap = {
      version: 'v1',
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
              id: '/tickets::modalTrigger::newticket::0',
              kind: 'modalTrigger',
              label: 'New Ticket',
              labelKey: 'newticket',
              selectorCandidates: ['#open-ticket-modal'],
              clickable: true
            },
            {
              id: '/tickets::formField::title::0',
              kind: 'formField',
              label: 'Title',
              labelKey: 'title',
              selectorCandidates: ['#ticket-title'],
              fillable: true,
              tagName: 'input',
              role: 'textbox'
            }
          ]
        }
      ]
    };

    async function* streamedSteps(): AsyncIterable<IntentStep> {
      yield {
        action: 'click',
        target: 'New Ticket',
        value: null,
        waitForDOM: false,
        reason: 'open the ticket modal'
      };
      yield {
        action: 'fill',
        target: 'Title',
        value: 'Pump Failure',
        waitForDOM: false,
        reason: 'fill ticket title'
      };
    }

    const executor = new ActionExecutor();
    const result = await executor.executeStreamedSequence(streamedSteps(), refreshMap(), {
      appMap,
      refreshMap,
      originalIntent: 'set the ticket title'
    });

    expect(result.executed).toBe(true);
    expect((document.getElementById('ticket-title') as HTMLInputElement | null)?.value).toBe('Pump Failure');
  });

  it('waits for async dependent UI after fill before clicking the next step', async () => {
    document.body.innerHTML = `
      <label for="ticket-title">Title</label>
      <input id="ticket-title" aria-label="Title" />
    `;
    window.history.pushState({}, '', '/tickets');

    let continueClicks = 0;
    document.getElementById('ticket-title')?.addEventListener('input', () => {
      window.setTimeout(() => {
        if (document.getElementById('continue-flow')) {
          return;
        }

        const button = document.createElement('button');
        button.id = 'continue-flow';
        button.type = 'button';
        button.textContent = 'Continue';
        button.addEventListener('click', () => {
          continueClicks += 1;
        });
        document.body.appendChild(button);
      }, 60);
    });

    const refreshMap = (): DOMCapabilityMap => {
      const elements: DOMElementDescriptor[] = [
        descriptor({
          id: 'e1',
          selector: '#ticket-title',
          label: 'Title',
          text: '',
          role: 'textbox',
          tagName: 'input',
          fillable: true,
          type: 'text'
        })
      ];

      if (document.getElementById('continue-flow')) {
        elements.push(
          descriptor({
            id: 'e2',
            selector: '#continue-flow',
            label: 'Continue',
            text: 'Continue',
            role: 'button',
            tagName: 'button'
          })
        );
      }

      return mapFrom(elements, '/tickets', ['/tickets']);
    };

    const appMap: AppMap = {
      version: 'v1',
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
              id: '/tickets::formField::title::0',
              kind: 'formField',
              label: 'Title',
              labelKey: 'title',
              selectorCandidates: ['#ticket-title'],
              fillable: true,
              tagName: 'input',
              role: 'textbox'
            },
            {
              id: '/tickets::button::continue::0',
              kind: 'button',
              label: 'Continue',
              labelKey: 'continue',
              selectorCandidates: ['#continue-flow'],
              clickable: true
            }
          ]
        }
      ]
    };

    const executor = new ActionExecutor();
    const result = await executor.executeSequence(
      [
        {
          action: 'fill',
          target: 'Title',
          value: 'Pump Failure',
          waitForDOM: false,
          reason: 'fill ticket title'
        },
        {
          action: 'click',
          target: 'Continue',
          value: null,
          waitForDOM: false,
          reason: 'continue flow'
        }
      ],
      refreshMap(),
      {
        appMap,
        refreshMap,
        originalIntent: 'fill title and continue'
      }
    );

    expect(result.executed).toBe(true);
    expect(continueClicks).toBe(1);
  });
});
