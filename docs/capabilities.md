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
- Supports streamed planning, clarification, stale-map refresh, dynamic follow-up steps, and cooperative stop from the SDK chat UI.

## Explicit Tools
- Supports provider-level app-native tools passed to `SpatialProvider`.
- Tools can be global or route-specific.
- Route-specific tools remain visible even when the current route is different.
- Tool handlers stay local to the host app and are not sent to the resolver.

## Execution Model Today
- Exact no-arg tool shortcuts can execute directly when they uniquely match.
- A unique strong preferred tool can become the authoritative execution path if Exocor can resolve and validate its required arguments safely.
- When a route-specific preferred tool is off-route, Exocor can navigate first and then invoke the tool.
- If a tool is ambiguous, missing required arguments, or cannot safely cover the task, Exocor falls back to clarification, planner-led app-map execution, and DOM execution as needed.

## SDK UI
- Renders chat, toasts, learning overlay, voice transcript, gaze overlay, and floating clarification UI.
- Lets the user stop an active resolve or execute run from the chat panel without changing already-completed host actions.
- Uses a shadow root so host CSS does not restyle the SDK.
- Excludes SDK UI from DOM scanning and app-map discovery.

## Hooks
- `useVoice()`
- `useGaze()`
- `useGesture()`
- `useIntent()`
- `useDOMMap()`
