# Getting Started

## Install
```bash
npm install exocor
```

Peer dependencies:
- `react >= 18`
- `react-dom >= 18`

## Core Rule

`SpatialProvider` should wrap the host UI subtree Exocor needs to observe and control.
It does not need to be the outermost provider in your app.

## Smallest Integration
```tsx
import { SpatialProvider } from 'exocor';

<SpatialProvider>
  <App />
</SpatialProvider>
```

Use this when you just want the SDK around the app UI.

`SpatialProvider.modalities` controls which modalities are available. Users can toggle available voice, gaze, and gesture from the SDK chat panel at runtime, and those choices persist per app scope. When both gaze and gesture are exposed, gesture depends on gaze, so turning gaze off also turns gesture off.

## Trust Controls

Exocor already keeps resolver requests compact by default. Use `trustPolicy` when you need stricter control over scanning, sending, redaction, or specific feature paths.

```tsx
<SpatialProvider
  trustPolicy={{
    neverScan: ['[data-exocor-private]'],
    neverSend: ['[data-pii]'],
    redact: [
      {
        selector: 'input[name="ssn"]',
        fields: ['value', 'label']
      }
    ]
  }}
>
  <App />
</SpatialProvider>
```

- Exocor internally budgets and compacts route, tool, runtime, app-map, and live DOM context before each resolver call.
- `neverScan` excludes matching subtrees from live DOM scans and app-map discovery.
- `neverSend` strips matching subtrees from remote resolver payloads while still allowing local execution paths to use them.
- `redact` masks specific labels, values, placeholders, and names before requests are sent.
- `trustPolicy.features` can disable `remoteResolver`, `appMapDiscovery`, `liveDomScanning`, `reactHints`, `routerHints`, or `tools`.

## Recommended Tool-Enabled Integration

If your tool handlers depend on app state, router helpers, or domain actions, keep those providers above `SpatialProvider` and render your routed UI inside it.

```tsx
import { createRoot } from 'react-dom/client';
import App from './app/App';
import { AppProviders } from './app/providers';

createRoot(document.getElementById('root')!).render(
  <AppProviders>
    <App />
  </AppProviders>
);
```

```tsx
import { SpatialProvider, type ExocorToolDefinition } from 'exocor';
import { RouterProvider } from 'react-router';
import { router } from './router';
import { useWorkspaceTools } from './useWorkspaceTools';

export default function App() {
  const tools: ExocorToolDefinition[] = useWorkspaceTools();

  return (
    <SpatialProvider tools={tools}>
      <RouterProvider router={router} />
    </SpatialProvider>
  );
}
```

This is the recommended shape for apps that register provider-level tools.

## What Happens At Runtime
1. Exocor mounts its UI in an isolated shadow root so host styles do not leak into the SDK.
2. It scans the host app and builds an app map describing routes, actions, forms, and reusable surfaces.
3. It registers any explicit tools passed to `SpatialProvider`.
4. It sends planning requests to a secure resolver endpoint.
5. It can execute app-native tools, app-map-aware steps, and DOM steps depending on what best fits the command.
6. It asks for clarification when the intent or required arguments are ambiguous.

## Tool Behavior Today

- Exact no-arg tools with a unique match can execute directly.
- A unique strong preferred tool can become the authoritative path if Exocor can safely resolve its required arguments.
- If arguments are ambiguous or the tool cannot safely cover the task, Exocor falls back to clarification, normal planning, app-map execution, and DOM execution as needed.

## Next Steps
- For localhost testing, read [Local Development](local-development.md).
- For deployment, read [Production Setup](production.md).
- For the interaction model, read [Capabilities](capabilities.md).
