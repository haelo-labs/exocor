import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapabilityMap } from '../core/CapabilityMap';
import { RemoteIntentResolver } from '../core/RemoteIntentResolver';
import type { IntentResolutionInput, IntentStep } from '../types';

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

function createNdjsonResponse(lines: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(`${line}\n`));
        }
        controller.close();
      }
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson'
      }
    }
  );
}

describe('RemoteIntentResolver', () => {
  const fetchSpy = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    fetchSpy.mockReset();
    vi.unstubAllGlobals();
  });

  it('posts resolve requests to the default Exocor backend route', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            plan: {
              source: 'claude',
              rawCommand: 'open tickets',
              confidence: 0.9,
              steps: [
                {
                  action: 'navigate',
                  target: '/tickets',
                  value: null,
                  waitForDOM: true,
                  reason: 'navigate to tickets'
                }
              ]
            }
          }
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    const resolver = new RemoteIntentResolver({ backendUrl: '/api/exocor/resolve' });
    const plan = await resolver.resolve(buildResolutionInput());

    expect(plan?.steps[0]?.target).toBe('/tickets');
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/exocor/resolve',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin'
      })
    );
  });

  it('streams step events and resolution priority from the backend', async () => {
    const step: IntentStep = {
      action: 'navigate',
      target: '/tickets',
      value: null,
      waitForDOM: true,
      reason: 'navigate to tickets'
    };

    fetchSpy.mockResolvedValueOnce(
      createNdjsonResponse([
        JSON.stringify({
          type: 'step',
          step,
          resolutionPriority: 'route_then_dom'
        }),
        JSON.stringify({
          type: 'result',
          result: {
            type: 'dom_steps',
            plan: {
              source: 'claude',
              rawCommand: 'open tickets',
              confidence: 0.9,
              steps: [step]
            },
            resolutionPriority: 'route_then_dom'
          }
        })
      ])
    );

    const onStep = vi.fn();
    const onResolutionPriority = vi.fn();
    const resolver = new RemoteIntentResolver({ backendUrl: '/api/exocor/resolve' });
    const result = await resolver.resolveWithContextStreamInternal(buildResolutionInput(), { inputMethod: 'typed' }, {
      onStep,
      onResolutionPriority
    });

    expect(onResolutionPriority).toHaveBeenCalledWith('route_then_dom');
    expect(onStep).toHaveBeenCalledWith(step);
    expect(result).toMatchObject({
      type: 'dom_steps',
      resolutionPriority: 'route_then_dom'
    });
  });

  it('fails safely when the backend returns an error envelope', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false, error: 'Resolver unavailable.' }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json'
        }
      })
    );

    const resolver = new RemoteIntentResolver({ backendUrl: '/api/exocor/resolve', debug: true });

    await expect(resolver.resolve(buildResolutionInput())).resolves.toBeNull();
  });

  it('uses the local Exocor relay automatically on localhost when it is healthy', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, data: { status: 'ready' } }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              plan: {
                source: 'claude',
                rawCommand: 'open tickets',
                confidence: 0.9,
                steps: []
              }
            }
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      );

    const resolver = new RemoteIntentResolver();
    await resolver.resolve(buildResolutionInput());

    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:8787/health',
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit'
      })
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:8787/api/exocor/resolve',
      expect.objectContaining({
        method: 'POST'
      })
    );
  });

  it('falls back to the same-origin backend route when the local relay is unavailable', async () => {
    fetchSpy
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            data: {
              plan: {
                source: 'claude',
                rawCommand: 'open tickets',
                confidence: 0.9,
                steps: []
              }
            }
          }),
          {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          }
        )
      );

    const resolver = new RemoteIntentResolver();
    await resolver.resolve(buildResolutionInput());

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      '/api/exocor/resolve',
      expect.objectContaining({
        method: 'POST'
      })
    );
  });

  it('prefers an explicit backendUrl over local relay auto-detection', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            plan: {
              source: 'claude',
              rawCommand: 'open tickets',
              confidence: 0.9,
              steps: []
            }
          }
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json'
          }
        }
      )
    );

    const resolver = new RemoteIntentResolver({ backendUrl: 'https://resolver.example.com/run' });
    await resolver.resolve(buildResolutionInput());

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://resolver.example.com/run',
      expect.objectContaining({
        method: 'POST'
      })
    );
  });
});
