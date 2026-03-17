# Exocor

![VideoProject2-ezgif com-video-to-gif-converter (1)](https://github.com/user-attachments/assets/734b67b5-c2f2-4c73-999f-1bb871e78713)

> **Control your app without touching it.**
>
> Voice, gaze, and gesture control for React apps.
> One component. No rewrites.

---

## Install

```bash
npm install exocor
```

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

> That's it.

---

## What you can do

Instead of clicking around, users can:

- Look at a row -> **"Open this"**
- Say -> **"Navigate to equipment"**
- Say -> **"Create ticket"**
- Look at a field -> **"Edit this"**

And for more complex actions:

- **"Create a ticket for this issue"**
- **"Show me last month"**

---

## Examples

> These are real apps using Exocor - not mocked demos.

- **Ops Field Demo (CRM)**  
  Navigation, ticket creation, real workflows  
  [github.com/haelo-labs/haelo-ops-demo](https://github.com/haelo-labs/haelo-ops-demo)

- **3D Viewer Demo (V8 engine)**  
  Gesture control, zoom, rotation, material changes  
  [github.com/haelo-labs/3d-viewer-demo](https://github.com/haelo-labs/3d-viewer-demo)

---

## How it works

Exocor runs **inside your React app**.

It has access to:

- component state
- routing
- visible UI
- app structure

So it doesn't rely on screenshots or DOM guessing - it actually understands what's on screen.

Most AI agents operate outside the app.
Exocor lives inside it.

---

## Multimodal input

- Voice -> intent
- Gaze -> context ("this")
- Gesture -> control (click, drag, zoom)

Works with a standard webcam. No hardware required.

---

## Getting started

### Local development

```bash
# 1. Set your Anthropic key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# 2. Start the local relay
npx exocor dev

# 3. Run your app
npm run dev
```

---

### Production

```ts
import { createExocorResolverEndpoint } from 'exocor/server'

export async function POST(request: Request) {
  return createExocorResolverEndpoint()(request)
}
```

Your API key never touches the browser.

---

## When this is useful

- Internal tools / dashboards
- Admin panels
- CRM / ERP systems
- Healthcare interfaces
- Industrial / field applications

Anywhere a mouse and keyboard are not the best interface.

---

## Status

> v0.1 - early, experimental, and evolving.

Some interactions are instant (navigation, selection).
More complex actions use an LLM and may take a few seconds.

---

## Open source

MIT licensed. Free forever.

[exocor.dev](https://exocor.dev)
