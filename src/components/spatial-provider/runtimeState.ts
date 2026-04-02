import type { DOMCapabilityMap, GazeState, GestureState } from '../../types';

export type VoiceGazeSnapshot = GazeState;

export interface PendingClarificationState {
  question: string;
  baseCommand: string;
  historyEntryId: string;
}

export const emptyMap: DOMCapabilityMap = {
  elements: [],
  routes: [],
  currentRoute: '/',
  currentUrl: '',
  routeParams: {},
  pageTitle: '',
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
  countBadges: [],
  compressed: {
    pageSummary: '',
    currentRoute: '/',
    currentUrl: '',
    routes: [],
    gazeTargetId: null,
    elements: [],
    selectorMap: {},
    tableSummary: '',
    listSummary: '',
    tokenEstimate: 0
  },
  updatedAt: Date.now()
};

export const EMPTY_GAZE_STATE: GazeState = {
  gazeTarget: null,
  gazeX: 0,
  gazeY: 0,
  isCalibrated: false
};

export const EMPTY_GESTURE_STATE: GestureState = {
  gesture: 'none',
  hand: 'unknown',
  confidence: 0
};
