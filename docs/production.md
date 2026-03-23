# Production Setup

Production apps should keep `ANTHROPIC_API_KEY` on the server and expose a resolver route that the browser can call safely.

## Default Route
Mount a same-origin route such as `/api/exocor/resolve`:

```ts
import { createExocorResolverEndpoint } from 'exocor/server';

const handleExocorResolver = createExocorResolverEndpoint();

export async function POST(request: Request) {
  return handleExocorResolver(request);
}
```

With the default route in place, the normal wrapper stays the same:

```tsx
import { SpatialProvider } from 'exocor';

<SpatialProvider>
  <App />
</SpatialProvider>
```

If your app registers provider-level tools and those handlers depend on app state, keep your own providers above `SpatialProvider` and wrap the routed UI inside it:

```tsx
import { SpatialProvider } from 'exocor';
import { RouterProvider } from 'react-router';
import { router } from './router';
import { AppProviders } from './providers';
import { useWorkspaceTools } from './useWorkspaceTools';

function AppShell() {
  const tools = useWorkspaceTools();

  return (
    <SpatialProvider tools={tools}>
      <RouterProvider router={router} />
    </SpatialProvider>
  );
}

export default function Root() {
  return (
    <AppProviders>
      <AppShell />
    </AppProviders>
  );
}
```

## Custom Route
If your backend route lives elsewhere, pass `backendUrl`:

```tsx
<SpatialProvider backendUrl="/internal/exocor/resolve">
  <App />
</SpatialProvider>
```

## Resolver Operations
Exocor sends JSON `POST` requests with one of these operations:

- `initial_stream`
- `resolve`
- `preferred_tool_intent`
- `preferred_tool_retry`
- `failed_step`
- `new_elements`
- `follow_up`

`initial_stream` responds with NDJSON lines:

```json
{"type":"step","step":{}}
{"type":"result","result":{}}
{"type":"error","message":"..."}
```

The helper exported by `exocor/server` already implements this contract, including the preferred-tool argument resolution and retry operations.
