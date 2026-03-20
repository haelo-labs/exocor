import type { IntentPlan, IntentResolutionInput, IntentStep, ResolutionPriority, ResolvedIntent } from '../types';
import type {
  ExocorFailedStepRequest,
  ExocorFollowUpRequest,
  ExocorInitialStreamRequest,
  ExocorNewElementsRequest,
  ExocorPreferredToolIntentRequest,
  ExocorPreferredToolIntentResult,
  ExocorPreferredToolRetryRequest,
  ExocorResolveRequest,
  ExocorResolverEnvelope,
  ExocorResolverJsonResponse,
  ExocorResolverRequest
} from './resolverProtocol';
import { isExocorResolverStreamEvent } from './resolverProtocol';

type RemoteIntentResolverOptions = {
  backendUrl?: string;
  debug?: boolean;
};

interface StreamResolveCallbacks {
  onResolutionPriority?: (priority: ResolutionPriority) => void;
  onStep?: (step: IntentStep) => void;
}

const DEFAULT_BACKEND_URL = '/api/exocor/resolve';
const LOCAL_RELAY_HEALTH_URL = 'http://127.0.0.1:8787/health';
const LOCAL_RELAY_BACKEND_URL = 'http://127.0.0.1:8787/api/exocor/resolve';

function normalizeBackendUrl(backendUrl?: string): string {
  const trimmed = backendUrl?.trim();
  return trimmed || DEFAULT_BACKEND_URL;
}

function isLocalhostRuntime(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname);
}

function resolveRequestCredentials(backendUrl: string): RequestCredentials {
  if (typeof window === 'undefined') {
    return 'same-origin';
  }

  try {
    const targetUrl = new URL(backendUrl, window.location.origin);
    return targetUrl.origin === window.location.origin ? 'same-origin' : 'omit';
  } catch {
    return 'same-origin';
  }
}

async function isLocalRelayHealthy(): Promise<boolean> {
  try {
    const response = await fetch(LOCAL_RELAY_HEALTH_URL, {
      method: 'GET',
      credentials: 'omit',
      headers: {
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      return false;
    }

    const payload = (await response.json()) as { ok?: boolean } | null;
    return Boolean(payload?.ok);
  } catch {
    return false;
  }
}

async function parseEnvelope<T>(response: Response): Promise<ExocorResolverEnvelope<T> | null> {
  try {
    return (await response.json()) as ExocorResolverEnvelope<T>;
  } catch {
    return null;
  }
}

export class RemoteIntentResolver {
  private readonly backendUrlOverride?: string;
  private readonly debug: boolean;
  private resolvedBackendUrlPromise: Promise<string> | null = null;

  constructor(options: RemoteIntentResolverOptions = {}) {
    const trimmed = options.backendUrl?.trim();
    this.backendUrlOverride = trimmed || undefined;
    this.debug = Boolean(options.debug);
  }

  private async resolveBackendUrl(): Promise<string> {
    if (this.backendUrlOverride) {
      return this.backendUrlOverride;
    }

    if (!this.resolvedBackendUrlPromise) {
      this.resolvedBackendUrlPromise = (async () => {
        if (isLocalhostRuntime() && (await isLocalRelayHealthy())) {
          return LOCAL_RELAY_BACKEND_URL;
        }

        return normalizeBackendUrl(undefined);
      })();
    }

    return this.resolvedBackendUrlPromise;
  }

  private async postJson<T extends ExocorResolverJsonResponse>(
    request: ExocorResolverRequest
  ): Promise<ExocorResolverEnvelope<T> | null> {
    try {
      const backendUrl = await this.resolveBackendUrl();
      const response = await fetch(backendUrl, {
        method: 'POST',
        credentials: resolveRequestCredentials(backendUrl),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify(request)
      });

      const payload = await parseEnvelope<T>(response);
      if (!payload) {
        if (this.debug) {
          // eslint-disable-next-line no-console
          console.warn('[Exocor] Resolver returned an unreadable JSON payload.');
        }
        return null;
      }

      if (!payload.ok && this.debug) {
        // eslint-disable-next-line no-console
        console.warn('[Exocor] Resolver request failed.', payload.error);
      }

      return payload;
    } catch (error) {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.warn('[Exocor] Resolver request failed.', error);
      }
      return null;
    }
  }

  async resolve(input: IntentResolutionInput): Promise<IntentPlan | null> {
    const payload = await this.postJson<{ plan: IntentPlan | null }>({
      operation: 'resolve',
      input
    } satisfies ExocorResolveRequest);

    if (!payload?.ok) {
      return null;
    }

    return payload.data.plan;
  }

  async resolvePreferredToolIntent(
    input: IntentResolutionInput,
    preferredToolId: string,
    preferredReason = ''
  ): Promise<ExocorPreferredToolIntentResult> {
    const payload = await this.postJson<{ result: ExocorPreferredToolIntentResult }>({
      operation: 'preferred_tool_intent',
      input,
      preferredToolId,
      ...(preferredReason ? { preferredReason } : {})
    } satisfies ExocorPreferredToolIntentRequest);

    if (!payload?.ok) {
      return {
        status: 'fallback',
        reason: 'Preferred tool resolution was unavailable.'
      };
    }

    return (
      payload.data.result || {
        status: 'fallback',
        reason: 'Preferred tool resolution returned no result.'
      }
    );
  }

  async resolveWithPreferredToolRetry(
    input: IntentResolutionInput,
    preferredToolId: string,
    preferredReason: string,
    rejectedPlan: IntentPlan
  ): Promise<IntentStep[]> {
    const payload = await this.postJson<{ steps: IntentStep[] }>({
      operation: 'preferred_tool_retry',
      input,
      preferredToolId,
      preferredReason,
      rejectedPlan
    } satisfies ExocorPreferredToolRetryRequest);

    if (!payload?.ok) {
      return [];
    }

    return payload.data.steps || [];
  }

  async resolveForFailedStep(
    input: IntentResolutionInput,
    failedStep: IntentStep,
    failureReason: string
  ): Promise<IntentStep[]> {
    const payload = await this.postJson<{ steps: IntentStep[] }>({
      operation: 'failed_step',
      input,
      failedStep,
      failureReason
    } satisfies ExocorFailedStepRequest);

    if (!payload?.ok) {
      return [];
    }

    return payload.data.steps || [];
  }

  async resolveForNewElements(
    input: IntentResolutionInput,
    newElements: IntentResolutionInput['map']['elements'],
    completedSteps: IntentStep[]
  ): Promise<IntentStep[]> {
    const payload = await this.postJson<{ steps: IntentStep[] }>({
      operation: 'new_elements',
      input,
      newElements,
      completedSteps
    } satisfies ExocorNewElementsRequest);

    if (!payload?.ok) {
      return [];
    }

    return payload.data.steps || [];
  }

  async resolveFollowUp(
    input: IntentResolutionInput,
    completedSteps: IntentStep[],
    instruction: string
  ): Promise<IntentStep[]> {
    const payload = await this.postJson<{ steps: IntentStep[] }>({
      operation: 'follow_up',
      input,
      completedSteps,
      instruction
    } satisfies ExocorFollowUpRequest);

    if (!payload?.ok) {
      return [];
    }

    return payload.data.steps || [];
  }

  async resolveWithContextStreamInternal(
    input: IntentResolutionInput,
    runtimeContext?: Record<string, unknown>,
    callbacks: StreamResolveCallbacks = {}
  ): Promise<ResolvedIntent> {
    try {
      const backendUrl = await this.resolveBackendUrl();
      const response = await fetch(backendUrl, {
        method: 'POST',
        credentials: resolveRequestCredentials(backendUrl),
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson'
        },
        body: JSON.stringify({
          operation: 'initial_stream',
          input,
          runtimeContext
        } satisfies ExocorInitialStreamRequest)
      });

      if (!response.ok || !response.body) {
        const payload = await parseEnvelope<{ message?: string }>(response);
        if (this.debug) {
          // eslint-disable-next-line no-console
          console.warn('[Exocor] Streamed resolver request failed.', payload && !payload.ok ? payload.error : response.statusText);
        }
        return null;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamedResult: ResolvedIntent = null;
      let didEmitPriority = false;

      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

        let newlineIndex = buffer.indexOf('\n');
        while (newlineIndex >= 0) {
          const rawLine = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          if (rawLine) {
            try {
              const parsed = JSON.parse(rawLine) as unknown;
              if (isExocorResolverStreamEvent(parsed)) {
                if (parsed.type === 'step') {
                  if (parsed.resolutionPriority && !didEmitPriority) {
                    callbacks.onResolutionPriority?.(parsed.resolutionPriority);
                    didEmitPriority = true;
                  }
                  callbacks.onStep?.(parsed.step);
                } else if (parsed.type === 'result') {
                  streamedResult = parsed.result;
                  if (
                    !didEmitPriority &&
                    streamedResult?.type === 'dom_steps' &&
                    streamedResult.resolutionPriority
                  ) {
                    callbacks.onResolutionPriority?.(streamedResult.resolutionPriority);
                    didEmitPriority = true;
                  }
                } else if (parsed.type === 'error' && this.debug) {
                  // eslint-disable-next-line no-console
                  console.warn('[Exocor] Streamed resolver error.', parsed.message);
                }
              }
            } catch (error) {
              if (this.debug) {
                // eslint-disable-next-line no-console
                console.warn('[Exocor] Failed to parse streamed resolver event.', error);
              }
            }
          }

          newlineIndex = buffer.indexOf('\n');
        }

        if (done) {
          break;
        }
      }

      return streamedResult;
    } catch (error) {
      if (this.debug) {
        // eslint-disable-next-line no-console
        console.warn('[Exocor] Streamed resolver request failed.', error);
      }
      return null;
    }
  }
}
