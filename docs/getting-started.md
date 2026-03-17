# Getting Started

## Install
```bash
npm install exocor
```

Peer dependencies:
- `react >= 18`
- `react-dom >= 18`

## Smallest Integration
```tsx
import { SpatialProvider } from 'exocor';

<SpatialProvider>
  <App />
</SpatialProvider>
```

## Full Example
```tsx
import { createRoot } from 'react-dom/client';
import { SpatialProvider } from 'exocor';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <SpatialProvider>
    <App />
  </SpatialProvider>
);
```

## What Happens At Runtime
1. Exocor mounts its UI in an isolated shadow root so host styles do not leak into the SDK.
2. It scans the host app and builds an app map describing routes, actions, forms, and reusable surfaces.
3. It sends planning requests to a secure resolver endpoint.
4. It executes DOM steps against the live page and asks for clarification when the intent is ambiguous.

## Next Steps
- For localhost testing, read [Local Development](local-development.md).
- For deployment, read [Production Setup](production.md).
- For the interaction model, read [Capabilities](capabilities.md).
