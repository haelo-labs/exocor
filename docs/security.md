# Security Model

## Browser Keys Are Not Supported
Exocor does not accept an Anthropic API key in the browser.

That means:
- no `apiKey` prop
- no frontend `VITE_ANTHROPIC_API_KEY`
- no `window` global key injection
- no localStorage-based key flow

## Local Development
For localhost testing, Exocor provides `npx exocor dev`.

- The relay reads `ANTHROPIC_API_KEY` from the host app environment.
- The browser talks to the relay.
- The real model key stays out of the frontend bundle.

## Production
In production, the host app should expose a secure backend route, typically `/api/exocor/resolve`, using `createExocorResolverEndpoint`.

## Context Controls
- `contextPolicy` lets developers set a planning mode, apply a soft token budget, and force or suppress specific payload sections such as app-map summaries, live DOM details, dialogs, forms, tables/lists, gaze, selected text, and tools.
- Default behavior stays close to the current product shape. Exocor compresses and prioritizes context before dropping it.

## Trust Controls
- `trustPolicy.neverScan` excludes matching subtrees from live DOM scanning and app-map discovery.
- `trustPolicy.neverSend` strips matching subtrees from resolver payloads and debug reports while still allowing local execution paths to use them.
- `trustPolicy.redact` masks selected labels, values, placeholders, names, and related fields before requests are sent.
- `trustPolicy.features.remoteResolver` can disable remote planning entirely.
- `trustPolicy.features.appMapDiscovery`, `liveDomScanning`, `reactHints`, `routerHints`, and `tools` let developers disable specific discovery or inference paths without removing the rest of Exocor.

## Isolation
- Exocor UI is rendered in a shadow root to prevent host CSS leakage.
- SDK-owned elements are excluded from DOM scanning and app-map discovery.
- Persisted chat history is scoped per host app so different localhost apps do not share history.

## Debug Logging
- With `debug` enabled, Exocor logs a lightweight resolver context report with estimated token usage, included sections, and anything dropped or redacted.
- Raw resolver context is not logged by default.
