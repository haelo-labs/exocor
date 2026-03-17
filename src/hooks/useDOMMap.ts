import { useSpatialContext } from '../components/SpatialProvider';
import type { DOMMapState } from '../types';

/** Returns discovered interactive DOM capabilities and route map. */
export function useDOMMap(): DOMMapState {
  return useSpatialContext().domMap;
}
