import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCapabilityMap } from '../core/CapabilityMap';
import { createExocorResolverEndpoint } from '../server';
import type { IntentPlan, IntentResolutionInput, IntentStep } from '../types';

const {
  resolveSpy,
  resolveStreamSpy,
  resolvePreferredToolIntentSpy,
  resolveWithPreferredToolRetrySpy,
  resolveForFailedStepSpy,
  resolveForNewElementsSpy,
  resolveFollowUpSpy
} = vi.hoisted(() => ({
  resolveSpy: vi.fn(),
  resolveStreamSpy: vi.fn(),
  resolvePreferredToolIntentSpy: vi.fn(),
  resolveWithPreferredToolRetrySpy: vi.fn(),
  resolveForFailedStepSpy: vi.fn(),
  resolveForNewElementsSpy: vi.fn(),
  resolveFollowUpSpy: vi.fn()
}));

vi.mock('../core/IntentResolver', () => ({
  IntentResolver: class {
    async resolve(input: IntentResolutionInput) {
      return resolveSpy(input);
    }

    async resolveWithContextStreamInternal(
      input: IntentResolutionInput,
      runtimeContext?: Record<string, unknown>,
      callbacks?: {
        onResolutionPriority?: (priority: 'app_map_only' | 'route_then_dom' | 'dom_only') => void;
        onStep?: (step: IntentStep) => void;
      }
    ) {
      return resolveStreamSpy(input, runtimeContext, callbacks);
    }

    async resolvePreferredToolIntent(input: IntentResolutionInput, preferredToolId: string, preferredReason?: string) {
      return resolvePreferredToolIntentSpy(input, preferredToolId, preferredReason);
    }

    async resolveWithPreferredToolRetry(
      input: IntentResolutionInput,
      preferredToolId: string,
      preferredReason: string,
      rejectedPlan: IntentPlan
    ) {
      return resolveWithPreferredToolRetrySpy(input, preferredToolId, preferredReason, rejectedPlan);
    }

    async resolveForFailedStep(
      input: IntentResolutionInput,
      failedStep: IntentStep,
      failureReason: string
    ) {
      return resolveForFailedStepSpy(input, failedStep, failureReason);
    }

    async resolveForNewElements(
      input: IntentResolutionInput,
      newElements: IntentResolutionInput['map']['elements'],
      completedSteps: IntentStep[]
    ) {
      return resolveForNewElementsSpy(input, newElements, completedSteps);
    }

    async resolveFollowUp(input: IntentResolutionInput, completedSteps: IntentStep[], instruction: string) {
      return resolveFollowUpSpy(input, completedSteps, instruction);
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

describe('createExocorResolverEndpoint', () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    resolveSpy.mockReset();
    resolveStreamSpy.mockReset();
    resolvePreferredToolIntentSpy.mockReset();
    resolveWithPreferredToolRetrySpy.mockReset();
    resolveForFailedStepSpy.mockReset();
    resolveForNewElementsSpy.mockReset();
    resolveFollowUpSpy.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    if (originalApiKey) {
      process.env.ANTHROPIC_API_KEY = originalApiKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it('rejects non-POST requests', async () => {
    const handler = createExocorResolverEndpoint({ apiKey: 'server-key' });
    const response = await handler(new Request('http://localhost/api/exocor/resolve', { method: 'GET' }));

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Method not allowed.'
    });
  });

  it('rejects invalid resolver payloads', async () => {
    const handler = createExocorResolverEndpoint({ apiKey: 'server-key' });
    const response = await handler(
      new Request('http://localhost/api/exocor/resolve', {
        method: 'POST',
        body: JSON.stringify({ nope: true })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'Invalid resolver request.'
    });
  });

  it('fails closed when the server API key is missing', async () => {
    const handler = createExocorResolverEndpoint();
    const response = await handler(
      new Request('http://localhost/api/exocor/resolve', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'resolve',
          input: buildResolutionInput()
        })
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: 'ANTHROPIC_API_KEY is not configured on the server.'
    });
  });

  it('streams step and result events for initial planning', async () => {
    const step: IntentStep = {
      action: 'navigate',
      target: '/tickets',
      value: null,
      waitForDOM: true,
      reason: 'navigate to tickets'
    };
    const result = {
      type: 'dom_steps' as const,
      plan: {
        source: 'claude',
        rawCommand: 'open tickets',
        confidence: 0.9,
        steps: [step]
      },
      resolutionPriority: 'route_then_dom' as const
    };

    resolveStreamSpy.mockImplementationOnce(
      async (
        _input: IntentResolutionInput,
        _runtimeContext?: Record<string, unknown>,
        callbacks?: {
          onResolutionPriority?: (priority: 'app_map_only' | 'route_then_dom' | 'dom_only') => void;
          onStep?: (step: IntentStep) => void;
        }
      ) => {
        callbacks?.onResolutionPriority?.('route_then_dom');
        callbacks?.onStep?.(step);
        return result;
      }
    );

    const handler = createExocorResolverEndpoint({ apiKey: 'server-key' });
    const response = await handler(
      new Request('http://localhost/api/exocor/resolve', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'initial_stream',
          input: buildResolutionInput(),
          runtimeContext: { inputMethod: 'typed' }
        })
      })
    );

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
      type: 'result',
      result
    });
  });

  it('returns JSON envelopes for non-stream resolver operations', async () => {
    const plan: IntentPlan = {
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
    };
    resolveSpy.mockResolvedValueOnce(plan);

    const handler = createExocorResolverEndpoint({ apiKey: 'server-key' });
    const response = await handler(
      new Request('http://localhost/api/exocor/resolve', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'resolve',
          input: buildResolutionInput()
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        plan
      }
    });
  });

  it('returns JSON envelopes for preferred-tool intent operations', async () => {
    const result = {
      status: 'ready' as const,
      args: { title: 'Pump Failure' }
    };
    resolvePreferredToolIntentSpy.mockResolvedValueOnce(result);

    const handler = createExocorResolverEndpoint({ apiKey: 'server-key' });
    const input = buildResolutionInput();
    const response = await handler(
      new Request('http://localhost/api/exocor/resolve', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'preferred_tool_intent',
          input,
          preferredToolId: 'createTicket',
          preferredReason: 'strong semantic match'
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        result
      }
    });
    expect(resolvePreferredToolIntentSpy).toHaveBeenCalledWith(input, 'createTicket', 'strong semantic match');
  });

  it('returns JSON envelopes for preferred-tool retry operations', async () => {
    const retriedSteps: IntentStep[] = [
      {
        action: 'navigate',
        target: '/tickets',
        value: null,
        waitForDOM: true,
        reason: 'navigate to tickets first'
      },
      {
        action: 'tool',
        toolId: 'createTicket',
        args: { title: 'Pump Failure' },
        reason: 'use preferred app-native tool'
      }
    ];
    resolveWithPreferredToolRetrySpy.mockResolvedValueOnce(retriedSteps);

    const handler = createExocorResolverEndpoint({ apiKey: 'server-key' });
    const input = buildResolutionInput();
    const rejectedPlan: IntentPlan = {
      source: 'claude',
      rawCommand: 'create a ticket called Pump Failure',
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
          action: 'click',
          target: 'Create',
          value: null,
          waitForDOM: true,
          reason: 'submit ticket'
        }
      ]
    };

    const response = await handler(
      new Request('http://localhost/api/exocor/resolve', {
        method: 'POST',
        body: JSON.stringify({
          operation: 'preferred_tool_retry',
          input,
          preferredToolId: 'createTicket',
          preferredReason: 'strong semantic match',
          rejectedPlan
        })
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: {
        steps: retriedSteps
      }
    });
    expect(resolveWithPreferredToolRetrySpy).toHaveBeenCalledWith(
      input,
      'createTicket',
      'strong semantic match',
      rejectedPlan
    );
  });
});
