import { IntentResolver } from '../core/IntentResolver';
import type {
  ExocorFailedStepRequest,
  ExocorFollowUpRequest,
  ExocorInitialStreamRequest,
  ExocorNewElementsRequest,
  ExocorPreferredToolIntentRequest,
  ExocorPreferredToolRetryRequest,
  ExocorResolveRequest,
  ExocorResolverEnvelope,
  ExocorResolverRequest,
  ExocorResolverStreamEvent
} from '../core/resolverProtocol';
import type { IntentResolutionInput, IntentStep, ResolutionPriority } from '../types';

export interface ExocorResolverEndpointOptions {
  apiKey?: string;
  debug?: boolean;
}

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store'
};

const STREAM_HEADERS = {
  'Content-Type': 'application/x-ndjson; charset=utf-8',
  'Cache-Control': 'no-store'
};

function jsonResponse<T>(payload: ExocorResolverEnvelope<T>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isResolverRequest(value: unknown): value is ExocorResolverRequest {
  if (!isRecord(value) || typeof value.operation !== 'string') {
    return false;
  }

  return [
    'initial_stream',
    'resolve',
    'preferred_tool_intent',
    'preferred_tool_retry',
    'failed_step',
    'new_elements',
    'follow_up'
  ].includes(value.operation);
}

function isIntentResolutionInput(value: unknown): value is IntentResolutionInput {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.command === 'string' &&
    typeof value.inputMethod === 'string' &&
    isRecord(value.map) &&
    (typeof value.gazeTarget === 'string' || value.gazeTarget === null)
  );
}

function isIntentStep(value: unknown): value is IntentStep {
  if (!isRecord(value)) {
    return false;
  }

  return typeof value.action === 'string' && typeof value.reason === 'string';
}

function resolveApiKey(options: ExocorResolverEndpointOptions): string {
  return options.apiKey || process.env.ANTHROPIC_API_KEY || '';
}

function encodeStreamEvent(event: ExocorResolverStreamEvent, encoder: TextEncoder): Uint8Array {
  return encoder.encode(`${JSON.stringify(event)}\n`);
}

export function createExocorResolverEndpoint(options: ExocorResolverEndpointOptions = {}) {
  return async function handleExocorResolverRequest(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return jsonResponse({ ok: false, error: 'Method not allowed.' }, 405);
    }

    const apiKey = resolveApiKey(options);
    if (!apiKey) {
      return jsonResponse({ ok: false, error: 'ANTHROPIC_API_KEY is not configured on the server.' }, 500);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: 'Invalid JSON payload.' }, 400);
    }

    if (!isResolverRequest(payload)) {
      return jsonResponse({ ok: false, error: 'Invalid resolver request.' }, 400);
    }

    const resolver = new IntentResolver({
      apiKey,
      debug: options.debug
    });

    try {
      switch (payload.operation) {
        case 'initial_stream': {
          const streamRequest = payload as ExocorInitialStreamRequest;
          if (!isIntentResolutionInput(streamRequest.input)) {
            return jsonResponse({ ok: false, error: 'Invalid resolver request.' }, 400);
          }
          const encoder = new TextEncoder();
          let resolutionPriority: ResolutionPriority | undefined;

          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              void (async () => {
                try {
                  const result = await resolver.resolveWithContextStreamInternal(
                    streamRequest.input,
                    streamRequest.runtimeContext,
                    {
                      onResolutionPriority: (priority) => {
                        resolutionPriority = priority;
                      },
                      onStep: (step) => {
                        controller.enqueue(
                          encodeStreamEvent(
                            {
                              type: 'step',
                              step,
                              ...(resolutionPriority ? { resolutionPriority } : {})
                            },
                            encoder
                          )
                        );
                      }
                    }
                  );

                  controller.enqueue(
                    encodeStreamEvent(
                      {
                        type: 'result',
                        result
                      },
                      encoder
                    )
                  );
                } catch (error) {
                  const message =
                    options.debug && error instanceof Error ? error.message : 'Resolver request failed.';
                  controller.enqueue(
                    encodeStreamEvent(
                      {
                        type: 'error',
                        message
                      },
                      encoder
                    )
                  );
                } finally {
                  controller.close();
                }
              })();
            }
          });

          return new Response(stream, {
            status: 200,
            headers: STREAM_HEADERS
          });
        }

        case 'resolve': {
          const resolveRequest = payload as ExocorResolveRequest;
          if (!isIntentResolutionInput(resolveRequest.input)) {
            return jsonResponse({ ok: false, error: 'Invalid resolver request.' }, 400);
          }
          const plan = await resolver.resolve(resolveRequest.input);
          return jsonResponse({ ok: true, data: { plan } });
        }

        case 'preferred_tool_intent': {
          const preferredToolIntentRequest = payload as ExocorPreferredToolIntentRequest;
          if (
            !isIntentResolutionInput(preferredToolIntentRequest.input) ||
            typeof preferredToolIntentRequest.preferredToolId !== 'string' ||
            (preferredToolIntentRequest.preferredReason !== undefined &&
              typeof preferredToolIntentRequest.preferredReason !== 'string')
          ) {
            return jsonResponse({ ok: false, error: 'Invalid resolver request.' }, 400);
          }

          const result = await resolver.resolvePreferredToolIntent(
            preferredToolIntentRequest.input,
            preferredToolIntentRequest.preferredToolId,
            preferredToolIntentRequest.preferredReason || ''
          );
          return jsonResponse({ ok: true, data: { result } });
        }

        case 'preferred_tool_retry': {
          const retryRequest = payload as ExocorPreferredToolRetryRequest;
          if (
            !isIntentResolutionInput(retryRequest.input) ||
            typeof retryRequest.preferredToolId !== 'string' ||
            typeof retryRequest.preferredReason !== 'string' ||
            !retryRequest.rejectedPlan ||
            !Array.isArray(retryRequest.rejectedPlan.steps)
          ) {
            return jsonResponse({ ok: false, error: 'Invalid resolver request.' }, 400);
          }

          const steps = await resolver.resolveWithPreferredToolRetry(
            retryRequest.input,
            retryRequest.preferredToolId,
            retryRequest.preferredReason,
            retryRequest.rejectedPlan
          );
          return jsonResponse({ ok: true, data: { steps } });
        }

        case 'failed_step': {
          const failedStepRequest = payload as ExocorFailedStepRequest;
          if (
            !isIntentResolutionInput(failedStepRequest.input) ||
            !isIntentStep(failedStepRequest.failedStep) ||
            typeof failedStepRequest.failureReason !== 'string'
          ) {
            return jsonResponse({ ok: false, error: 'Invalid resolver request.' }, 400);
          }
          const steps = await resolver.resolveForFailedStep(
            failedStepRequest.input,
            failedStepRequest.failedStep,
            failedStepRequest.failureReason
          );
          return jsonResponse({ ok: true, data: { steps } });
        }

        case 'new_elements': {
          const newElementsRequest = payload as ExocorNewElementsRequest;
          if (
            !isIntentResolutionInput(newElementsRequest.input) ||
            !Array.isArray(newElementsRequest.newElements) ||
            !Array.isArray(newElementsRequest.completedSteps)
          ) {
            return jsonResponse({ ok: false, error: 'Invalid resolver request.' }, 400);
          }
          const steps = await resolver.resolveForNewElements(
            newElementsRequest.input,
            newElementsRequest.newElements,
            newElementsRequest.completedSteps
          );
          return jsonResponse({ ok: true, data: { steps } });
        }

        case 'follow_up': {
          const followUpRequest = payload as ExocorFollowUpRequest;
          if (
            !isIntentResolutionInput(followUpRequest.input) ||
            !Array.isArray(followUpRequest.completedSteps) ||
            typeof followUpRequest.instruction !== 'string'
          ) {
            return jsonResponse({ ok: false, error: 'Invalid resolver request.' }, 400);
          }
          const steps = await resolver.resolveFollowUp(
            followUpRequest.input,
            followUpRequest.completedSteps,
            followUpRequest.instruction
          );
          return jsonResponse({ ok: true, data: { steps } });
        }
      }
    } catch (error) {
      const message = options.debug && error instanceof Error ? error.message : 'Resolver request failed.';
      return jsonResponse({ ok: false, error: message }, 500);
    }
  };
}
