import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { FaceLandmarker, FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { isSdkUiElement } from '../core/sdkUi';

const WASM_BASE_PATH = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const FACE_MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const HAND_MODEL_PATH =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const NOSE_TIP_INDEX = 1;
const LEFT_EYE_OUTER_INDEX = 33;
const RIGHT_EYE_OUTER_INDEX = 263;
const THUMB_TIP_INDEX = 4;
const INDEX_TIP_INDEX = 8;
const INDEX_MCP_INDEX = 5;
const PINKY_MCP_INDEX = 17;
const WRIST_INDEX = 0;
const CALIBRATION_FRAMES = 40;
const HORIZONTAL_GAIN = 20.4;
const VERTICAL_GAIN = 24.8;
const ROLL_GAIN = 0.12;
const PITCH_GAIN = 0.22;
const CURSOR_SMOOTHING = 0.34;
const GAZE_FREEZE_MS = 220;
const STICKY_RADIUS = 160;
const STICKY_PULL_BASE = 0.22;
const STICKY_PULL_RANGE = 0.4;
const PINCH_DISTANCE_THRESHOLD = 0.045;
const PINCH_RATIO_THRESHOLD = 0.4;
const PINCH_CLICK_COOLDOWN_MS = 650;
const CLICK_MAX_DURATION_MS = 150;
const EARLY_RELEASE_DISTANCE_DELTA = 0.006;
const EARLY_RELEASE_RATIO_DELTA = 0.05;
const ACTIVE_DRAG_RELEASE_DISTANCE_DELTA = 0.025;
const ACTIVE_DRAG_RELEASE_RATIO_DELTA = 0.15;
const DRAG_RELEASE_GRACE_PERIOD_MS = 200;
const PINCH_ZOOM_SENSITIVITY = 3.0;
const SWIPE_HISTORY_WINDOW_MS = 500;
const SWIPE_GESTURE_COOLDOWN_MS = 1000;
const SWIPE_MIN_VELOCITY_PX_PER_MS = 0.5;
const SWIPE_MIN_STRAIGHTNESS = 0.85;
const ESCAPE_SWIPE_MIN_DISTANCE_PX = 150;
const ESCAPE_SWIPE_MAX_DURATION_MS = 400;
const ESCAPE_SWIPE_MIN_ANGLE_DEG = 20;
const ESCAPE_SWIPE_MAX_ANGLE_DEG = 70;
const ESCAPE_SWIPE_CENTER_MARGIN_RATIO = 0.25;
const HISTORY_SWIPE_MIN_DISTANCE_PX = 200;
const HISTORY_SWIPE_MAX_DURATION_MS = 500;
const HORIZONTAL_SWIPE_ANGLE_TOLERANCE_DEG = 30;
const PRIMARY_POINTER_ID = 1;
const INTERACTIVE_SELECTOR =
  [
    'button',
    'a[href]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'label',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="menuitem"]',
    '[role="tab"]',
    '[role="option"]',
    '[role="combobox"]',
    '[role="listbox"]',
    '[role="textbox"]',
    '[role="slider"]',
    '[role="spinbutton"]',
    '[aria-haspopup]',
    '[contenteditable=""]',
    '[contenteditable="true"]',
    '[tabindex]:not([tabindex="-1"])',
    '.task-card',
    '.nav-item',
    '.sub-item',
    '.icon-btn',
    '.btn',
    '.mini-btn',
    '.add-task-card',
    '.new-status-btn'
  ].join(', ');
const NATIVE_ACTIVATION_SELECTOR = 'button, a[href], input:not([type="hidden"]), select, textarea, label, summary';
const ROLE_BUTTON_SELECTOR = '[role="button"]';
const HOVER_TARGET_CLASS = 'face-hover-target';
const HOVER_TARGET_CLICK_CLASS = 'face-hover-target-click';

function compactText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

type CursorPosition = { x: number; y: number };
type NeutralState = {
  noseX: number;
  noseY: number;
  roll: number;
  pitch: number;
  ready: boolean;
};
type CalibrationState = {
  count: number;
  noseX: number;
  noseY: number;
  roll: number;
  pitch: number;
};
type Point = { x: number; y: number };
type FaceLandmark = { x: number; y: number; z?: number };
type HandednessCategory = { categoryName?: string; displayName?: string };
type HandednessLabel = 'Left' | 'Right';
type InteractiveTarget = {
  centerX: number;
  centerY: number;
  distance: number;
  element: HTMLElement;
};
type HoverDispatchTarget = Element | null;
type SyntheticPointerEventName =
  | 'pointerdown'
  | 'pointerenter'
  | 'pointerleave'
  | 'pointermove'
  | 'pointerout'
  | 'pointerover'
  | 'pointerup';
type SyntheticMouseEventName =
  | 'click'
  | 'mousedown'
  | 'mouseenter'
  | 'mouseleave'
  | 'mousemove'
  | 'mouseout'
  | 'mouseover'
  | 'mouseup';
type SyntheticCoordinates = {
  clientX: number;
  clientY: number;
  screenX: number;
  screenY: number;
  pageX: number;
  pageY: number;
};
type EventDispatchOptions = {
  bubbles?: boolean;
  button?: number;
  buttons?: number;
  cancelable?: boolean;
  ctrlKey?: boolean;
  deltaMode?: number;
  deltaY?: number;
  relatedTarget?: EventTarget | null;
};
type HandGestureSample = {
  gesturePoint: Point;
  handSpan: number;
  handedness: HandednessLabel | null;
  indexTip: FaceLandmark;
  pinchDistance: number;
  pinchRatio: number;
  pinching: boolean;
  screenPoint: Point;
  thumbTip: FaceLandmark;
};
export type PinchDragPhase = 'start' | 'move' | 'end' | 'cancel';
export type PinchDragSample = {
  currentTarget: Element | null;
  phase: PinchDragPhase;
  sourceTarget: Element | null;
  x: number;
  y: number;
};
type ActivePinchGesture = {
  activationTarget: HTMLElement | null;
  currentTarget: HoverDispatchTarget;
  dragCommittedAtMs: number | null;
  hasDragged: boolean;
  currentDragPoint: CursorPosition;
  hoverStyleTarget: HTMLElement | null;
  leafTarget: HoverDispatchTarget;
  minimumPinchDistance: number;
  minimumPinchRatio: number;
  pressedAtMs: number;
  startCursorPoint: CursorPosition;
  startHandPoint: Point;
};
type ZoomGestureState = {
  active: boolean;
  previousDistance: number | null;
};
type SwipeGestureHistorySample = {
  atMs: number;
  handedness: HandednessLabel | null;
  point: Point;
};
type SwipeGestureName = 'escape' | 'back' | 'forward';
type SwipeGestureMetrics = {
  angleDeg: number;
  distance: number;
  durationMs: number;
  dx: number;
  dy: number;
  endPoint: Point;
  pathLength: number;
  startPoint: Point;
  straightness: number;
  velocityPxPerMs: number;
};

type FaceLandmarkerInstance = {
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => {
    faceLandmarks: FaceLandmark[][];
  };
  close: () => void;
};

type HandLandmarkerInstance = {
  detectForVideo: (video: HTMLVideoElement, timestampMs: number) => {
    landmarks: FaceLandmark[][];
    handedness: HandednessCategory[][];
    handednesses?: HandednessCategory[][];
  };
  close: () => void;
};

export interface FaceNoseCursorOptions {
  gestureEnabled?: boolean;
  onGaze?: (sample: { x: number; y: number; target: HTMLElement | null; isCalibrated: boolean }) => void;
  onPinchDrag?: (sample: PinchDragSample) => void;
  onPinchState?: (sample: { isPinching: boolean }) => void;
  onPinchClick?: (sample: { target: Element | null; x: number; y: number }) => void;
}

export interface FaceNoseCursorController {
  videoRef: RefObject<HTMLVideoElement>;
  cursorRef: RefObject<HTMLDivElement>;
  dragCursorRef: RefObject<HTMLDivElement>;
  isTracking: boolean;
  isPinching: boolean;
  isDragging: boolean;
  isLoading: boolean;
  showCursor: boolean;
  status: string;
  error: string;
  startTracking: () => Promise<void>;
  stopTracking: () => void;
  recalibrate: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, alpha: number): number {
  return start + (end - start) * alpha;
}

function buildNeutralSample(landmarks: FaceLandmark[]): { noseX: number; noseY: number; pitch: number; roll: number } | null {
  const nose = landmarks[NOSE_TIP_INDEX];
  const leftEye = landmarks[LEFT_EYE_OUTER_INDEX];
  const rightEye = landmarks[RIGHT_EYE_OUTER_INDEX];

  if (!nose || !leftEye || !rightEye) {
    return null;
  }

  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
  const eyeCenterY = (leftEye.y + rightEye.y) / 2;

  return {
    noseX: nose.x,
    noseY: nose.y,
    pitch: nose.y - eyeCenterY,
    roll
  };
}

function calculateNoseTrackingOffsets(
  sample: { noseX: number; noseY: number; pitch: number; roll: number },
  neutral: NeutralState
): Point {
  const horizontalOffset = neutral.ready
    ? neutral.noseX - sample.noseX + (neutral.roll - sample.roll) * ROLL_GAIN
    : 0;
  const verticalOffset = neutral.ready
    ? sample.noseY - neutral.noseY + (sample.pitch - neutral.pitch) * PITCH_GAIN
    : 0;
  return {
    x: horizontalOffset,
    y: verticalOffset
  };
}

function findPointTarget(x: number, y: number): HoverDispatchTarget {
  const leaf = document.elementFromPoint(x, y);
  if (!leaf || leaf.closest('[data-face-ignore="true"]')) {
    return null;
  }
  return leaf;
}

function findNearestInteractiveTarget(x: number, y: number, radius = STICKY_RADIUS): InteractiveTarget | null {
  const candidates = document.querySelectorAll(INTERACTIVE_SELECTOR);
  let nearest: InteractiveTarget | null = null;
  let nearestDistance = radius;

  for (const candidate of candidates) {
    if (!(candidate instanceof HTMLElement)) {
      continue;
    }
    if (candidate.closest('[data-face-ignore="true"]')) {
      continue;
    }

    const rect = candidate.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) {
      continue;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const distance = Math.hypot(centerX - x, centerY - y);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = {
        centerX,
        centerY,
        distance,
        element: candidate
      };
    }
  }

  return nearest;
}

function findInteractiveAncestor(target: HoverDispatchTarget): HTMLElement | null {
  const interactive = target?.closest(INTERACTIVE_SELECTOR) ?? null;
  return interactive instanceof HTMLElement ? interactive : null;
}

function findActivationTarget(target: HoverDispatchTarget): HTMLElement | null {
  const nativeTarget = target?.closest(NATIVE_ACTIVATION_SELECTOR) ?? null;
  if (nativeTarget instanceof HTMLElement) {
    return nativeTarget;
  }

  const roleTarget = target?.closest(ROLE_BUTTON_SELECTOR) ?? null;
  return roleTarget instanceof HTMLElement ? roleTarget : null;
}

function focusElement(target: HTMLElement): void {
  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
}

function activateElement(target: HTMLElement): HTMLElement {
  focusElement(target);

  const pickerTarget = target as HTMLElement & { showPicker?: () => void };
  if (typeof pickerTarget.showPicker === 'function') {
    try {
      pickerTarget.showPicker();
      return target;
    } catch {
      // Fall back to click when the browser rejects programmatic picker opening.
    }
  }

  target.click();
  return target;
}

function applyStickySnap(point: CursorPosition): CursorPosition {
  const stickyTarget = findNearestInteractiveTarget(point.x, point.y);
  if (!stickyTarget) {
    return point;
  }

  const stickiness = STICKY_PULL_BASE + (1 - stickyTarget.distance / STICKY_RADIUS) * STICKY_PULL_RANGE;
  return {
    x: lerp(point.x, stickyTarget.centerX, stickiness),
    y: lerp(point.y, stickyTarget.centerY, stickiness)
  };
}

function calculateDragCursorPoint(startCursorPoint: CursorPosition, startHandPoint: Point, currentHandPoint: Point): CursorPosition {
  return {
    x: clamp(startCursorPoint.x + (currentHandPoint.x - startHandPoint.x), 0, window.innerWidth),
    y: clamp(startCursorPoint.y + (currentHandPoint.y - startHandPoint.y), 0, window.innerHeight)
  };
}

function pruneSwipeGestureHistory(
  history: SwipeGestureHistorySample[],
  now: number,
  windowMs = SWIPE_HISTORY_WINDOW_MS
): SwipeGestureHistorySample[] {
  const cutoffMs = now - windowMs;
  return history.filter((sample) => sample.atMs >= cutoffMs);
}

function updateSwipeGestureHistory(params: {
  history: SwipeGestureHistorySample[];
  now: number;
  sample: SwipeGestureHistorySample | null;
}): SwipeGestureHistorySample[] {
  const prunedHistory = pruneSwipeGestureHistory(params.history, params.now);
  if (!params.sample) {
    return [];
  }

  const previousSample = prunedHistory[prunedHistory.length - 1];
  if (previousSample && previousSample.handedness !== params.sample.handedness) {
    return [params.sample];
  }

  return [...prunedHistory, params.sample];
}

function calculateSwipeAngleDeg(dx: number, dy: number): number {
  return (Math.atan2(-dy, dx) * 180) / Math.PI;
}

function normalizeAngleDeltaDeg(angleDeg: number, targetDeg: number): number {
  return ((angleDeg - targetDeg + 540) % 360) - 180;
}

function calculateSwipeGestureMetrics(history: SwipeGestureHistorySample[]): SwipeGestureMetrics | null {
  if (history.length < 2) {
    return null;
  }

  const startSample = history[0];
  const endSample = history[history.length - 1];
  const dx = endSample.point.x - startSample.point.x;
  const dy = endSample.point.y - startSample.point.y;
  const distance = Math.hypot(dx, dy);
  const durationMs = endSample.atMs - startSample.atMs;
  let pathLength = 0;

  for (let index = 1; index < history.length; index += 1) {
    const previous = history[index - 1];
    const current = history[index];
    pathLength += Math.hypot(current.point.x - previous.point.x, current.point.y - previous.point.y);
  }

  const velocityPxPerMs = durationMs > 0 ? distance / durationMs : 0;
  const straightness = pathLength > 0 ? distance / pathLength : 0;

  return {
    angleDeg: calculateSwipeAngleDeg(dx, dy),
    distance,
    durationMs,
    dx,
    dy,
    endPoint: endSample.point,
    pathLength,
    startPoint: startSample.point,
    straightness,
    velocityPxPerMs
  };
}

function isPointInsideEscapeCenterZone(point: Point, viewportWidth: number, viewportHeight: number): boolean {
  const minX = viewportWidth * ESCAPE_SWIPE_CENTER_MARGIN_RATIO;
  const maxX = viewportWidth * (1 - ESCAPE_SWIPE_CENTER_MARGIN_RATIO);
  const minY = viewportHeight * ESCAPE_SWIPE_CENTER_MARGIN_RATIO;
  const maxY = viewportHeight * (1 - ESCAPE_SWIPE_CENTER_MARGIN_RATIO);

  return point.x >= minX && point.x <= maxX && point.y >= minY && point.y <= maxY;
}

function detectOpenHandSwipeGesture(
  history: SwipeGestureHistorySample[],
  params: {
    minStraightness?: number;
    minVelocityPxPerMs?: number;
    viewportHeight: number;
    viewportWidth: number;
  }
): SwipeGestureName | null {
  const metrics = calculateSwipeGestureMetrics(history);
  if (!metrics || metrics.durationMs <= 0) {
    return null;
  }

  const minVelocityPxPerMs = params.minVelocityPxPerMs ?? SWIPE_MIN_VELOCITY_PX_PER_MS;
  const minStraightness = params.minStraightness ?? SWIPE_MIN_STRAIGHTNESS;
  if (metrics.velocityPxPerMs < minVelocityPxPerMs || metrics.straightness < minStraightness) {
    return null;
  }

  if (
    metrics.distance >= ESCAPE_SWIPE_MIN_DISTANCE_PX &&
    metrics.durationMs <= ESCAPE_SWIPE_MAX_DURATION_MS &&
    metrics.angleDeg >= ESCAPE_SWIPE_MIN_ANGLE_DEG &&
    metrics.angleDeg <= ESCAPE_SWIPE_MAX_ANGLE_DEG &&
    isPointInsideEscapeCenterZone(metrics.startPoint, params.viewportWidth, params.viewportHeight)
  ) {
    return 'escape';
  }

  if (
    metrics.distance >= HISTORY_SWIPE_MIN_DISTANCE_PX &&
    metrics.durationMs <= HISTORY_SWIPE_MAX_DURATION_MS &&
    Math.abs(normalizeAngleDeltaDeg(metrics.angleDeg, 180)) <= HORIZONTAL_SWIPE_ANGLE_TOLERANCE_DEG
  ) {
    return 'back';
  }

  if (
    metrics.distance >= HISTORY_SWIPE_MIN_DISTANCE_PX &&
    metrics.durationMs <= HISTORY_SWIPE_MAX_DURATION_MS &&
    Math.abs(normalizeAngleDeltaDeg(metrics.angleDeg, 0)) <= HORIZONTAL_SWIPE_ANGLE_TOLERANCE_DEG
  ) {
    return 'forward';
  }

  return null;
}

function dispatchOpenHandSwipeGesture(gesture: SwipeGestureName): void {
  if (gesture === 'escape') {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return;
  }

  if (gesture === 'back') {
    window.history.back();
    return;
  }

  window.history.forward();
}

function isSwipeGestureCoolingDown(lastGestureAtMs: number, now: number, cooldownMs = SWIPE_GESTURE_COOLDOWN_MS): boolean {
  return now - lastGestureAtMs < cooldownMs;
}

function shouldTrackOpenHandSwipe(params: {
  anyPinching: boolean;
  hasActivePinchGesture: boolean;
  isCalibrated: boolean;
  lastSwipeGestureAtMs: number;
  now: number;
  openHandCount: number;
}): boolean {
  return (
    params.isCalibrated &&
    !params.anyPinching &&
    params.openHandCount === 1 &&
    !params.hasActivePinchGesture &&
    !isSwipeGestureCoolingDown(params.lastSwipeGestureAtMs, params.now)
  );
}

function shouldReleasePinchGesture(
  gesture: ActivePinchGesture,
  sample: Pick<HandGestureSample, 'pinchDistance' | 'pinchRatio'> & { now?: number }
): boolean {
  if (gesture.hasDragged && gesture.dragCommittedAtMs != null && sample.now != null) {
    if (sample.now - gesture.dragCommittedAtMs < DRAG_RELEASE_GRACE_PERIOD_MS) {
      return false;
    }
  }

  const distanceDelta = gesture.hasDragged ? ACTIVE_DRAG_RELEASE_DISTANCE_DELTA : EARLY_RELEASE_DISTANCE_DELTA;
  const ratioDelta = gesture.hasDragged ? ACTIVE_DRAG_RELEASE_RATIO_DELTA : EARLY_RELEASE_RATIO_DELTA;

  return (
    sample.pinchDistance >= gesture.minimumPinchDistance + distanceDelta ||
    sample.pinchRatio >= gesture.minimumPinchRatio + ratioDelta
  );
}

function hasTimedOutForDrag(gesture: ActivePinchGesture, timestampMs: number): boolean {
  return timestampMs - gesture.pressedAtMs >= CLICK_MAX_DURATION_MS;
}

function setCursorPosition(target: HTMLDivElement | null, point: CursorPosition): void {
  if (!target) {
    return;
  }
  target.style.transform = `translate3d(${point.x}px, ${point.y}px, 0)`;
}

function resolveHandedness(handedness: HandednessCategory[] | undefined): HandednessLabel | null {
  const label = handedness?.[0]?.categoryName ?? handedness?.[0]?.displayName ?? '';
  if (label === 'Left' || label === 'Right') {
    return label;
  }
  return null;
}

function selectPinchingHandsForZoom(handSamples: HandGestureSample[]): { left: HandGestureSample; right: HandGestureSample } | null {
  const left = handSamples.find((sample) => sample.pinching && sample.handedness === 'Left') ?? null;
  const right = handSamples.find((sample) => sample.pinching && sample.handedness === 'Right') ?? null;
  if (!left || !right) {
    return null;
  }
  return { left, right };
}

function isValidGazeHoverTarget(target: HTMLElement | null | undefined): target is HTMLElement {
  if (!target) {
    return false;
  }

  const rawTagName = (target as unknown as { tagName?: unknown }).tagName;
  const rawText = (target as unknown as { textContent?: unknown }).textContent;
  const tagName = typeof rawTagName === 'string' ? compactText(rawTagName) : '';
  const text = typeof rawText === 'string' ? compactText(rawText) : '';
  if (!tagName && !text) {
    return false;
  }

  return !isSdkUiElement(target);
}

function toViewportPoint(point: FaceLandmark): Point {
  return {
    x: clamp(point.x * window.innerWidth, 0, window.innerWidth),
    y: clamp(point.y * window.innerHeight, 0, window.innerHeight)
  };
}

function createSyntheticCoordinates(x: number, y: number): SyntheticCoordinates {
  const clientX = x;
  const clientY = y;
  const pageX = x + window.scrollX;
  const pageY = y + window.scrollY;
  return {
    clientX,
    clientY,
    pageX,
    pageY,
    screenX: (typeof window.screenX === 'number' ? window.screenX : 0) + clientX,
    screenY: (typeof window.screenY === 'number' ? window.screenY : 0) + clientY
  };
}

function applyCoordinateOverrides<T extends Event>(event: T, coordinates: SyntheticCoordinates): T {
  try {
    Object.defineProperties(event, {
      pageX: { configurable: true, enumerable: true, value: coordinates.pageX },
      pageY: { configurable: true, enumerable: true, value: coordinates.pageY },
      x: { configurable: true, enumerable: true, value: coordinates.clientX },
      y: { configurable: true, enumerable: true, value: coordinates.clientY }
    });
  } catch {
    return event;
  }
  return event;
}

function getEventView(target: HoverDispatchTarget): Window & typeof globalThis {
  return (target?.ownerDocument?.defaultView ?? window) as Window & typeof globalThis;
}

function dispatchSyntheticMouseEvent(
  target: HoverDispatchTarget,
  eventName: SyntheticMouseEventName,
  coordinates: SyntheticCoordinates,
  options: EventDispatchOptions = {}
): void {
  if (!target) {
    return;
  }

  const view = getEventView(target);
  const event = new view.MouseEvent(eventName, {
    bubbles: options.bubbles ?? true,
    button: options.button ?? 0,
    buttons: options.buttons ?? 0,
    cancelable: options.cancelable ?? true,
    clientX: coordinates.clientX,
    clientY: coordinates.clientY,
    composed: true,
    ctrlKey: options.ctrlKey ?? false,
    relatedTarget: options.relatedTarget ?? null,
    screenX: coordinates.screenX,
    screenY: coordinates.screenY
  });

  target.dispatchEvent(applyCoordinateOverrides(event, coordinates));
}

function dispatchSyntheticPointerEvent(
  target: HoverDispatchTarget,
  eventName: SyntheticPointerEventName,
  coordinates: SyntheticCoordinates,
  options: EventDispatchOptions = {}
): void {
  if (!target) {
    return;
  }

  const view = getEventView(target);
  const PointerEventCtor = view.PointerEvent;
  const baseInit = {
    bubbles: options.bubbles ?? true,
    button: options.button ?? 0,
    buttons: options.buttons ?? 0,
    cancelable: options.cancelable ?? true,
    clientX: coordinates.clientX,
    clientY: coordinates.clientY,
    composed: true,
    ctrlKey: options.ctrlKey ?? false,
    isPrimary: true,
    pointerId: PRIMARY_POINTER_ID,
    pointerType: 'mouse',
    relatedTarget: options.relatedTarget ?? null,
    screenX: coordinates.screenX,
    screenY: coordinates.screenY
  };

  const event =
    typeof PointerEventCtor === 'function'
      ? new PointerEventCtor(eventName, baseInit)
      : new view.MouseEvent(eventName, baseInit);

  target.dispatchEvent(applyCoordinateOverrides(event, coordinates));
}

function dispatchSyntheticWheelEvent(
  target: HoverDispatchTarget,
  coordinates: SyntheticCoordinates,
  options: EventDispatchOptions
): void {
  if (!target) {
    return;
  }

  const view = getEventView(target);
  const event = new view.WheelEvent('wheel', {
    bubbles: options.bubbles ?? true,
    button: options.button ?? 0,
    buttons: options.buttons ?? 0,
    cancelable: options.cancelable ?? true,
    clientX: coordinates.clientX,
    clientY: coordinates.clientY,
    composed: true,
    ctrlKey: options.ctrlKey ?? false,
    deltaMode: options.deltaMode ?? 0,
    deltaY: options.deltaY ?? 0,
    relatedTarget: options.relatedTarget ?? null,
    screenX: coordinates.screenX,
    screenY: coordinates.screenY
  });

  target.dispatchEvent(applyCoordinateOverrides(event, coordinates));
}

function dispatchHoverTransition(
  previousTarget: HoverDispatchTarget,
  nextTarget: HoverDispatchTarget,
  coordinates: SyntheticCoordinates,
  isPressed: boolean
): HoverDispatchTarget {
  const buttons = isPressed ? 1 : 0;

  if (previousTarget && previousTarget !== nextTarget) {
    dispatchSyntheticPointerEvent(previousTarget, 'pointerleave', coordinates, {
      bubbles: false,
      buttons,
      cancelable: false,
      relatedTarget: nextTarget
    });
    dispatchSyntheticMouseEvent(previousTarget, 'mouseleave', coordinates, {
      bubbles: false,
      buttons,
      cancelable: false,
      relatedTarget: nextTarget
    });
    dispatchSyntheticPointerEvent(previousTarget, 'pointerout', coordinates, {
      bubbles: true,
      buttons,
      relatedTarget: nextTarget
    });
    dispatchSyntheticMouseEvent(previousTarget, 'mouseout', coordinates, {
      bubbles: true,
      buttons,
      relatedTarget: nextTarget
    });
  }

  if (!nextTarget) {
    return null;
  }

  if (previousTarget !== nextTarget) {
    dispatchSyntheticPointerEvent(nextTarget, 'pointerenter', coordinates, {
      bubbles: false,
      buttons,
      cancelable: false,
      relatedTarget: previousTarget
    });
    dispatchSyntheticMouseEvent(nextTarget, 'mouseenter', coordinates, {
      bubbles: false,
      buttons,
      cancelable: false,
      relatedTarget: previousTarget
    });
    dispatchSyntheticPointerEvent(nextTarget, 'pointerover', coordinates, {
      bubbles: true,
      buttons,
      relatedTarget: previousTarget
    });
    dispatchSyntheticMouseEvent(nextTarget, 'mouseover', coordinates, {
      bubbles: true,
      buttons,
      relatedTarget: previousTarget
    });
  }

  dispatchSyntheticPointerEvent(nextTarget, 'pointermove', coordinates, { bubbles: true, buttons });
  dispatchSyntheticMouseEvent(nextTarget, 'mousemove', coordinates, { bubbles: true, buttons });
  return nextTarget;
}

function dispatchPressStartSequence(target: HoverDispatchTarget, coordinates: SyntheticCoordinates): void {
  if (!target) {
    return;
  }

  dispatchSyntheticPointerEvent(target, 'pointerdown', coordinates, { bubbles: true, buttons: 1 });
  dispatchSyntheticMouseEvent(target, 'mousedown', coordinates, { bubbles: true, buttons: 1 });
}

function dispatchPressMoveSequence(target: HoverDispatchTarget, coordinates: SyntheticCoordinates): void {
  if (!target) {
    return;
  }

  dispatchSyntheticPointerEvent(target, 'pointermove', coordinates, { bubbles: true, buttons: 1 });
  dispatchSyntheticMouseEvent(target, 'mousemove', coordinates, { bubbles: true, buttons: 1 });
}

function dispatchPressEndSequence(target: HoverDispatchTarget, coordinates: SyntheticCoordinates): void {
  if (!target) {
    return;
  }

  dispatchSyntheticPointerEvent(target, 'pointerup', coordinates, { bubbles: true, buttons: 0 });
  dispatchSyntheticMouseEvent(target, 'mouseup', coordinates, { bubbles: true, buttons: 0 });
}

function dispatchSyntheticClick(target: HoverDispatchTarget, coordinates: SyntheticCoordinates): void {
  if (!target) {
    return;
  }

  dispatchSyntheticMouseEvent(target, 'click', coordinates, { bubbles: true, buttons: 0 });
}

function emitPinchDragSample(
  callback: ((sample: PinchDragSample) => void) | undefined,
  gesture: ActivePinchGesture,
  phase: PinchDragPhase
): void {
  if (!callback || !gesture.hasDragged) {
    return;
  }

  callback({
    currentTarget: gesture.currentTarget,
    phase,
    sourceTarget: gesture.leafTarget,
    x: gesture.currentDragPoint.x,
    y: gesture.currentDragPoint.y
  });
}

function createActivePinchGesture(params: {
  activationTarget: HTMLElement | null;
  cursorPoint: CursorPosition;
  handPoint: Point;
  hoverStyleTarget: HTMLElement | null;
  leafTarget: HoverDispatchTarget;
  pinchDistance?: number;
  pinchRatio?: number;
  pressedAtMs?: number;
}): ActivePinchGesture {
  const gesture: ActivePinchGesture = {
    activationTarget: params.activationTarget,
    currentDragPoint: {
      x: params.cursorPoint.x,
      y: params.cursorPoint.y
    },
    currentTarget: params.leafTarget,
    dragCommittedAtMs: null,
    hasDragged: false,
    hoverStyleTarget: params.hoverStyleTarget,
    leafTarget: params.leafTarget,
    minimumPinchDistance: params.pinchDistance ?? 0,
    minimumPinchRatio: params.pinchRatio ?? 0,
    pressedAtMs: params.pressedAtMs ?? performance.now(),
    startCursorPoint: {
      x: params.cursorPoint.x,
      y: params.cursorPoint.y
    },
    startHandPoint: {
      x: params.handPoint.x,
      y: params.handPoint.y
    }
  };

  dispatchPressStartSequence(params.leafTarget, createSyntheticCoordinates(params.cursorPoint.x, params.cursorPoint.y));
  return gesture;
}

function updateActivePinchGesture(
  gesture: ActivePinchGesture,
  params: {
    dragTarget?: HoverDispatchTarget;
    handPoint: Point;
    now: number;
    onPinchDrag?: (sample: PinchDragSample) => void;
    pinchDistance?: number;
    pinchRatio?: number;
  }
): ActivePinchGesture {
  if (typeof params.pinchDistance === 'number') {
    gesture.minimumPinchDistance = Math.min(gesture.minimumPinchDistance, params.pinchDistance);
  }
  if (typeof params.pinchRatio === 'number') {
    gesture.minimumPinchRatio = Math.min(gesture.minimumPinchRatio, params.pinchRatio);
  }

  const nextDragPoint = calculateDragCursorPoint(gesture.startCursorPoint, gesture.startHandPoint, params.handPoint);
  const shouldDrag = hasTimedOutForDrag(gesture, params.now);
  const wasDragging = gesture.hasDragged;

  if (!gesture.hasDragged && shouldDrag) {
    gesture.hasDragged = true;
    gesture.dragCommittedAtMs = params.now;
  }

  gesture.currentDragPoint = gesture.hasDragged
    ? nextDragPoint
    : {
        x: gesture.startCursorPoint.x,
        y: gesture.startCursorPoint.y
      };

  if (gesture.hasDragged) {
    const coordinates = createSyntheticCoordinates(gesture.currentDragPoint.x, gesture.currentDragPoint.y);
    gesture.currentTarget = dispatchHoverTransition(
      gesture.currentTarget,
      params.dragTarget ?? gesture.currentTarget,
      coordinates,
      true
    );
    gesture.hoverStyleTarget = findInteractiveAncestor(gesture.currentTarget);
    emitPinchDragSample(params.onPinchDrag, gesture, wasDragging ? 'move' : 'start');
  } else {
    gesture.currentTarget = gesture.leafTarget;
  }

  return gesture;
}

function finishActivePinchGesture(params: {
  gesture: ActivePinchGesture | null;
  mode: 'cancel' | 'release';
  releaseLeafTarget: HoverDispatchTarget;
}): Element | null {
  const { gesture, mode, releaseLeafTarget } = params;
  if (!gesture) {
    return null;
  }

  const releasePoint = gesture.hasDragged ? gesture.currentDragPoint : gesture.startCursorPoint;
  const coordinates = createSyntheticCoordinates(releasePoint.x, releasePoint.y);
  dispatchPressEndSequence(gesture.hasDragged ? gesture.currentTarget : gesture.leafTarget, coordinates);

  if (mode === 'cancel' || gesture.hasDragged) {
    return null;
  }

  const releaseActivationTarget = findActivationTarget(releaseLeafTarget);
  if (gesture.activationTarget) {
    if (releaseActivationTarget === gesture.activationTarget) {
      return activateElement(gesture.activationTarget);
    }
    return null;
  }

  dispatchSyntheticClick(gesture.leafTarget, coordinates);
  return gesture.leafTarget;
}

function buildHandGestureSample(
  landmarks: FaceLandmark[],
  handedness: HandednessCategory[] | undefined
): HandGestureSample | null {
  const wrist = landmarks[WRIST_INDEX];
  const thumbTip = landmarks[THUMB_TIP_INDEX];
  const indexTip = landmarks[INDEX_TIP_INDEX];
  const indexMcp = landmarks[INDEX_MCP_INDEX];
  const pinkyMcp = landmarks[PINKY_MCP_INDEX];

  if (!wrist || !thumbTip || !indexTip || !indexMcp || !pinkyMcp) {
    return null;
  }

  const pinchDistance = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
  const handSpan = Math.max(Math.hypot(indexMcp.x - pinkyMcp.x, indexMcp.y - pinkyMcp.y), 0.0001);
  const pinchRatio = pinchDistance / handSpan;

  return {
    gesturePoint: toViewportPoint({
      x: (wrist.x + indexMcp.x + pinkyMcp.x) / 3,
      y: (wrist.y + indexMcp.y + pinkyMcp.y) / 3
    }),
    handSpan,
    handedness: resolveHandedness(handedness),
    indexTip,
    pinchDistance,
    pinchRatio,
    pinching: pinchDistance < PINCH_DISTANCE_THRESHOLD || pinchRatio < PINCH_RATIO_THRESHOLD,
    screenPoint: toViewportPoint(indexTip),
    thumbTip
  };
}

function mirrorHoverStyles(): void {
  const styleId = 'exocor-mirror';
  if (document.getElementById(styleId)) {
    return;
  }

  // Synthetic mouse events do not trigger native CSS :hover, so we mirror those
  // rules onto a class that follows the current gaze hit target.
  const rules: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      for (const rule of Array.from(sheet.cssRules)) {
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(':hover')) {
          const mirrored = rule.selectorText.replace(/:hover/g, '.face-hover-target');
          rules.push(`${mirrored} { ${rule.style.cssText} }`);
        }
      }
    } catch {
      continue;
    }
  }

  // eslint-disable-next-line no-console
  console.log('[Exocor] Mirrored hover rules:', rules.length);

  const fallbackRule = `.face-hover-target {
  outline: 2px solid rgba(0, 0, 0, 0.9) !important;
  outline-offset: 3px !important;
  border-radius: 6px !important;
  box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.15) !important;
}`;

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `${rules.join('\n')}\n${fallbackRule}`;
  document.head.appendChild(style);
}

export function useFaceNoseCursor(options: FaceNoseCursorOptions = {}): FaceNoseCursorController {
  const gestureEnabled = options.gestureEnabled !== false;
  const videoRef = useRef<HTMLVideoElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const dragCursorRef = useRef<HTMLDivElement>(null);
  const landmarkerRef = useRef<FaceLandmarkerInstance | null>(null);
  const handLandmarkerRef = useRef<HandLandmarkerInstance | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const isTrackingRef = useRef(false);
  const isPinchingRef = useRef(false);
  const lastPinchClickRef = useRef(0);
  const lastSwipeGestureAtMsRef = useRef(-Infinity);
  const lastVideoTimeRef = useRef(-1);
  const hoveredElementRef = useRef<HTMLElement | null>(null);
  const hoverDispatchTargetRef = useRef<HoverDispatchTarget>(null);
  const pointTargetRef = useRef<HoverDispatchTarget>(null);
  const pinchPressTargetRef = useRef<HTMLElement | null>(null);
  const activePinchGestureRef = useRef<ActivePinchGesture | null>(null);
  const swipeHistoryRef = useRef<SwipeGestureHistorySample[]>([]);
  const zoomGestureRef = useRef<ZoomGestureState>({ active: false, previousDistance: null });
  const suppressSinglePinchUntilReleaseRef = useRef(false);
  const neutralRef = useRef<NeutralState>({
    noseX: 0.5,
    noseY: 0.5,
    roll: 0,
    pitch: 0,
    ready: false
  });
  const calibrationRef = useRef<CalibrationState>({
    count: 0,
    noseX: 0,
    noseY: 0,
    roll: 0,
    pitch: 0
  });
  const smoothedCursorRef = useRef<CursorPosition>({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2
  });
  const lastValidCursorRef = useRef<CursorPosition>({
    x: window.innerWidth / 2,
    y: window.innerHeight / 2
  });
  const lastValidGazeTimestampRef = useRef(0);
  const missingFramesRef = useRef(0);

  const [isTracking, setIsTracking] = useState(false);
  const [isPinching, setIsPinching] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showCursor, setShowCursor] = useState(false);
  const [status, setStatus] = useState('Idle');
  const [error, setError] = useState('');

  const clearHoveredTarget = useCallback(() => {
    if (hoveredElementRef.current) {
      hoveredElementRef.current.classList.remove(HOVER_TARGET_CLASS);
      hoveredElementRef.current = null;
    }
  }, []);

  const clearHoverDispatchTarget = useCallback(() => {
    hoverDispatchTargetRef.current = dispatchHoverTransition(
      hoverDispatchTargetRef.current,
      null,
      createSyntheticCoordinates(smoothedCursorRef.current.x, smoothedCursorRef.current.y),
      false
    );
    pointTargetRef.current = null;
  }, []);

  const clearPinchPressTarget = useCallback(() => {
    if (pinchPressTargetRef.current) {
      pinchPressTargetRef.current.classList.remove(HOVER_TARGET_CLICK_CLASS);
      pinchPressTargetRef.current = null;
    }
  }, []);

  const setHoveredElement = useCallback(
    (next: HTMLElement | null) => {
      if (!isValidGazeHoverTarget(next)) {
        return;
      }
      if (next === hoveredElementRef.current) {
        return;
      }
      // eslint-disable-next-line no-console
      console.log('[Exocor] Hover target:', next.tagName, next.textContent?.slice(0, 20));
      clearHoveredTarget();
      next.classList.add(HOVER_TARGET_CLASS);
      hoveredElementRef.current = next;
    },
    [clearHoveredTarget]
  );

  const setPinchPressTarget = useCallback(
    (target: HTMLElement | null) => {
      if (pinchPressTargetRef.current === target) {
        return;
      }

      clearPinchPressTarget();
      if (!target) {
        return;
      }

      target.classList.remove(HOVER_TARGET_CLICK_CLASS);
      // Force reflow so we always replay press animation on rapid re-pinches.
      void target.offsetWidth;
      target.classList.add(HOVER_TARGET_CLICK_CLASS);
      pinchPressTargetRef.current = target;
    },
    [clearPinchPressTarget]
  );

  const updateStatus = useCallback((nextStatus: string) => {
    setStatus((prev) => (prev === nextStatus ? prev : nextStatus));
  }, []);

  const resetZoomGesture = useCallback(() => {
    zoomGestureRef.current = { active: false, previousDistance: null };
  }, []);

  const resetSwipeHistory = useCallback(() => {
    swipeHistoryRef.current = [];
  }, []);

  const resetNeutralTracking = useCallback(() => {
    neutralRef.current = { noseX: 0.5, noseY: 0.5, roll: 0, pitch: 0, ready: false };
    calibrationRef.current = { count: 0, noseX: 0, noseY: 0, roll: 0, pitch: 0 };
    smoothedCursorRef.current = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };
    lastValidCursorRef.current = {
      x: window.innerWidth / 2,
      y: window.innerHeight / 2
    };
    lastValidGazeTimestampRef.current = 0;
    resetSwipeHistory();
  }, [resetSwipeHistory]);

  const releaseActivePinchGesture = useCallback(
    (mode: 'cancel' | 'release') => {
      const activeGesture = activePinchGestureRef.current;
      activePinchGestureRef.current = null;
      clearPinchPressTarget();
      setIsDragging(false);
      setCursorPosition(dragCursorRef.current, { x: -1000, y: -1000 });
      const effectiveMode =
        mode === 'release' && performance.now() - lastPinchClickRef.current <= PINCH_CLICK_COOLDOWN_MS ? 'cancel' : mode;

      const activatedTarget = finishActivePinchGesture({
        gesture: activeGesture,
        mode: effectiveMode,
        releaseLeafTarget: pointTargetRef.current
      });

      if (activeGesture?.hasDragged) {
        emitPinchDragSample(options.onPinchDrag, activeGesture, effectiveMode === 'cancel' ? 'cancel' : 'end');
      }

      if (!activatedTarget || effectiveMode !== 'release') {
        return;
      }

      lastPinchClickRef.current = performance.now();
      options.onPinchClick?.({
        target: activatedTarget,
        x: activeGesture?.startCursorPoint.x ?? smoothedCursorRef.current.x,
        y: activeGesture?.startCursorPoint.y ?? smoothedCursorRef.current.y
      });
    },
    [clearPinchPressTarget, options]
  );

  useEffect(() => {
    if (gestureEnabled) {
      return;
    }

    isPinchingRef.current = false;
    lastPinchClickRef.current = 0;
    lastSwipeGestureAtMsRef.current = -Infinity;
    suppressSinglePinchUntilReleaseRef.current = false;
    releaseActivePinchGesture('cancel');
    resetSwipeHistory();
    resetZoomGesture();
    setIsPinching(false);
    setIsDragging(false);
    setCursorPosition(dragCursorRef.current, { x: -1000, y: -1000 });
    options.onPinchState?.({ isPinching: false });
  }, [gestureEnabled, options, releaseActivePinchGesture, resetSwipeHistory, resetZoomGesture]);

  const handlePinchZoom = useCallback(
    (hands: { left: HandGestureSample; right: HandGestureSample }) => {
      const { left, right } = hands;
      const midpoint = {
        x: clamp((left.screenPoint.x + right.screenPoint.x) / 2, 0, window.innerWidth),
        y: clamp((left.screenPoint.y + right.screenPoint.y) / 2, 0, window.innerHeight)
      };
      const distance = Math.hypot(right.screenPoint.x - left.screenPoint.x, right.screenPoint.y - left.screenPoint.y);
      const previousDistance = zoomGestureRef.current.previousDistance;
      const wasActive = zoomGestureRef.current.active;

      zoomGestureRef.current = {
        active: true,
        previousDistance: distance
      };

      if (!wasActive) {
        releaseActivePinchGesture('cancel');
        clearHoveredTarget();
        clearHoverDispatchTarget();
        resetSwipeHistory();
      }

      if (previousDistance == null) {
        return;
      }

      const deltaY = -(distance - previousDistance) * PINCH_ZOOM_SENSITIVITY;
      if (deltaY === 0) {
        return;
      }

      const target = findPointTarget(midpoint.x, midpoint.y);
      if (!target) {
        return;
      }

      dispatchSyntheticWheelEvent(target, createSyntheticCoordinates(midpoint.x, midpoint.y), {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaMode: 0,
        deltaY
      });
    },
    [clearHoverDispatchTarget, clearHoveredTarget, releaseActivePinchGesture, resetSwipeHistory]
  );

  const recalibrate = useCallback(() => {
    resetNeutralTracking();
    setCursorPosition(cursorRef.current, { x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setCursorPosition(dragCursorRef.current, { x: -1000, y: -1000 });
    updateStatus('Calibrating center...');
    options.onGaze?.({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
      target: null,
      isCalibrated: false
    });
  }, [options, resetNeutralTracking, updateStatus]);

  const stopTracking = useCallback(() => {
    isTrackingRef.current = false;
    isPinchingRef.current = false;
    lastPinchClickRef.current = 0;
    lastSwipeGestureAtMsRef.current = -Infinity;
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }

    releaseActivePinchGesture('cancel');
    clearHoveredTarget();
    clearHoverDispatchTarget();
    resetZoomGesture();
    suppressSinglePinchUntilReleaseRef.current = false;
    resetNeutralTracking();
    setCursorPosition(cursorRef.current, { x: -1000, y: -1000 });
    setCursorPosition(dragCursorRef.current, { x: -1000, y: -1000 });
    setShowCursor(false);
    setIsTracking(false);
    setIsPinching(false);
    setIsDragging(false);
    options.onPinchState?.({ isPinching: false });
    setIsLoading(false);
    updateStatus('Idle');
  }, [
    clearHoverDispatchTarget,
    clearHoveredTarget,
    options,
    releaseActivePinchGesture,
    resetNeutralTracking,
    resetZoomGesture,
    updateStatus
  ]);

  const processLandmarks = useCallback(
    (landmarks: FaceLandmark[]) => {
      const now = performance.now();
      const sample = buildNeutralSample(landmarks);
      if (!sample) {
        return;
      }
      const activeGesture = activePinchGestureRef.current;
      let effectiveCursorPoint: CursorPosition;
      let reportedCursorPoint: CursorPosition;
      let hovered: HTMLElement | null;

      if (!neutralRef.current.ready) {
        calibrationRef.current.count += 1;
        calibrationRef.current.noseX += sample.noseX;
        calibrationRef.current.noseY += sample.noseY;
        calibrationRef.current.roll += sample.roll;
        calibrationRef.current.pitch += sample.pitch;
        updateStatus(`Calibrating center... (${Math.min(calibrationRef.current.count, CALIBRATION_FRAMES)}/${CALIBRATION_FRAMES})`);

        if (calibrationRef.current.count >= CALIBRATION_FRAMES) {
          const count = calibrationRef.current.count;
          neutralRef.current = {
            noseX: calibrationRef.current.noseX / count,
            noseY: calibrationRef.current.noseY / count,
            roll: calibrationRef.current.roll / count,
            pitch: calibrationRef.current.pitch / count,
            ready: true
          };
          updateStatus('Face control active');
        } else {
          clearHoveredTarget();
          clearHoverDispatchTarget();
          pointTargetRef.current = null;
          smoothedCursorRef.current = {
            x: window.innerWidth / 2,
            y: window.innerHeight / 2
          };
          setCursorPosition(cursorRef.current, smoothedCursorRef.current);
          options.onGaze?.({
            x: smoothedCursorRef.current.x,
            y: smoothedCursorRef.current.y,
            target: null,
            isCalibrated: false
          });
          return;
        }
      }

      const neutral = neutralRef.current;
      const rawOffset = calculateNoseTrackingOffsets(sample, neutral);
      const normalizedX = clamp(0.5 + rawOffset.x * HORIZONTAL_GAIN, 0.03, 0.97);
      const normalizedY = clamp(0.5 + rawOffset.y * VERTICAL_GAIN, 0.03, 0.97);
      const targetX = normalizedX * window.innerWidth;
      const targetY = normalizedY * window.innerHeight;

      smoothedCursorRef.current.x = lerp(smoothedCursorRef.current.x, targetX, CURSOR_SMOOTHING);
      smoothedCursorRef.current.y = lerp(smoothedCursorRef.current.y, targetY, CURSOR_SMOOTHING);

      if (activeGesture) {
        effectiveCursorPoint = activeGesture.startCursorPoint;
        reportedCursorPoint = activeGesture.hasDragged ? activeGesture.currentDragPoint : activeGesture.startCursorPoint;
        pointTargetRef.current = activeGesture.currentTarget;
        hoverDispatchTargetRef.current = activeGesture.currentTarget;
        hovered = activeGesture.hoverStyleTarget;
        if (isValidGazeHoverTarget(hovered)) {
          setHoveredElement(hovered);
        } else {
          clearHoveredTarget();
        }
        setCursorPosition(dragCursorRef.current, activeGesture.currentDragPoint);
      } else {
        smoothedCursorRef.current = applyStickySnap(smoothedCursorRef.current);
        effectiveCursorPoint = smoothedCursorRef.current;
        reportedCursorPoint = effectiveCursorPoint;

        const pointTarget = findPointTarget(effectiveCursorPoint.x, effectiveCursorPoint.y);
        pointTargetRef.current = pointTarget;
        hovered = findInteractiveAncestor(pointTarget);

        if (isValidGazeHoverTarget(hovered)) {
          setHoveredElement(hovered);
        } else {
          clearHoveredTarget();
        }

        if (!zoomGestureRef.current.active) {
          hoverDispatchTargetRef.current = dispatchHoverTransition(
            hoverDispatchTargetRef.current,
            pointTarget,
            createSyntheticCoordinates(effectiveCursorPoint.x, effectiveCursorPoint.y),
            false
          );
        }
      }

      setCursorPosition(cursorRef.current, effectiveCursorPoint);
      lastValidCursorRef.current = reportedCursorPoint;
      lastValidGazeTimestampRef.current = now;
      updateStatus('Face control active');

      options.onGaze?.({
        x: reportedCursorPoint.x,
        y: reportedCursorPoint.y,
        target: hovered,
        isCalibrated: true
      });
    },
    [clearHoverDispatchTarget, clearHoveredTarget, options, setHoveredElement, updateStatus]
  );

  const processHandLandmarks = useCallback(
    (handResult: { landmarks: FaceLandmark[][]; handedness: HandednessCategory[][]; handednesses?: HandednessCategory[][] }) => {
      const now = performance.now();
      if (!gestureEnabled) {
        resetSwipeHistory();
        if (isPinchingRef.current) {
          isPinchingRef.current = false;
          setIsPinching(false);
          options.onPinchState?.({ isPinching: false });
        }
        resetZoomGesture();
        releaseActivePinchGesture('cancel');
        return;
      }

      if (!neutralRef.current.ready) {
        resetSwipeHistory();
        if (isPinchingRef.current) {
          isPinchingRef.current = false;
          setIsPinching(false);
          options.onPinchState?.({ isPinching: false });
        }
        resetZoomGesture();
        releaseActivePinchGesture('cancel');
        return;
      }

      const handednessSets = handResult.handedness.length > 0 ? handResult.handedness : (handResult.handednesses ?? []);
      const handSamples = handResult.landmarks
        .map((landmarks, index) => buildHandGestureSample(landmarks, handednessSets[index]))
        .filter((sample): sample is HandGestureSample => sample != null)
        .slice(0, 2);
      const zoomHands = selectPinchingHandsForZoom(handSamples);
      const pinchingHands = handSamples.filter((sample) => sample.pinching);
      const openHands = handSamples.filter((sample) => !sample.pinching);
      const anyPinching = pinchingHands.length > 0;
      const activeGesture = activePinchGestureRef.current;
      const wasPinching = isPinchingRef.current;

      setIsPinching(anyPinching);
      options.onPinchState?.({ isPinching: anyPinching });

      if (anyPinching) {
        resetSwipeHistory();
        isPinchingRef.current = true;

        if (zoomHands) {
          suppressSinglePinchUntilReleaseRef.current = true;
          handlePinchZoom(zoomHands);
          return;
        }

        resetZoomGesture();

        if (suppressSinglePinchUntilReleaseRef.current) {
          return;
        }

        const pinchingHand = pinchingHands[0];
        if (
          activeGesture &&
          activeGesture.hasDragged &&
          shouldReleasePinchGesture(activeGesture, {
            now,
            pinchDistance: pinchingHand.pinchDistance,
            pinchRatio: pinchingHand.pinchRatio
          })
        ) {
          suppressSinglePinchUntilReleaseRef.current = true;
          releaseActivePinchGesture('release');
          return;
        }

        if (!activeGesture) {
          const leafTarget = pointTargetRef.current ?? findPointTarget(smoothedCursorRef.current.x, smoothedCursorRef.current.y);
          const hoverStyleTarget = findInteractiveAncestor(leafTarget);
          activePinchGestureRef.current = createActivePinchGesture({
            activationTarget: findActivationTarget(leafTarget),
            cursorPoint: smoothedCursorRef.current,
            handPoint: pinchingHand.screenPoint,
            hoverStyleTarget,
            leafTarget,
            pinchDistance: pinchingHand.pinchDistance,
            pinchRatio: pinchingHand.pinchRatio,
            pressedAtMs: now
          });
          hoverDispatchTargetRef.current = activePinchGestureRef.current.currentTarget;
          pointTargetRef.current = activePinchGestureRef.current.currentTarget;
          setCursorPosition(dragCursorRef.current, activePinchGestureRef.current.currentDragPoint);
          setPinchPressTarget(hoverStyleTarget);
          return;
        }

        const wasDragging = activeGesture.hasDragged;
        const nextDragPoint = calculateDragCursorPoint(
          activeGesture.startCursorPoint,
          activeGesture.startHandPoint,
          pinchingHand.screenPoint
        );
        const dragTarget = findPointTarget(nextDragPoint.x, nextDragPoint.y);
        updateActivePinchGesture(activeGesture, {
          dragTarget,
          handPoint: pinchingHand.screenPoint,
          now,
          onPinchDrag: options.onPinchDrag,
          pinchDistance: pinchingHand.pinchDistance,
          pinchRatio: pinchingHand.pinchRatio
        });
        hoverDispatchTargetRef.current = activeGesture.currentTarget;
        pointTargetRef.current = activeGesture.currentTarget;
        if (!wasDragging && activeGesture.hasDragged) {
          setIsDragging(true);
        }
        if (isValidGazeHoverTarget(activeGesture.hoverStyleTarget)) {
          setHoveredElement(activeGesture.hoverStyleTarget);
        } else {
          clearHoveredTarget();
        }
        setCursorPosition(dragCursorRef.current, activeGesture.currentDragPoint);
        return;
      }

      isPinchingRef.current = false;
      suppressSinglePinchUntilReleaseRef.current = false;
      resetZoomGesture();

      if (wasPinching || activeGesture) {
        resetSwipeHistory();
        releaseActivePinchGesture('release');
        return;
      }

      if (
        !shouldTrackOpenHandSwipe({
          anyPinching,
          hasActivePinchGesture: false,
          isCalibrated: neutralRef.current.ready,
          lastSwipeGestureAtMs: lastSwipeGestureAtMsRef.current,
          now,
          openHandCount: openHands.length
        })
      ) {
        resetSwipeHistory();
        return;
      }

      swipeHistoryRef.current = updateSwipeGestureHistory({
        history: swipeHistoryRef.current,
        now,
        sample: {
          atMs: now,
          handedness: openHands[0].handedness,
          point: openHands[0].gesturePoint
        }
      });

      const detectedGesture = detectOpenHandSwipeGesture(swipeHistoryRef.current, {
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth
      });
      if (!detectedGesture) {
        return;
      }

      dispatchOpenHandSwipeGesture(detectedGesture);
      lastSwipeGestureAtMsRef.current = now;
      resetSwipeHistory();
    },
    [
      clearHoveredTarget,
      handlePinchZoom,
      options,
      releaseActivePinchGesture,
      resetSwipeHistory,
      resetZoomGesture,
      setHoveredElement,
      setPinchPressTarget,
      gestureEnabled
    ]
  );

  const trackFrame = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !landmarker || !isTrackingRef.current) {
      return;
    }

    if (video.readyState >= 2 && video.currentTime !== lastVideoTimeRef.current) {
      const now = performance.now();
      const result = landmarker.detectForVideo(video, now);
      lastVideoTimeRef.current = video.currentTime;

      if (result.faceLandmarks.length > 0) {
        missingFramesRef.current = 0;
        processLandmarks(result.faceLandmarks[0]);
      } else {
        missingFramesRef.current += 1;
        if (neutralRef.current.ready) {
          const freezeValid = now - lastValidGazeTimestampRef.current <= GAZE_FREEZE_MS;
          if (freezeValid) {
            setCursorPosition(cursorRef.current, lastValidCursorRef.current);
            options.onGaze?.({
              x: lastValidCursorRef.current.x,
              y: lastValidCursorRef.current.y,
              target: hoveredElementRef.current,
              isCalibrated: true
            });
          } else if (missingFramesRef.current > 2) {
            updateStatus('Face not detected');
            clearHoveredTarget();
            clearHoverDispatchTarget();
            pointTargetRef.current = null;
            options.onGaze?.({
              x: lastValidCursorRef.current.x,
              y: lastValidCursorRef.current.y,
              target: null,
              isCalibrated: true
            });
          }
        } else if (missingFramesRef.current > 2) {
          updateStatus('Face not detected');
          clearHoveredTarget();
          clearHoverDispatchTarget();
          pointTargetRef.current = null;
          smoothedCursorRef.current = {
            x: window.innerWidth / 2,
            y: window.innerHeight / 2
          };
          setCursorPosition(cursorRef.current, smoothedCursorRef.current);
          options.onGaze?.({
            x: smoothedCursorRef.current.x,
            y: smoothedCursorRef.current.y,
            target: null,
            isCalibrated: false
          });
        }
      }

      const handLandmarker = handLandmarkerRef.current;
      if (handLandmarker && gestureEnabled) {
        const handResult = handLandmarker.detectForVideo(video, now);
        processHandLandmarks(handResult);
      }
    }

    animationFrameRef.current = requestAnimationFrame(trackFrame);
  }, [clearHoverDispatchTarget, clearHoveredTarget, gestureEnabled, processHandLandmarks, processLandmarks, updateStatus]);

  const startTracking = useCallback(async () => {
    if (isTrackingRef.current || isLoading) {
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('This browser does not support camera access.');
      return;
    }

    setError('');
    setIsLoading(true);
    updateStatus('Loading face tracker...');

    try {
      if (!landmarkerRef.current) {
        const vision = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
        landmarkerRef.current = (await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: FACE_MODEL_PATH
          },
          runningMode: 'VIDEO',
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        })) as unknown as FaceLandmarkerInstance;

        handLandmarkerRef.current = (await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: HAND_MODEL_PATH
          },
          runningMode: 'VIDEO',
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        })) as unknown as HandLandmarkerInstance;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 480 }
        },
        audio: false
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        throw new Error('Video element unavailable.');
      }
      video.srcObject = stream;
      await video.play();
      mirrorHoverStyles();

      lastVideoTimeRef.current = -1;
      missingFramesRef.current = 0;
      isPinchingRef.current = false;
      lastSwipeGestureAtMsRef.current = -Infinity;
      hoverDispatchTargetRef.current = null;
      pointTargetRef.current = null;
      activePinchGestureRef.current = null;
      suppressSinglePinchUntilReleaseRef.current = false;
      resetZoomGesture();
      setIsPinching(false);
      setIsDragging(false);
      options.onPinchState?.({ isPinching: false });
      smoothedCursorRef.current = {
        x: window.innerWidth / 2,
        y: window.innerHeight / 2
      };
      setCursorPosition(dragCursorRef.current, { x: -1000, y: -1000 });
      recalibrate();

      setIsTracking(true);
      isTrackingRef.current = true;
      setShowCursor(true);
      setIsLoading(false);
      animationFrameRef.current = requestAnimationFrame(trackFrame);
    } catch (trackingError) {
      // eslint-disable-next-line no-console
      console.error(trackingError);
      const message = trackingError instanceof Error ? trackingError.message : 'Failed to start nose tracking.';
      setError(message);
      setIsLoading(false);
      stopTracking();
    }
  }, [isLoading, options, recalibrate, resetZoomGesture, stopTracking, trackFrame, updateStatus]);

  useEffect(() => {
    return () => {
      stopTracking();
      if (landmarkerRef.current) {
        landmarkerRef.current.close();
        landmarkerRef.current = null;
      }
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
        handLandmarkerRef.current = null;
      }
    };
  }, [stopTracking]);

  return {
    videoRef,
    cursorRef,
    dragCursorRef,
    isTracking,
    isPinching,
    isDragging,
    isLoading,
    showCursor,
    status,
    error,
    startTracking,
    stopTracking,
    recalibrate
  };
}

export const __FACE_NOSE_CURSOR_TESTING__ = {
  activateElement,
  applyStickySnap,
  buildNeutralSample,
  calculateDragCursorPoint,
  calculateNoseTrackingOffsets,
  calculateSwipeAngleDeg,
  calculateSwipeGestureMetrics,
  createActivePinchGesture,
  createSyntheticCoordinates,
  detectOpenHandSwipeGesture,
  emitPinchDragSample,
  dispatchPressEndSequence,
  dispatchPressMoveSequence,
  dispatchPressStartSequence,
  dispatchHoverTransition,
  dispatchOpenHandSwipeGesture,
  dispatchSyntheticClick,
  dispatchSyntheticWheelEvent,
  finishActivePinchGesture,
  findActivationTarget,
  findInteractiveAncestor,
  findNearestInteractiveTarget,
  isPointInsideEscapeCenterZone,
  isSwipeGestureCoolingDown,
  isValidGazeHoverTarget,
  normalizeAngleDeltaDeg,
  pruneSwipeGestureHistory,
  selectPinchingHandsForZoom,
  shouldTrackOpenHandSwipe,
  shouldReleasePinchGesture,
  updateSwipeGestureHistory,
  updateActivePinchGesture
};
