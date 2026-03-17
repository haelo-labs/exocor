import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapabilityMap } from '../core/CapabilityMap';
import { createExocorDevRelayHandler } from '../server';
import type { IntentResolutionInput, IntentStep } from '../types';

const { resolveStreamSpy } = vi.hoisted(() => ({
  resolveStreamSpy: vi.fn()
}));

vi.mock('../core/IntentResolver', () => ({
  IntentResolver: class {
    async resolveWithContextStreamInternal(
      _input: IntentResolutionInput,
      _runtimeContext?: Record<string, unknown>,
      callbacks?: {
        onResolutionPriority?: (priority: 'app_map_only' | 'route_then_dom' | 'dom_only') => void;
        onStep?: (step: IntentStep) => void;
      }
    ) {
      return resolveStreamSpy(callbacks);
    }
  }
}));

function buildResolutionInput(): IntentResolutionInput {
  return {
    command: 'open tickets',
    inputMethod: 'text',
    map: createCapabilityMap({
      elements: [],
      routes: ['/tickets'],
      currentRoute: '/',
      currentUrl: 'http://localhost/',
      routeParams: {},
      pageTitle: 'Home',
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
    }),
    appMap: null,
    gazeTarget: null,
    gesture: 'none'
  };
}

describe('createExocorDevRelayHandler', () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    resolveStreamSpy.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('reports a healthy relay when the server key is configured', async () => {
    const handler = createExocorDevRelayHandler({ apiKey: 'server-key' });
    const response = await handler(new Request('http://127.0.0.1:8787/health', { method: 'GET' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        status: 'ready'
      }
    });
  });

  it('fails closed on health checks when the server key is missing', async () => {
    const handler = createExocorDevRelayHandler();
    const response = await handler(new Request('http://127.0.0.1:8787/health', { method: 'GET' }));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'ANTHROPIC_API_KEY is not configured on the local Exocor relay.'
    });
  });

  it('handles localhost CORS preflight requests', async () => {
    const handler = createExocorDevRelayHandler();
    const response = await handler(
      new Request('http://127.0.0.1:8787/api/exocor/resolve', {
        method: 'OPTIONS',
        headers: {
          Origin: 'http://localhost:5173'
        }
      })
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });

  it('streams resolver events through the local relay handler', async () => {
    const step: IntentStep = {
      action: 'navigate',
      target: '/tickets',
      value: null,
      waitForDOM: true,
      reason: 'navigate to tickets'
    };

    resolveStreamSpy.mockImplementationOnce(
      async (
        callbacks?: {
          onResolutionPriority?: (priority: 'app_map_only' | 'route_then_dom' | 'dom_only') => void;
          onStep?: (step: IntentStep) => void;
        }
      ) => {
        callbacks?.onResolutionPriority?.('route_then_dom');
        callbacks?.onStep?.(step);
        return {
          type: 'dom_steps' as const,
          plan: {
            source: 'claude',
            rawCommand: 'open tickets',
            confidence: 0.9,
            steps: [step]
          },
          resolutionPriority: 'route_then_dom' as const
        };
      }
    );

    const handler = createExocorDevRelayHandler({ apiKey: 'server-key' });
    const response = await handler(
      new Request('http://127.0.0.1:8787/api/exocor/resolve', {
        method: 'POST',
        headers: {
          Origin: 'http://localhost:5173',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          operation: 'initial_stream',
          input: buildResolutionInput()
        })
      })
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');

    const lines = (await response.text())
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));

    expect(lines[0]).toMatchObject({
      type: 'step',
      step,
      resolutionPriority: 'route_then_dom'
    });
    expect(lines[1]).toMatchObject({
      type: 'result'
    });
  });
});
