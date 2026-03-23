# Local Development

Exocor ships with a local relay so you can test without exposing your Anthropic key to the browser.

## Setup
1. Put `ANTHROPIC_API_KEY` in the host app root:

```bash
ANTHROPIC_API_KEY=...
```

2. In one terminal, run:

```bash
npx exocor dev
```

3. In another terminal, run your host app normally:

```bash
npm run dev
```

## How It Works
- Exocor probes `http://127.0.0.1:8787/health` when the host app is running on `localhost` or `127.0.0.1`.
- If the relay is healthy, Exocor sends resolver requests to `http://127.0.0.1:8787/api/exocor/resolve`.
- The Anthropic key stays inside the local relay process, not in the browser.
- `npx exocor dev` serves the built server output from the installed package, not live TypeScript source.

## Important Notes
- Run `npx exocor dev` from the host app root so it can read that app's `.env.local` or `.env`.
- You do not need a Vite proxy for normal localhost usage.
- If you are testing an unpublished local SDK, rebuild it before starting or restarting the relay:

```bash
npm run build
```

- If port `8787` is already occupied, stop the old relay before starting a fresh one.
- After any local SDK change that affects resolver behavior, rebuild the SDK and restart the relay so the new `dist` output is actually running.
