# Exocor

> Multimodal, app-aware control for existing React apps.

Exocor is an open-source React SDK that runs inside the host app and turns typed, voice, gaze, and gesture intent into app-aware actions. It builds a learned model of the live UI, can use explicit app-native tools registered through `SpatialProvider`, and executes safely against the host app instead of from an external browser agent.

## Why Exocor

Most browser agents work from outside the app and mainly see rendered pages. Exocor runs inside the React tree, so it can plan with richer context:

- current route and visible UI structure
- focused element and gaze context
- a cached or discovered app map of routes, forms, buttons, tabs, filters, and reusable surfaces
- explicit app-native tools you register locally in the host app

Exocor is intentionally hybrid:

1. learned app model
2. explicit app-native tools
3. live DOM fallback when needed

That means tools are additive, not a replacement for discovery. Exocor can learn the app, prefer a trusted explicit action when one clearly fits, and still fall back to app-map-aware or DOM execution when that is the better path.

## What Ships In 0.2.x

- `SpatialProvider` as the main runtime wrapper
- typed, voice, gaze, and pinch-based interaction in one command pipeline
- runtime modality toggles in the chat panel, with per-app preference persistence
- provider-level explicit tools with route affinity, safety metadata, and argument schemas
- streamed planning with clarification, stale-map refresh, and dynamic follow-up steps
- authoritative execution for a uniquely strong preferred tool when Exocor can use it safely
- refreshed SDK UI with command history, floating clarification, transcript, toasts, and cooperative stop
- server helpers for the resolver endpoint and the local development relay

## Install

```bash
npm install exocor
```

Peer dependencies:

- `react >= 18`
- `react-dom >= 18`

## Try The Demos

If you want to try Exocor in a real app right away, these demo repos already wire the npm package into runnable examples:

- [Haelo Ops Demo](https://github.com/haelo-labs/haelo-ops-demo)
- [3D Viewer Demo](https://github.com/haelo-labs/3d-viewer-demo)

## Smallest Integration

`SpatialProvider` should wrap the host UI subtree Exocor needs to observe and control. It does not need to be the outermost provider in your app.

```tsx
import { SpatialProvider } from 'exocor';

export default function App() {
  return (
    <SpatialProvider>
      <YourApp />
    </SpatialProvider>
  );
}
```

Use this when you want the SDK around the app UI without registering explicit tools yet.

`SpatialProvider.modalities` controls which modalities are available, not which ones must stay on. Users can toggle any available modality from the SDK chat panel at runtime. When both gaze and gesture are available, gesture depends on gaze: turning gaze off also turns gesture off, while turning gesture back on will reactivate gaze.

## Context And Trust Controls

Exocor now lets you shape resolver payloads without turning discovery or tools off by default.

- `contextPolicy` controls how much context Exocor sends and which sections are eligible.
- `trustPolicy` controls which parts of the app are scanned, which parts are sent, and which higher-risk inference paths stay enabled.
- Safe defaults stay close to current behavior: `mode: 'full'`, all sections on `auto`, and all trust features enabled.

```tsx
import { SpatialProvider } from 'exocor';

export default function App() {
  return (
    <SpatialProvider
      contextPolicy={{
        mode: 'balanced',
        maxContextTokens: 1800,
        sections: {
          appMap: 'always',
          liveDom: 'auto',
          dialogs: 'auto',
          forms: 'auto',
          tablesAndLists: 'never',
          tools: 'always'
        }
      }}
      trustPolicy={{
        features: {
          remoteResolver: true,
          appMapDiscovery: true,
          liveDomScanning: true,
          reactHints: true,
          routerHints: true,
          tools: true
        },
        neverScan: ['[data-exocor-private]'],
        neverSend: ['[data-pii]'],
        redact: [
          {
            selector: 'input[name="ssn"]',
            fields: ['label', 'value', 'placeholder']
          }
        ]
      }}
    >
      <YourApp />
    </SpatialProvider>
  );
}
```

- `mode: 'full'` preserves the current broadest planning shape.
- `mode: 'balanced'` keeps the same core signals but trims lower-value detail first.
- `mode: 'lean'` pushes harder on payload size while still preserving route, tool, dialog, and active form context when relevant.
- `maxContextTokens` is a soft budget. Exocor shrinks sections in priority order before it drops them.
- `neverScan` keeps matching subtrees out of live DOM scans and app-map discovery.
- `neverSend` allows local execution to keep using a subtree while stripping it from remote resolver payloads.
- `redact` masks specific fields before resolver requests are sent.
- `features.remoteResolver`, `appMapDiscovery`, `liveDomScanning`, `reactHints`, `routerHints`, and `tools` let you disable specific paths without removing the rest of the product.

## Tool-Enabled Integration

If your handlers depend on router helpers, app state, or domain actions, keep your own providers above `SpatialProvider` and pass tools into the provider that wraps the routed UI.

```tsx
import { SpatialProvider, type ExocorToolDefinition } from 'exocor';
import { RouterProvider } from 'react-router';
import { router } from './router';
import { useTicketActions } from './tickets';

function useWorkspaceTools(): ExocorToolDefinition[] {
  const { createTicket } = useTicketActions();

  return [
    {
      id: 'goToTickets',
      description: 'Go to the tickets view',
      safety: 'read',
      handler: async () => {
        await router.navigate('/tickets');
      }
    },
    {
      id: 'createTicket',
      description: 'Create a ticket',
      routes: ['/tickets'],
      safety: 'write',
      parameters: [
        {
          name: 'title',
          description: 'Ticket title',
          type: 'string',
          required: true
        }
      ],
      handler: async ({ title }) => {
        await createTicket({ title: String(title) });
      }
    }
  ];
}

export default function App() {
  const tools = useWorkspaceTools();

  return (
    <SpatialProvider tools={tools}>
      <RouterProvider router={router} />
    </SpatialProvider>
  );
}
```

Global tools stay available everywhere. Route-specific tools remain planner-visible even when the user is elsewhere, so Exocor can navigate first and then invoke the app-native action when that is the safest path.

## Runtime Model

At runtime Exocor:

1. mounts its SDK UI in a shadow root so host CSS does not leak into it
2. scans the wrapped UI and builds runtime context plus a reusable app map
3. registers any explicit tools passed to `SpatialProvider`
4. shapes and sends planning requests to a resolver route you run locally or on your backend
5. executes explicit tools, app-map-aware steps, or DOM steps depending on what best fits the command
6. can stop an active run cooperatively from the SDK chat UI without rolling back host actions that already completed

When `debug` is enabled, Exocor logs a lightweight resolver context report with estimated token usage, included sections, and anything dropped or redacted. Raw resolver context is not logged by default.

## Local Development

For localhost testing, run the relay from your app root:

```bash
npx exocor dev
```

The relay listens on `127.0.0.1:8787`. When Exocor detects that relay on localhost, the browser runtime can use it automatically.

## Production Setup

Keep `ANTHROPIC_API_KEY` on the server and mount a same-origin resolver route such as `/api/exocor/resolve`:

```ts
import { createExocorResolverEndpoint } from 'exocor/server';

const handleExocorResolver = createExocorResolverEndpoint();

export async function POST(request: Request) {
  return handleExocorResolver(request);
}
```

If your resolver route lives elsewhere, pass `backendUrl` to `SpatialProvider`.

## Package Surface

Main package exports:

- `SpatialProvider`
- `useVoice()`
- `useGaze()`
- `useGesture()`
- `useIntent()`
- `useDOMMap()`
- provider, intent, app-map, modality, tool, context-policy, and trust-policy types from `src/types`

Server exports:

- `createExocorResolverEndpoint`
- `createExocorDevRelayHandler`

## Docs

- [Getting started](./docs/getting-started.md)
- [Local development](./docs/local-development.md)
- [Production setup](./docs/production.md)
- [Capabilities](./docs/capabilities.md)
- [Security model](./docs/security.md)

## Current Status

Exocor 0.2 is an honest early release: low-config, inference-heavy, and strongest today for demos, internal tools, design-partner environments, and product exploration. The value is that it can layer onto an existing React app without requiring a full rewrite, while still leaving room for more explicit trusted execution paths over time.

## Open Source

MIT licensed.

- GitHub: [github.com/haelo-labs/exocor](https://github.com/haelo-labs/exocor)
- Site: [exocor.dev](https://exocor.dev)
