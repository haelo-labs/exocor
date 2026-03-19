import { describe, expect, it } from 'vitest';
import { createToolRegistry, normalizeToolRoutePath } from '../core/ToolRegistry';

describe('ToolRegistry', () => {
  it('normalizes routes for comparison and planner metadata', () => {
    expect(normalizeToolRoutePath('/tickets/?tab=open#composer')).toBe('/tickets');
    expect(normalizeToolRoutePath('tickets//')).toBe('/tickets');
    expect(normalizeToolRoutePath('')).toBe('/');

    const registry = createToolRegistry([
      {
        id: 'createTicket',
        description: 'Create ticket',
        routes: ['/tickets/?tab=open#composer', '/tickets/'],
        handler: () => undefined
      }
    ]);

    const capabilityMap = registry.buildCapabilityMap('/tickets/?tab=open#new');
    expect(capabilityMap.currentRoute).toBe('/tickets');
    expect(capabilityMap.tools[0]).toMatchObject({
      routes: ['/tickets'],
      currentRouteMatches: true,
      requiresNavigation: false
    });
  });

  it('rejects duplicate ids after normalization', () => {
    expect(() =>
      createToolRegistry([
        {
          id: 'CreateTicket',
          description: 'Create ticket',
          handler: () => undefined
        },
        {
          id: 'createticket',
          description: 'Create another ticket',
          handler: () => undefined
        }
      ])
    ).toThrow(/registered more than once/i);
  });

  it('strips handlers from planner metadata and includes both global and route-specific tools', () => {
    const registry = createToolRegistry([
      {
        id: 'refreshDashboard',
        description: 'Refresh dashboard',
        safety: 'read',
        handler: () => undefined
      },
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
        safety: 'write',
        handler: () => undefined
      }
    ]);

    const capabilityMap = registry.buildCapabilityMap('/dashboard');
    expect(capabilityMap.tools).toHaveLength(2);
    expect(capabilityMap.tools[0]).toMatchObject({
      id: 'refreshDashboard',
      isGlobal: true,
      currentRouteMatches: true,
      requiresNavigation: false,
      safety: 'read'
    });
    expect(capabilityMap.tools[1]).toMatchObject({
      id: 'createTicket',
      isGlobal: false,
      currentRouteMatches: false,
      requiresNavigation: true,
      routes: ['/tickets'],
      parameters: [
        {
          name: 'title',
          description: 'Ticket title',
          type: 'string',
          required: true
        }
      ]
    });
    expect(capabilityMap.tools[0]).not.toHaveProperty('handler');
    expect(capabilityMap.tools[1]).not.toHaveProperty('handler');
  });

  it('auto-runs exact global no-parameter tool matches only', () => {
    const registry = createToolRegistry([
      {
        id: 'refreshDashboard',
        description: 'Refresh dashboard',
        handler: () => undefined
      }
    ]);

    expect(registry.resolveDirectToolShortcut('refreshDashboard', '/anywhere')).toMatchObject({
      type: 'direct_execute',
      tool: { id: 'refreshDashboard' }
    });
    expect(registry.resolveDirectToolShortcut('Refresh dashboard', '/anywhere')).toMatchObject({
      type: 'direct_execute',
      tool: { id: 'refreshDashboard' }
    });
    expect(registry.resolveDirectToolShortcut('refresh', '/anywhere')).toBeNull();
  });

  it('only auto-runs exact route-scoped no-parameter tools on matching routes', () => {
    const registry = createToolRegistry([
      {
        id: 'createTicket',
        description: 'Create ticket',
        routes: ['/tickets'],
        handler: () => undefined
      }
    ]);

    expect(registry.resolveDirectToolShortcut('Create ticket', '/tickets?tab=open')).toMatchObject({
      type: 'direct_execute',
      tool: { id: 'createTicket' }
    });
    expect(registry.resolveDirectToolShortcut('Create ticket', '/dashboard')).toMatchObject({
      type: 'planner_only',
      reason: 'route_mismatch',
      tool: { id: 'createTicket' }
    });
  });

  it('disables direct execution when a matched tool has required parameters', () => {
    const registry = createToolRegistry([
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
        handler: () => undefined
      }
    ]);

    expect(registry.resolveDirectToolShortcut('createTicket', '/tickets')).toMatchObject({
      type: 'planner_only',
      reason: 'requires_params',
      tool: { id: 'createTicket' }
    });
  });
});
