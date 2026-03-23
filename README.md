# Exocor

> Multimodal control for existing React apps.

Exocor is an open-source React SDK that runs inside the host app and turns voice, gaze, gesture, and typed intent into app-aware actions. It builds runtime context, discovers an app map, and can also invoke explicit app-native tools registered through `SpatialProvider`.

Note: `main` and this README reflect the upcoming `v0.2.0` release. `npm install exocor` still points to the previous stable release until `0.2.0` is published.

## Why Exocor

Most browser agents operate from outside the app and mainly see a rendered page. Exocor runs inside the React tree, so it can plan with better context: current route, visible UI, discovered app structure, focus and gaze signals, and explicit app-native tools when you expose them.

Exocor is intentionally hybrid:

1. learned app model
2. explicit app-native tools
3. DOM fallback when needed

That means tools are additive, not a replacement for bootstrap and discovery. Exocor can learn the app first, use explicit actions when they are the safer path, and still fall back to the live UI when needed. It does not depend on arbitrary React state access, and it does not claim a zero-DOM runtime.

## Quick Start

```bash
npm install exocor
```

Peer dependencies:

- `react >= 18`
- `react-dom >= 18`

`SpatialProvider` should wrap the UI subtree Exocor needs to observe and control.

```tsx
import { SpatialProvider } from 'exocor'

export default function App() {
  return (
    <SpatialProvider>
      <YourApp />
    </SpatialProvider>
  )
}
```

For local development, run `npx exocor dev` from your app root. For production, mount the Exocor resolver endpoint on your backend.

## Tool-Enabled Integration

If your handlers need router helpers, domain actions, or host app state, keep those providers above `SpatialProvider` and pass tools into the provider that wraps the routed UI.

```tsx
import { SpatialProvider, type ExocorToolDefinition } from 'exocor'
import { RouterProvider } from 'react-router'
import { router } from './router'
import { useTicketActions } from './tickets'

function useWorkspaceTools(): ExocorToolDefinition[] {
  const { createTicket } = useTicketActions()

  return [
    {
      id: 'goToTickets',
      description: 'Go to the tickets view',
      safety: 'read',
      handler: async () => {
        await router.navigate('/tickets')
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
        await createTicket({ title: String(title) })
      }
    }
  ]
}

export default function App() {
  const tools = useWorkspaceTools()

  return (
    <SpatialProvider tools={tools}>
      <RouterProvider router={router} />
    </SpatialProvider>
  )
}
```

Global tools are available from anywhere. Route-specific tools stay visible to planning even when the user is elsewhere, so Exocor can navigate first and then invoke the app-native action when that is the better path.

## How It Works

On mount, Exocor scans the wrapped subtree, builds runtime context, and discovers a reusable app map of routes, surfaces, actions, and interactive elements.

When a command arrives, Exocor resolves it against the learned app model and any registered tools. If a safe explicit tool clearly fits, Exocor can execute it directly. Otherwise it plans against the learned app structure and falls back to DOM execution when needed.

The local development path uses `npx exocor dev` as a relay. Production integrations mount the resolver endpoint on your backend and keep execution inside the host app.

## Security Model

Exocor keeps control logic in the host app and sends structured runtime context to a resolver you run locally or on your backend. By default it works from discovered UI structure, route context, focus and gaze signals, and compressed capability data rather than arbitrary React state dumps. Explicit tool calls are validated locally before handler execution.

See the production and security docs for the exact backend shape and data flow boundaries.

## Current Status

Exocor is early. Today it is low-config, inference-heavy, and best suited to demos, internal tools, experimental deployments, and early design-partner work. It is promising precisely because it does not require a full app rewrite, but it is not positioned yet as a broad production rollout for every React surface.

## Docs

- [Getting started](./docs/getting-started.md)
- [Local development](./docs/local-development.md)
- [Production setup](./docs/production.md)
- [Capabilities](./docs/capabilities.md)
- [Security model](./docs/security.md)

## Open Source

MIT licensed.

- GitHub: [github.com/haelo-labs/exocor](https://github.com/haelo-labs/exocor)
- Site: [exocor.dev](https://exocor.dev)
- If Exocor is useful to you, please [star the repo](https://github.com/haelo-labs/exocor)
