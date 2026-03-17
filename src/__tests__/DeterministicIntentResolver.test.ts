import { describe, expect, it } from 'vitest';
import { createCapabilityMap } from '../core/CapabilityMap';
import { DeterministicIntentResolver } from '../core/DeterministicIntentResolver';
import type { DOMCapabilityMap, DOMElementDescriptor } from '../types';

function descriptor(overrides: Partial<DOMElementDescriptor>): DOMElementDescriptor {
  return {
    id: overrides.id || 'e1',
    selector: overrides.selector || '#el',
    label: overrides.label || '',
    text: overrides.text || '',
    role: overrides.role || 'button',
    tagName: overrides.tagName || 'button',
    rect: overrides.rect || { x: 0, y: 0, width: 120, height: 32 },
    ...(overrides.visible !== undefined ? { visible: overrides.visible } : {}),
    ...(overrides.disabled !== undefined ? { disabled: overrides.disabled } : {}),
    ...(overrides.type !== undefined ? { type: overrides.type } : {}),
    ...(overrides.fillable !== undefined ? { fillable: overrides.fillable } : {}),
    ...(overrides.href !== undefined ? { href: overrides.href } : {}),
    ...(overrides.ariaLabel !== undefined ? { ariaLabel: overrides.ariaLabel } : {})
  };
}

function mapFrom(elements: DOMElementDescriptor[], currentRoute: string): DOMCapabilityMap {
  return createCapabilityMap({
    elements,
    routes: [currentRoute],
    currentRoute,
    currentUrl: `http://localhost${currentRoute}`,
    routeParams: {},
    pageTitle: currentRoute === '/equipment' ? 'Equipment' : 'Workspace',
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

describe('DeterministicIntentResolver', () => {
  it('resolves gaze-based open to the live gaze target without Haiku', () => {
    const resolver = new DeterministicIntentResolver();
    const map = mapFrom(
      [descriptor({ id: 'e1', selector: '#new-ticket', label: 'New Ticket', text: 'New Ticket' })],
      '/tickets'
    );

    const resolved = resolver.resolve({
      command: 'open',
      inputMethod: 'voice',
      map,
      appMap: null,
      gazeTarget: 'e1',
      gesture: 'none'
    });

    expect(resolved).toMatchObject({
      resolutionPriority: 'dom_only',
      plan: {
        source: 'deterministic',
        steps: [{ action: 'click', target: 'e1', reason: 'activate gaze target' }]
      }
    });
  });

  it('resolves gaze-based confirmation commands to the live gaze target without Haiku', () => {
    const resolver = new DeterministicIntentResolver();
    const map = mapFrom(
      [descriptor({ id: 'e1', selector: '#confirm', label: 'Confirm', text: 'Confirm' })],
      '/tickets'
    );

    const resolved = resolver.resolve({
      command: 'yes',
      inputMethod: 'voice',
      map,
      appMap: null,
      gazeTarget: 'e1',
      gesture: 'none'
    });

    expect(resolved?.plan.steps[0]).toMatchObject({
      action: 'click',
      target: 'e1'
    });
  });

  it('resolves navigate commands by clicking the unique visible target', () => {
    const resolver = new DeterministicIntentResolver();
    const map = mapFrom(
      [descriptor({ id: 'e2', selector: '#nav-equipment', label: 'Equipment', text: 'Equipment' })],
      '/tickets'
    );

    const resolved = resolver.resolve({
      command: 'go to equipment',
      inputMethod: 'text',
      map,
      appMap: null,
      gazeTarget: null,
      gesture: 'none'
    });

    expect(resolved).toMatchObject({
      resolutionPriority: 'dom_only',
      plan: {
        source: 'deterministic',
        steps: [{ action: 'click', target: 'e2', reason: 'navigate to Equipment' }]
      }
    });
  });

  it('resolves direct activation by exact visible button match', () => {
    const resolver = new DeterministicIntentResolver();
    const map = mapFrom(
      [descriptor({ id: 'e3', selector: '#critical-filter', label: 'Critical', text: 'Critical' })],
      '/equipment'
    );

    const resolved = resolver.resolve({
      command: 'click critical',
      inputMethod: 'text',
      map,
      appMap: null,
      gazeTarget: null,
      gesture: 'none'
    });

    expect(resolved).toMatchObject({
      resolutionPriority: 'dom_only',
      plan: {
        source: 'deterministic',
        steps: [{ action: 'click', target: 'e3', reason: 'click Critical' }]
      }
    });
  });

  it('resolves direct activation by exact visible tab match', () => {
    const resolver = new DeterministicIntentResolver();
    const map = mapFrom(
      [descriptor({ id: 'e4', selector: '#activity-tab', label: 'Activity', text: 'Activity', role: 'tab' })],
      '/workspace'
    );

    const resolved = resolver.resolve({
      command: 'select activity',
      inputMethod: 'text',
      map,
      appMap: null,
      gazeTarget: null,
      gesture: 'none'
    });

    expect(resolved).toMatchObject({
      resolutionPriority: 'dom_only',
      plan: {
        source: 'deterministic',
        steps: [{ action: 'click', target: 'e4', reason: 'click Activity' }]
      }
    });
  });

  it('returns null when more than one visible target matches exactly', () => {
    const resolver = new DeterministicIntentResolver();
    const map = mapFrom(
      [
        descriptor({ id: 'e5', selector: '#equipment-primary', label: 'Equipment', text: 'Equipment' }),
        descriptor({ id: 'e6', selector: '#equipment-secondary', label: 'Equipment', text: 'Equipment' })
      ],
      '/tickets'
    );

    const resolved = resolver.resolve({
      command: 'open equipment',
      inputMethod: 'text',
      map,
      appMap: null,
      gazeTarget: null,
      gesture: 'none'
    });

    expect(resolved).toBeNull();
  });

  it('returns null for complex or interpretive commands', () => {
    const resolver = new DeterministicIntentResolver();
    const map = mapFrom(
      [descriptor({ id: 'e1', selector: '#new-ticket', label: 'New Ticket', text: 'New Ticket' })],
      '/tickets'
    );

    const commands = [
      'create a ticket called Pump Failure with priority critical',
      'show me details of ticket 4',
      'navigate to equipment and filter for critical',
      'open ticket 4'
    ];

    for (const command of commands) {
      const resolved = resolver.resolve({
        command,
        inputMethod: 'text',
        map,
        appMap: null,
        gazeTarget: null,
        gesture: 'none'
      });
      expect(resolved).toBeNull();
    }
  });
});
