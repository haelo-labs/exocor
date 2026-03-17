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

## Isolation
- Exocor UI is rendered in a shadow root to prevent host CSS leakage.
- SDK-owned elements are excluded from DOM scanning and app-map discovery.
- Persisted chat history is scoped per host app so different localhost apps do not share history.
