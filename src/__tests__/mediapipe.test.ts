import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@mediapipe/tasks-vision', () => ({
  FaceLandmarker: {},
  FilesetResolver: {},
  HandLandmarker: {}
}));

import { __FACE_NOSE_CURSOR_TESTING__ } from '../utils/mediapipe';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

type SwipeHistory = Parameters<typeof __FACE_NOSE_CURSOR_TESTING__.detectOpenHandSwipeGesture>[0];
type SwipeHistorySample = SwipeHistory[number];

function createPointerSample(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    gesturePoint: { x: 0, y: 0 },
    handSpan: 1,
    handedness: null,
    indexTip: { x: 0, y: 0 },
    pinchDistance: 0,
    pinchRatio: 0,
    pinching: true,
    screenPoint: { x: 0, y: 0 },
    thumbTip: { x: 0, y: 0 },
    ...overrides
  };
}

function createSwipeHistorySample(
  atMs: number,
  point: { x: number; y: number },
  handedness: 'Left' | 'Right' | null = 'Right'
): SwipeHistorySample {
  return {
    atMs,
    handedness,
    point
  };
}

type PinchDragSampleRecord = {
  currentTarget: Element | null;
  phase: 'start' | 'move' | 'end' | 'cancel';
  sourceTarget: Element | null;
  x: number;
  y: number;
};

function createFaceLandmarks(): Array<{ x: number; y: number; z: number }> {
  return Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
}

function setLandmark(
  landmarks: Array<{ x: number; y: number; z: number }>,
  index: number,
  point: Partial<{ x: number; y: number; z: number }>
): void {
  landmarks[index] = {
    x: point.x ?? landmarks[index].x,
    y: point.y ?? landmarks[index].y,
    z: point.z ?? landmarks[index].z
  };
}

function createNoseLandmarks(overrides: { noseX?: number; noseY?: number; leftEyeY?: number; rightEyeY?: number } = {}) {
  const landmarks = createFaceLandmarks();
  setLandmark(landmarks, 33, { x: 0.36, y: overrides.leftEyeY ?? 0.4 });
  setLandmark(landmarks, 263, { x: 0.64, y: overrides.rightEyeY ?? 0.4 });
  setLandmark(landmarks, 1, { x: overrides.noseX ?? 0.5, y: overrides.noseY ?? 0.52 });
  return landmarks;
}

describe('mediapipe gaze hover guard', () => {
  it('rejects invalid hover targets and accepts valid non-sdk elements', () => {
    expect(__FACE_NOSE_CURSOR_TESTING__.isValidGazeHoverTarget(null)).toBe(false);

    const empty = {
      tagName: '',
      textContent: '',
      getAttribute: () => null
    } as unknown as HTMLElement;
    expect(__FACE_NOSE_CURSOR_TESTING__.isValidGazeHoverTarget(empty)).toBe(false);

    const sdkElement = document.createElement('button');
    sdkElement.textContent = 'Open';
    sdkElement.setAttribute('data-exocor-ui', 'true');
    expect(__FACE_NOSE_CURSOR_TESTING__.isValidGazeHoverTarget(sdkElement)).toBe(false);

    const validElement = document.createElement('button');
    validElement.textContent = 'Open';
    expect(__FACE_NOSE_CURSOR_TESTING__.isValidGazeHoverTarget(validElement)).toBe(true);
  });
});

describe('mediapipe nose tracking helpers', () => {
  it('builds a neutral sample from nose and eye landmarks using raw pitch from the eye line', () => {
    const landmarks = createNoseLandmarks({ noseX: 0.48, noseY: 0.54 });

    const sample = __FACE_NOSE_CURSOR_TESTING__.buildNeutralSample(landmarks);

    expect(sample).toMatchObject({
      noseX: 0.48,
      noseY: 0.54
    });
    expect(sample?.pitch).toBeCloseTo(0.14, 5);
    expect(Number.isFinite(sample?.roll)).toBe(true);
  });

  it('computes horizontal and vertical offsets from raw nose deltas with roll/pitch compensation', () => {
    const neutral = {
      noseX: 0.5,
      noseY: 0.52,
      roll: 0.02,
      pitch: 0.1,
      ready: true
    };
    const sample = {
      noseX: 0.47,
      noseY: 0.56,
      roll: 0.0,
      pitch: 0.14
    };

    const offset = __FACE_NOSE_CURSOR_TESTING__.calculateNoseTrackingOffsets(sample, neutral);

    expect(offset.x).toBeCloseTo(0.0324, 5);
    expect(offset.y).toBeCloseTo(0.0488, 5);
  });
});

describe('mediapipe virtual pointer helpers', () => {
  it('treats form controls as hover-style targets', () => {
    const field = document.createElement('input');
    const wrapper = document.createElement('div');
    wrapper.appendChild(field);
    document.body.appendChild(wrapper);

    expect(__FACE_NOSE_CURSOR_TESTING__.findInteractiveAncestor(field)).toBe(field);
  });

  it('dispatches hover transition events in the expected order with coordinates', () => {
    const previous = document.createElement('div');
    const next = document.createElement('div');
    document.body.append(previous, next);

    const coordinates = __FACE_NOSE_CURSOR_TESTING__.createSyntheticCoordinates(120, 45);
    const events: Array<{ type: string; clientX: number; clientY: number; pageX: number; pageY: number }> = [];

    for (const [target, prefix, names] of [
      [previous, 'previous', ['mouseleave', 'mouseout']],
      [next, 'next', ['mouseenter', 'mouseover', 'mousemove']]
    ] as const) {
      for (const name of names) {
        target.addEventListener(name, (event) => {
          const mouseEvent = event as MouseEvent;
          events.push({
            type: `${prefix}:${event.type}`,
            clientX: mouseEvent.clientX,
            clientY: mouseEvent.clientY,
            pageX: mouseEvent.pageX,
            pageY: mouseEvent.pageY
          });
        });
      }
    }

    __FACE_NOSE_CURSOR_TESTING__.dispatchHoverTransition(previous, next, coordinates, false);

    expect(events.map((event) => event.type)).toEqual([
      'previous:mouseleave',
      'previous:mouseout',
      'next:mouseenter',
      'next:mouseover',
      'next:mousemove'
    ]);
    expect(events.every((event) => event.clientX === 120 && event.clientY === 45)).toBe(true);
    expect(events.every((event) => event.pageX === 120 && event.pageY === 45)).toBe(true);
  });

  it('starts press immediately and clicks a canvas-style target when pinch releases before 150ms', () => {
    const target = document.createElement('canvas');
    document.body.appendChild(target);

    const events: Array<{ type: string; clientX: number; clientY: number; pageX: number; pageY: number }> = [];
    for (const name of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      target.addEventListener(name, (event) => {
        const mouseEvent = event as MouseEvent;
        events.push({
          type: event.type,
          clientX: mouseEvent.clientX,
          clientY: mouseEvent.clientY,
          pageX: mouseEvent.pageX,
          pageY: mouseEvent.pageY
        });
      });
    }

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: null,
      cursorPoint: { x: 88, y: 64 },
      handPoint: { x: 40, y: 20 },
      hoverStyleTarget: null,
      leafTarget: target
    });

    const activatedTarget = __FACE_NOSE_CURSOR_TESTING__.finishActivePinchGesture({
      gesture,
      mode: 'release',
      releaseLeafTarget: target
    });

    expect(activatedTarget).toBe(target);
    expect(events).toEqual([
      { type: 'pointerdown', clientX: 88, clientY: 64, pageX: 88, pageY: 64 },
      { type: 'mousedown', clientX: 88, clientY: 64, pageX: 88, pageY: 64 },
      { type: 'pointerup', clientX: 88, clientY: 64, pageX: 88, pageY: 64 },
      { type: 'mouseup', clientX: 88, clientY: 64, pageX: 88, pageY: 64 },
      { type: 'click', clientX: 88, clientY: 64, pageX: 88, pageY: 64 }
    ]);
  });

  it('keeps a canvas pinch as click when movement grows but hold time stays under 150ms', () => {
    const target = document.createElement('canvas');
    document.body.appendChild(target);

    const events: Array<{ type: string; clientX: number; clientY: number }> = [];
    for (const name of ['pointerdown', 'mousedown', 'pointermove', 'mousemove', 'pointerup', 'mouseup', 'click']) {
      target.addEventListener(name, (event) => {
        const mouseEvent = event as MouseEvent;
        events.push({
          type: event.type,
          clientX: mouseEvent.clientX,
          clientY: mouseEvent.clientY
        });
      });
    }

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: null,
      cursorPoint: { x: 12, y: 18 },
      handPoint: { x: 50, y: 50 },
      hoverStyleTarget: null,
      leafTarget: target,
      pinchDistance: 0.02,
      pinchRatio: 0.2,
      pressedAtMs: 0
    });

    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      handPoint: { x: 86, y: 92 },
      now: 100,
      pinchDistance: 0.02,
      pinchRatio: 0.2
    });

    const activatedTarget = __FACE_NOSE_CURSOR_TESTING__.finishActivePinchGesture({
      gesture,
      mode: 'release',
      releaseLeafTarget: target
    });

    expect(gesture.hasDragged).toBe(false);
    expect(activatedTarget).toBe(target);
    expect(events).toEqual([
      { type: 'pointerdown', clientX: 12, clientY: 18 },
      { type: 'mousedown', clientX: 12, clientY: 18 },
      { type: 'pointerup', clientX: 12, clientY: 18 },
      { type: 'mouseup', clientX: 12, clientY: 18 },
      { type: 'click', clientX: 12, clientY: 18 }
    ]);
  });

  it('starts drag exactly when the timeout is crossed and catches up to the accumulated hand delta', () => {
    const target = document.createElement('canvas');
    document.body.appendChild(target);

    const events: Array<{ type: string; clientX: number; clientY: number }> = [];
    for (const name of ['pointerdown', 'mousedown', 'pointermove', 'mousemove', 'pointerup', 'mouseup', 'click']) {
      target.addEventListener(name, (event) => {
        const mouseEvent = event as MouseEvent;
        events.push({
          type: event.type,
          clientX: mouseEvent.clientX,
          clientY: mouseEvent.clientY
        });
      });
    }

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: null,
      cursorPoint: { x: 60, y: 90 },
      handPoint: { x: 14, y: 12 },
      hoverStyleTarget: null,
      leafTarget: target,
      pinchDistance: 0.02,
      pinchRatio: 0.2,
      pressedAtMs: 0
    });

    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      handPoint: { x: 54, y: 56 },
      now: 149,
      pinchDistance: 0.018,
      pinchRatio: 0.18
    });

    expect(gesture.hasDragged).toBe(false);

    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      handPoint: { x: 54, y: 56 },
      now: 150,
      pinchDistance: 0.017,
      pinchRatio: 0.17
    });

    const activatedTarget = __FACE_NOSE_CURSOR_TESTING__.finishActivePinchGesture({
      gesture,
      mode: 'release',
      releaseLeafTarget: target
    });

    expect(gesture.hasDragged).toBe(true);
    expect(activatedTarget).toBeNull();
    expect(events).toEqual([
      { type: 'pointerdown', clientX: 60, clientY: 90 },
      { type: 'mousedown', clientX: 60, clientY: 90 },
      { type: 'pointermove', clientX: 100, clientY: 134 },
      { type: 'mousemove', clientX: 100, clientY: 134 },
      { type: 'pointerup', clientX: 100, clientY: 134 },
      { type: 'mouseup', clientX: 100, clientY: 134 }
    ]);
  });

  it('allows drag on a regular div after 150ms even with tiny movement', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const events: Array<{ type: string; clientX: number; clientY: number }> = [];
    for (const name of ['pointerdown', 'mousedown', 'pointermove', 'mousemove', 'pointerup', 'mouseup', 'click']) {
      target.addEventListener(name, (event) => {
        const mouseEvent = event as MouseEvent;
        events.push({
          type: event.type,
          clientX: mouseEvent.clientX,
          clientY: mouseEvent.clientY
        });
      });
    }

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: null,
      cursorPoint: { x: 42, y: 58 },
      handPoint: { x: 10, y: 10 },
      hoverStyleTarget: null,
      leafTarget: target,
      pinchDistance: 0.02,
      pinchRatio: 0.2,
      pressedAtMs: 0
    });

    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      handPoint: { x: 12, y: 13 },
      now: 180,
      pinchDistance: 0.018,
      pinchRatio: 0.18
    });

    const activatedTarget = __FACE_NOSE_CURSOR_TESTING__.finishActivePinchGesture({
      gesture,
      mode: 'release',
      releaseLeafTarget: target
    });

    expect(gesture.hasDragged).toBe(true);
    expect(activatedTarget).toBeNull();
    expect(events).toEqual([
      { type: 'pointerdown', clientX: 42, clientY: 58 },
      { type: 'mousedown', clientX: 42, clientY: 58 },
      { type: 'pointermove', clientX: 44, clientY: 61 },
      { type: 'mousemove', clientX: 44, clientY: 61 },
      { type: 'pointerup', clientX: 44, clientY: 61 },
      { type: 'mouseup', clientX: 44, clientY: 61 }
    ]);
  });

  it('releases drag from the last stable drag point without buffering or a release-frame move', () => {
    const target = document.createElement('canvas');
    document.body.appendChild(target);

    const events: Array<{ type: string; clientX: number; clientY: number }> = [];
    for (const name of ['pointerdown', 'mousedown', 'pointermove', 'mousemove', 'pointerup', 'mouseup', 'click']) {
      target.addEventListener(name, (event) => {
        const mouseEvent = event as MouseEvent;
        events.push({
          type: event.type,
          clientX: mouseEvent.clientX,
          clientY: mouseEvent.clientY
        });
      });
    }

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: null,
      cursorPoint: { x: 10, y: 10 },
      handPoint: { x: 0, y: 0 },
      hoverStyleTarget: null,
      leafTarget: target,
      pinchDistance: 0.02,
      pinchRatio: 0.2,
      pressedAtMs: 0
    });

    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      handPoint: { x: 30, y: 30 },
      now: 160,
      pinchDistance: 0.018,
      pinchRatio: 0.18
    });
    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      handPoint: { x: 40, y: 40 },
      now: 176,
      pinchDistance: 0.017,
      pinchRatio: 0.17
    });
    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      handPoint: { x: 60, y: 62 },
      now: 192,
      pinchDistance: 0.016,
      pinchRatio: 0.16
    });
    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      handPoint: { x: 78, y: 82 },
      now: 208,
      pinchDistance: 0.015,
      pinchRatio: 0.15
    });

    const activatedTarget = __FACE_NOSE_CURSOR_TESTING__.finishActivePinchGesture({
      gesture,
      mode: 'release',
      releaseLeafTarget: target
    });

    expect(activatedTarget).toBeNull();
    expect(events).toEqual([
      { type: 'pointerdown', clientX: 10, clientY: 10 },
      { type: 'mousedown', clientX: 10, clientY: 10 },
      { type: 'pointermove', clientX: 40, clientY: 40 },
      { type: 'mousemove', clientX: 40, clientY: 40 },
      { type: 'pointermove', clientX: 50, clientY: 50 },
      { type: 'mousemove', clientX: 50, clientY: 50 },
      { type: 'pointermove', clientX: 70, clientY: 72 },
      { type: 'mousemove', clientX: 70, clientY: 72 },
      { type: 'pointermove', clientX: 88, clientY: 92 },
      { type: 'mousemove', clientX: 88, clientY: 92 },
      { type: 'pointerup', clientX: 88, clientY: 92 },
      { type: 'mouseup', clientX: 88, clientY: 92 }
    ]);
  });

  it('retargets committed drag events to the live hit target instead of keeping them on the source card', () => {
    const source = document.createElement('div');
    source.className = 'task-card';
    const destination = document.createElement('div');
    destination.className = 'task-card';
    document.body.append(source, destination);

    const events: string[] = [];
    for (const [target, label] of [
      [source, 'source'],
      [destination, 'destination']
    ] as const) {
      for (const name of [
        'pointerdown',
        'mousedown',
        'pointerleave',
        'mouseleave',
        'pointerout',
        'mouseout',
        'pointerenter',
        'mouseenter',
        'pointerover',
        'mouseover',
        'pointermove',
        'mousemove',
        'pointerup',
        'mouseup'
      ]) {
        target.addEventListener(name, (event) => {
          events.push(`${label}:${event.type}`);
        });
      }
    }

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: null,
      cursorPoint: { x: 50, y: 60 },
      handPoint: { x: 10, y: 10 },
      hoverStyleTarget: source,
      leafTarget: source,
      pinchDistance: 0.02,
      pinchRatio: 0.2,
      pressedAtMs: 0
    });

    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      dragTarget: destination,
      handPoint: { x: 40, y: 25 },
      now: 150,
      pinchDistance: 0.018,
      pinchRatio: 0.18
    });

    const activatedTarget = __FACE_NOSE_CURSOR_TESTING__.finishActivePinchGesture({
      gesture,
      mode: 'release',
      releaseLeafTarget: source
    });

    expect(activatedTarget).toBeNull();
    expect(gesture.leafTarget).toBe(source);
    expect(gesture.currentTarget).toBe(destination);
    expect(gesture.hoverStyleTarget).toBe(destination);
    expect(events).toEqual([
      'source:pointerdown',
      'source:mousedown',
      'source:pointerleave',
      'source:mouseleave',
      'source:pointerout',
      'source:mouseout',
      'destination:pointerenter',
      'destination:mouseenter',
      'destination:pointerover',
      'destination:mouseover',
      'destination:pointermove',
      'destination:mousemove',
      'destination:pointerup',
      'destination:mouseup'
    ]);
  });

  it('reports semantic pinch drag samples so host apps can bridge into their own drag backends', () => {
    const source = document.createElement('div');
    source.className = 'task-card';
    const destination = document.createElement('div');
    destination.className = 'task-card';
    document.body.append(source, destination);

    const samples: PinchDragSampleRecord[] = [];
    const onPinchDrag = (sample: PinchDragSampleRecord) => {
      samples.push(sample);
    };

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: null,
      cursorPoint: { x: 50, y: 60 },
      handPoint: { x: 10, y: 10 },
      hoverStyleTarget: source,
      leafTarget: source,
      pinchDistance: 0.02,
      pinchRatio: 0.2,
      pressedAtMs: 0
    });

    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      dragTarget: destination,
      handPoint: { x: 25, y: 15 },
      now: 149,
      onPinchDrag,
      pinchDistance: 0.019,
      pinchRatio: 0.19
    });
    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      dragTarget: destination,
      handPoint: { x: 40, y: 25 },
      now: 150,
      onPinchDrag,
      pinchDistance: 0.018,
      pinchRatio: 0.18
    });
    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      dragTarget: destination,
      handPoint: { x: 55, y: 35 },
      now: 166,
      onPinchDrag,
      pinchDistance: 0.017,
      pinchRatio: 0.17
    });
    __FACE_NOSE_CURSOR_TESTING__.emitPinchDragSample(onPinchDrag, gesture, 'end');

    expect(samples).toEqual([
      {
        currentTarget: destination,
        phase: 'start',
        sourceTarget: source,
        x: 80,
        y: 75
      },
      {
        currentTarget: destination,
        phase: 'move',
        sourceTarget: source,
        x: 95,
        y: 85
      },
      {
        currentTarget: destination,
        phase: 'end',
        sourceTarget: source,
        x: 95,
        y: 85
      }
    ]);
  });

  it('suppresses native activation once drag has actually committed after the timeout', () => {
    const button = document.createElement('button');
    const label = document.createElement('span');
    button.appendChild(label);
    document.body.appendChild(button);

    const buttonClick = vi.fn();
    const labelMouseUp = vi.fn();
    button.addEventListener('click', buttonClick);
    label.addEventListener('mouseup', labelMouseUp);

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: __FACE_NOSE_CURSOR_TESTING__.findActivationTarget(label),
      cursorPoint: { x: 18, y: 24 },
      handPoint: { x: 5, y: 5 },
      hoverStyleTarget: button,
      leafTarget: label,
      pinchDistance: 0.02,
      pinchRatio: 0.2,
      pressedAtMs: 0
    });

    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      handPoint: { x: 24, y: 20 },
      now: 180,
      pinchDistance: 0.018,
      pinchRatio: 0.18
    });

    const activatedTarget = __FACE_NOSE_CURSOR_TESTING__.finishActivePinchGesture({
      gesture,
      mode: 'release',
      releaseLeafTarget: label
    });

    expect(gesture.hasDragged).toBe(true);
    expect(activatedTarget).toBeNull();
    expect(labelMouseUp).toHaveBeenCalledTimes(1);
    expect(buttonClick).not.toHaveBeenCalled();
  });

  it('treats pinch reopening as release before the hand returns to a fully open pinch threshold', () => {
    const target = document.createElement('canvas');
    document.body.appendChild(target);

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: null,
      cursorPoint: { x: 24, y: 24 },
      handPoint: { x: 4, y: 4 },
      hoverStyleTarget: null,
      leafTarget: target,
      pinchDistance: 0.02,
      pinchRatio: 0.2,
      pressedAtMs: 0
    });

    expect(
      __FACE_NOSE_CURSOR_TESTING__.shouldReleasePinchGesture(gesture, {
        pinchDistance: 0.027,
        pinchRatio: 0.26
      })
    ).toBe(true);
    expect(0.027 < 0.045).toBe(true);
    expect(0.26 < 0.4).toBe(true);
  });

  it('does not allow release during the first 200ms after drag commits even if the pinch opens sharply', () => {
    const target = document.createElement('canvas');
    document.body.appendChild(target);

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: null,
      cursorPoint: { x: 24, y: 24 },
      handPoint: { x: 4, y: 4 },
      hoverStyleTarget: null,
      leafTarget: target,
      pinchDistance: 0.02,
      pinchRatio: 0.2,
      pressedAtMs: 0
    });

    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      handPoint: { x: 24, y: 24 },
      now: 160,
      pinchDistance: 0.018,
      pinchRatio: 0.18
    });

    expect(gesture.hasDragged).toBe(true);
    expect(
      __FACE_NOSE_CURSOR_TESTING__.shouldReleasePinchGesture(gesture, {
        now: 300,
        pinchDistance: 0.05,
        pinchRatio: 0.38
      })
    ).toBe(false);
  });

  it('requires a clearly reopened pinch to release once drag is active', () => {
    const target = document.createElement('canvas');
    document.body.appendChild(target);

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: null,
      cursorPoint: { x: 24, y: 24 },
      handPoint: { x: 4, y: 4 },
      hoverStyleTarget: null,
      leafTarget: target,
      pinchDistance: 0.02,
      pinchRatio: 0.2,
      pressedAtMs: 0
    });

    __FACE_NOSE_CURSOR_TESTING__.updateActivePinchGesture(gesture, {
      handPoint: { x: 24, y: 24 },
      now: 160,
      pinchDistance: 0.018,
      pinchRatio: 0.18
    });

    expect(
      __FACE_NOSE_CURSOR_TESTING__.shouldReleasePinchGesture(gesture, {
        now: 380,
        pinchDistance: 0.027,
        pinchRatio: 0.26
      })
    ).toBe(false);

    expect(
      __FACE_NOSE_CURSOR_TESTING__.shouldReleasePinchGesture(gesture, {
        now: 380,
        pinchDistance: 0.046,
        pinchRatio: 0.36
      })
    ).toBe(true);
  });

  it('does not let pinch reopening cancel a gesture before drag has actually started', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: null,
      cursorPoint: { x: 24, y: 24 },
      handPoint: { x: 4, y: 4 },
      hoverStyleTarget: null,
      leafTarget: target,
      pinchDistance: 0.02,
      pinchRatio: 0.2,
      pressedAtMs: 0
    });

    expect(gesture.hasDragged).toBe(false);
    expect(
      __FACE_NOSE_CURSOR_TESTING__.shouldReleasePinchGesture(gesture, {
        pinchDistance: 0.027,
        pinchRatio: 0.26
      })
    ).toBe(true);

    const activatedTarget = __FACE_NOSE_CURSOR_TESTING__.finishActivePinchGesture({
      gesture,
      mode: 'release',
      releaseLeafTarget: target
    });

    expect(activatedTarget).toBe(target);
  });

  it('prefers native activation targets for nested button content', () => {
    const wrapper = document.createElement('div');
    wrapper.setAttribute('role', 'button');
    const button = document.createElement('button');
    const label = document.createElement('span');
    label.textContent = 'Zoom';
    button.appendChild(label);
    wrapper.appendChild(button);
    document.body.appendChild(wrapper);

    const events: string[] = [];
    label.addEventListener('pointerdown', () => events.push('label:pointerdown'));
    label.addEventListener('mouseup', () => events.push('label:mouseup'));
    label.addEventListener('click', () => events.push('label:click'));
    button.addEventListener('click', () => events.push('button:click'));

    expect(__FACE_NOSE_CURSOR_TESTING__.findActivationTarget(label)).toBe(button);

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: __FACE_NOSE_CURSOR_TESTING__.findActivationTarget(label),
      cursorPoint: { x: 32, y: 16 },
      handPoint: { x: 10, y: 10 },
      hoverStyleTarget: button,
      leafTarget: label
    });

    const activatedTarget = __FACE_NOSE_CURSOR_TESTING__.finishActivePinchGesture({
      gesture,
      mode: 'release',
      releaseLeafTarget: label
    });

    expect(activatedTarget).toBe(button);
    expect(events).toEqual(['label:pointerdown', 'label:mouseup', 'button:click']);
  });

  it('suppresses native click activation when release leaves the original activation chain', () => {
    const button = document.createElement('button');
    const label = document.createElement('span');
    const outside = document.createElement('div');
    button.appendChild(label);
    document.body.append(button, outside);

    const buttonClick = vi.fn();
    const labelMouseUp = vi.fn();
    button.addEventListener('click', buttonClick);
    label.addEventListener('mouseup', labelMouseUp);

    const gesture = __FACE_NOSE_CURSOR_TESTING__.createActivePinchGesture({
      activationTarget: __FACE_NOSE_CURSOR_TESTING__.findActivationTarget(label),
      cursorPoint: { x: 18, y: 24 },
      handPoint: { x: 5, y: 5 },
      hoverStyleTarget: button,
      leafTarget: label
    });

    const activatedTarget = __FACE_NOSE_CURSOR_TESTING__.finishActivePinchGesture({
      gesture,
      mode: 'release',
      releaseLeafTarget: outside
    });

    expect(activatedTarget).toBeNull();
    expect(labelMouseUp).toHaveBeenCalledTimes(1);
    expect(buttonClick).not.toHaveBeenCalled();
  });

  it('prefers showPicker for native select activation and focuses the element', () => {
    const select = document.createElement('select');
    const option = document.createElement('option');
    option.value = 'critical';
    option.textContent = 'critical';
    select.appendChild(option);
    document.body.appendChild(select);

    const showPicker = vi.fn();
    Object.defineProperty(select, 'showPicker', {
      configurable: true,
      value: showPicker
    });
    const focusSpy = vi.spyOn(select, 'focus');
    const clickSpy = vi.spyOn(select, 'click');

    const activatedTarget = __FACE_NOSE_CURSOR_TESTING__.activateElement(select);

    expect(activatedTarget).toBe(select);
    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(showPicker).toHaveBeenCalledTimes(1);
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('restores sticky snap when the gaze point is near an interactive target', () => {
    const button = document.createElement('button');
    document.body.appendChild(button);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
      bottom: 140,
      height: 40,
      left: 80,
      right: 160,
      top: 100,
      width: 80,
      x: 80,
      y: 100,
      toJSON: () => ({})
    });

    const snapped = __FACE_NOSE_CURSOR_TESTING__.applyStickySnap({ x: 110, y: 120 });

    expect(__FACE_NOSE_CURSOR_TESTING__.findNearestInteractiveTarget(110, 120)?.element).toBe(button);
    expect(snapped.x).toBeCloseTo(115.95, 1);
    expect(snapped.y).toBe(120);
  });

  it('dispatches wheel events with ctrlKey and midpoint coordinates for zoom', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);

    let received: { clientX: number; clientY: number; ctrlKey: boolean; deltaMode: number; deltaY: number } | null = null;
    target.addEventListener('wheel', (event) => {
      const wheelEvent = event as WheelEvent;
      received = {
        clientX: wheelEvent.clientX,
        clientY: wheelEvent.clientY,
        ctrlKey: wheelEvent.ctrlKey,
        deltaMode: wheelEvent.deltaMode,
        deltaY: wheelEvent.deltaY
      };
    });

    __FACE_NOSE_CURSOR_TESTING__.dispatchSyntheticWheelEvent(
      target,
      __FACE_NOSE_CURSOR_TESTING__.createSyntheticCoordinates(140, 90),
      {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        deltaMode: 0,
        deltaY: -36
      }
    );

    expect(received).toEqual({
      clientX: 140,
      clientY: 90,
      ctrlKey: true,
      deltaMode: 0,
      deltaY: -36
    });
  });
});

describe('mediapipe open-hand swipe helpers', () => {
  it('prunes swipe history to the rolling 500ms window', () => {
    const history: SwipeHistory = [
      createSwipeHistorySample(100, { x: 120, y: 120 }),
      createSwipeHistorySample(250, { x: 210, y: 120 }),
      createSwipeHistorySample(700, { x: 420, y: 120 })
    ];

    expect(__FACE_NOSE_CURSOR_TESTING__.pruneSwipeGestureHistory(history, 700)).toEqual([
      createSwipeHistorySample(250, { x: 210, y: 120 }),
      createSwipeHistorySample(700, { x: 420, y: 120 })
    ]);
  });

  it('calculates swipe angles in screen space and normalizes horizontal deltas', () => {
    expect(__FACE_NOSE_CURSOR_TESTING__.calculateSwipeAngleDeg(200, -100)).toBeCloseTo(26.565, 3);
    expect(Math.abs(__FACE_NOSE_CURSOR_TESTING__.normalizeAngleDeltaDeg(-170, 180))).toBe(10);
    expect(Math.abs(__FACE_NOSE_CURSOR_TESTING__.normalizeAngleDeltaDeg(15, 0))).toBe(15);
  });

  it('rejects swipe candidates that are too slow even when distance and direction match', () => {
    const history: SwipeHistory = [
      createSwipeHistorySample(0, { x: 100, y: 100 }),
      createSwipeHistorySample(450, { x: 300, y: 100 })
    ];

    expect(
      __FACE_NOSE_CURSOR_TESTING__.detectOpenHandSwipeGesture(history, {
        viewportHeight: 800,
        viewportWidth: 1000
      })
    ).toBeNull();
  });

  it('rejects swipe candidates that are not straight enough', () => {
    const history: SwipeHistory = [
      createSwipeHistorySample(0, { x: 100, y: 100 }),
      createSwipeHistorySample(150, { x: 320, y: 280 }),
      createSwipeHistorySample(300, { x: 360, y: 100 })
    ];

    expect(
      __FACE_NOSE_CURSOR_TESTING__.detectOpenHandSwipeGesture(history, {
        viewportHeight: 800,
        viewportWidth: 1000
      })
    ).toBeNull();
  });

  it('prefers Escape over Forward when the swipe also fits the upper-right band', () => {
    const history: SwipeHistory = [
      createSwipeHistorySample(0, { x: 500, y: 400 }),
      createSwipeHistorySample(140, { x: 620, y: 350 }),
      createSwipeHistorySample(280, { x: 720, y: 300 })
    ];

    expect(
      __FACE_NOSE_CURSOR_TESTING__.detectOpenHandSwipeGesture(history, {
        viewportHeight: 800,
        viewportWidth: 1000
      })
    ).toBe('escape');
  });

  it('detects the Escape swipe and dispatches an Escape keydown event', () => {
    const history: SwipeHistory = [
      createSwipeHistorySample(0, { x: 500, y: 400 }),
      createSwipeHistorySample(140, { x: 620, y: 350 }),
      createSwipeHistorySample(280, { x: 720, y: 300 })
    ];
    const keydownListener = vi.fn();
    document.addEventListener('keydown', keydownListener);

    expect(
      __FACE_NOSE_CURSOR_TESTING__.detectOpenHandSwipeGesture(history, {
        viewportHeight: 800,
        viewportWidth: 1000
      })
    ).toBe('escape');

    __FACE_NOSE_CURSOR_TESTING__.dispatchOpenHandSwipeGesture('escape');

    expect(keydownListener).toHaveBeenCalledTimes(1);
    expect((keydownListener.mock.calls[0][0] as KeyboardEvent).key).toBe('Escape');
    document.removeEventListener('keydown', keydownListener);
  });

  it('detects the Go Back swipe and dispatches history.back()', () => {
    const history: SwipeHistory = [
      createSwipeHistorySample(0, { x: 800, y: 300 }),
      createSwipeHistorySample(150, { x: 670, y: 310 }),
      createSwipeHistorySample(320, { x: 540, y: 305 })
    ];
    const backSpy = vi.spyOn(window.history, 'back').mockImplementation(() => {});

    expect(
      __FACE_NOSE_CURSOR_TESTING__.detectOpenHandSwipeGesture(history, {
        viewportHeight: 800,
        viewportWidth: 1000
      })
    ).toBe('back');

    __FACE_NOSE_CURSOR_TESTING__.dispatchOpenHandSwipeGesture('back');

    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  it('detects the Go Forward swipe and dispatches history.forward()', () => {
    const history: SwipeHistory = [
      createSwipeHistorySample(0, { x: 180, y: 260 }),
      createSwipeHistorySample(180, { x: 320, y: 255 }),
      createSwipeHistorySample(340, { x: 440, y: 250 })
    ];
    const forwardSpy = vi.spyOn(window.history, 'forward').mockImplementation(() => {});

    expect(
      __FACE_NOSE_CURSOR_TESTING__.detectOpenHandSwipeGesture(history, {
        viewportHeight: 800,
        viewportWidth: 1000
      })
    ).toBe('forward');

    __FACE_NOSE_CURSOR_TESTING__.dispatchOpenHandSwipeGesture('forward');

    expect(forwardSpy).toHaveBeenCalledTimes(1);
  });

  it('rejects swipes that do not meet the minimum distance', () => {
    const history: SwipeHistory = [
      createSwipeHistorySample(0, { x: 100, y: 220 }),
      createSwipeHistorySample(300, { x: 299, y: 220 })
    ];

    expect(
      __FACE_NOSE_CURSOR_TESTING__.detectOpenHandSwipeGesture(history, {
        viewportHeight: 800,
        viewportWidth: 1000
      })
    ).toBeNull();
  });

  it('rejects swipes that take longer than the maximum duration', () => {
    const history: SwipeHistory = [
      createSwipeHistorySample(0, { x: 100, y: 220 }),
      createSwipeHistorySample(520, { x: 360, y: 220 })
    ];

    expect(
      __FACE_NOSE_CURSOR_TESTING__.detectOpenHandSwipeGesture(history, {
        viewportHeight: 800,
        viewportWidth: 1000
      })
    ).toBeNull();
  });

  it('requires Escape swipes to start in the center zone', () => {
    const history: SwipeHistory = [
      createSwipeHistorySample(0, { x: 100, y: 100 }),
      createSwipeHistorySample(140, { x: 180, y: 50 }),
      createSwipeHistorySample(300, { x: 250, y: 0 })
    ];

    expect(
      __FACE_NOSE_CURSOR_TESTING__.detectOpenHandSwipeGesture(history, {
        viewportHeight: 800,
        viewportWidth: 1000
      })
    ).toBeNull();
  });

  it('resets swipe history when handedness changes or no eligible open hand remains', () => {
    const seededHistory = __FACE_NOSE_CURSOR_TESTING__.updateSwipeGestureHistory({
      history: [],
      now: 0,
      sample: createSwipeHistorySample(0, { x: 100, y: 100 }, 'Left')
    });

    expect(
      __FACE_NOSE_CURSOR_TESTING__.updateSwipeGestureHistory({
        history: seededHistory,
        now: 80,
        sample: createSwipeHistorySample(80, { x: 140, y: 100 }, 'Right')
      })
    ).toEqual([createSwipeHistorySample(80, { x: 140, y: 100 }, 'Right')]);

    expect(
      __FACE_NOSE_CURSOR_TESTING__.updateSwipeGestureHistory({
        history: seededHistory,
        now: 100,
        sample: null
      })
    ).toEqual([]);
  });

  it('blocks swipe tracking during pinch state, without exactly one open hand, and during cooldown', () => {
    expect(
      __FACE_NOSE_CURSOR_TESTING__.shouldTrackOpenHandSwipe({
        anyPinching: true,
        hasActivePinchGesture: false,
        isCalibrated: true,
        lastSwipeGestureAtMs: -Infinity,
        now: 600,
        openHandCount: 1
      })
    ).toBe(false);

    expect(
      __FACE_NOSE_CURSOR_TESTING__.shouldTrackOpenHandSwipe({
        anyPinching: false,
        hasActivePinchGesture: false,
        isCalibrated: true,
        lastSwipeGestureAtMs: -Infinity,
        now: 600,
        openHandCount: 2
      })
    ).toBe(false);

    expect(
      __FACE_NOSE_CURSOR_TESTING__.shouldTrackOpenHandSwipe({
        anyPinching: false,
        hasActivePinchGesture: false,
        isCalibrated: true,
        lastSwipeGestureAtMs: 100,
        now: 900,
        openHandCount: 1
      })
    ).toBe(false);

    expect(__FACE_NOSE_CURSOR_TESTING__.isSwipeGestureCoolingDown(100, 900)).toBe(true);
    expect(__FACE_NOSE_CURSOR_TESTING__.isSwipeGestureCoolingDown(100, 1100)).toBe(false);
  });

  it('selects zoom hands by handedness instead of screen ordering', () => {
    const right = createPointerSample({
      handedness: 'Right',
      screenPoint: { x: 120, y: 40 }
    });
    const left = createPointerSample({
      handedness: 'Left',
      screenPoint: { x: 420, y: 40 }
    });
    const samples = [right, left] as Parameters<typeof __FACE_NOSE_CURSOR_TESTING__.selectPinchingHandsForZoom>[0];

    expect(__FACE_NOSE_CURSOR_TESTING__.selectPinchingHandsForZoom(samples)).toEqual({
      left,
      right
    });
  });
});
