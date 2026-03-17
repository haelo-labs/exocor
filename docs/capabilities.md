# Capabilities

## Voice
- Uses the browser Web Speech API for speech recognition.
- Supports spoken commands and spoken clarification follow-ups.
- Shows transcript and status feedback inside the SDK UI.

## Gaze
- Uses MediaPipe face tracking and nose position to drive a cursor.
- Maps gaze to the nearest interactive host element.
- Surfaces live gaze state through `useGaze()`.

## Gesture
- Uses MediaPipe hand tracking.
- Supports pinch-based click and drag interactions.
- Surfaces live gesture state through `useGesture()`.

## Planning And Execution
- Builds an app map of routes, buttons, forms, tabs, filters, and reusable modal surfaces.
- Prefers app-map-aware planning first, then uses live DOM execution where needed.
- Supports streamed planning, clarification, stale-map refresh, and dynamic follow-up steps.

## SDK UI
- Renders chat, toasts, learning overlay, voice transcript, gaze overlay, and floating clarification UI.
- Uses a shadow root so host CSS does not restyle the SDK.
- Excludes SDK UI from DOM scanning and app-map discovery.

## Hooks
- `useVoice()`
- `useGaze()`
- `useGesture()`
- `useIntent()`
- `useDOMMap()`
