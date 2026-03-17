import { useSpatialContext } from '../components/SpatialProvider';
import type { GestureState } from '../types';

/** Returns latest gesture classification and confidence. */
export function useGesture(): GestureState {
  return useSpatialContext().gesture;
}
