import { useSpatialContext } from '../components/SpatialProvider';
import type { GazeState } from '../types';

/** Returns projected gaze cursor position and nearest gaze target selector. */
export function useGaze(): GazeState {
  return useSpatialContext().gaze;
}
