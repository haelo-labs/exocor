import type { DOMElementDescriptor, IntentPlan, IntentResolutionInput, IntentStep, ResolvedIntent, ResolutionPriority } from '../types';

export type ExocorResolverOperation =
  | 'initial_stream'
  | 'resolve'
  | 'failed_step'
  | 'new_elements'
  | 'follow_up';

export interface ExocorInitialStreamRequest {
  operation: 'initial_stream';
  input: IntentResolutionInput;
  runtimeContext?: Record<string, unknown>;
}

export interface ExocorResolveRequest {
  operation: 'resolve';
  input: IntentResolutionInput;
}

export interface ExocorFailedStepRequest {
  operation: 'failed_step';
  input: IntentResolutionInput;
  failedStep: IntentStep;
  failureReason: string;
}

export interface ExocorNewElementsRequest {
  operation: 'new_elements';
  input: IntentResolutionInput;
  newElements: DOMElementDescriptor[];
  completedSteps: IntentStep[];
}

export interface ExocorFollowUpRequest {
  operation: 'follow_up';
  input: IntentResolutionInput;
  completedSteps: IntentStep[];
  instruction: string;
}

export type ExocorResolverRequest =
  | ExocorInitialStreamRequest
  | ExocorResolveRequest
  | ExocorFailedStepRequest
  | ExocorNewElementsRequest
  | ExocorFollowUpRequest;

export interface ExocorResolveResponse {
  plan: IntentPlan | null;
}

export interface ExocorStepListResponse {
  steps: IntentStep[];
}

export type ExocorResolverJsonResponse = ExocorResolveResponse | ExocorStepListResponse;

export type ExocorResolverEnvelope<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: string;
    };

export type ExocorResolverStreamEvent =
  | {
      type: 'step';
      step: IntentStep;
      resolutionPriority?: ResolutionPriority;
    }
  | {
      type: 'result';
      result: ResolvedIntent;
    }
  | {
      type: 'error';
      message: string;
    };

export function isExocorResolverStreamEvent(value: unknown): value is ExocorResolverStreamEvent {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const event = value as Record<string, unknown>;
  return event.type === 'step' || event.type === 'result' || event.type === 'error';
}

