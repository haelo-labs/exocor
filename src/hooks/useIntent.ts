import { useSpatialContext } from '../components/SpatialProvider';
import type { IntentState } from '../types';

/** Returns intent resolution state and unified command execution function. */
export function useIntent(): IntentState {
  return useSpatialContext().intent;
}
