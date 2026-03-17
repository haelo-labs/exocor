import { useSpatialContext } from '../components/SpatialProvider';
import type { VoiceState } from '../types';

/** Returns live voice transcript and listening state. */
export function useVoice(): VoiceState {
  return useSpatialContext().voice;
}
