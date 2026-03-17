#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEV_HOST = '127.0.0.1';
const DEV_PORT = 8787;

function printHelp() {
  console.log(`Exocor CLI

Usage:
  exocor dev
`);
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const contents = readFileSync(filePath, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadLocalEnv() {
  const cwd = process.cwd();
  loadEnvFile(resolve(cwd, '.env.local'));
  loadEnvFile(resolve(cwd, '.env'));
}

function toHeaders(nodeHeaders) {
  const headers = new Headers();

  for (const [key, value] of Object.entries(nodeHeaders)) {
    if (Array.isArray(value)) {
      for (const entry of value) {
        headers.append(key, entry);
      }
      continue;
    }

    if (typeof value === 'string') {
      headers.set(key, value);
    }
  }

  return headers;
}

async function loadServerModule() {
  const binDir = resolve(fileURLToPath(new URL('.', import.meta.url)));
  const serverEntryPath = resolve(binDir, '../dist/server/index.js');

  if (!existsSync(serverEntryPath)) {
    console.error('[Exocor] Missing server build output. Reinstall the package or run `npm run build` first.');
    process.exit(1);
  }

  return import(pathToFileURL(serverEntryPath).href);
}

async function startDevRelay() {
  loadLocalEnv();

  const serverModule = await loadServerModule();
  const { createExocorDevRelayHandler } = serverModule;

  if (typeof createExocorDevRelayHandler !== 'function') {
    console.error('[Exocor] The installed package does not include the local relay helper.');
    process.exit(1);
  }

  const handler = createExocorDevRelayHandler({
    debug: process.env.EXOCOR_DEBUG === 'true' || process.env.VITE_EXOCOR_DEBUG === 'true'
  });

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${DEV_HOST}:${DEV_PORT}`);
      const bodyChunks = [];
      for await (const chunk of req) {
        bodyChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const body = Buffer.concat(bodyChunks);
      const method = req.method || 'GET';

      const request = new Request(url.toString(), {
        method,
        headers: toHeaders(req.headers),
        body: method === 'GET' || method === 'HEAD' || body.length === 0 ? undefined : body
      });

      const response = await handler(request);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        res.setHeader(key, value);
      });

      if (!response.body) {
        res.end();
        return;
      }

      Readable.fromWeb(response.body).pipe(res);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          ok: false,
          error: 'Local Exocor relay failed.'
        })
      );

      console.error('[Exocor] Local relay request failed.', error);
    }
  });

  server.on('error', (error) => {
    console.error('[Exocor] Failed to start local relay.', error);
    process.exit(1);
  });

  server.listen(DEV_PORT, DEV_HOST, () => {
    console.log(`[Exocor] Local relay listening on http://${DEV_HOST}:${DEV_PORT}`);
    console.log(`[Exocor] Browser health probe: http://${DEV_HOST}:${DEV_PORT}/health`);

    if (!process.env.ANTHROPIC_API_KEY) {
      console.warn('[Exocor] ANTHROPIC_API_KEY is missing. The relay will return safe errors until you configure it.');
    }
  });
}

const [, , command] = process.argv;

if (!command || command === 'help' || command === '--help' || command === '-h') {
  printHelp();
  process.exit(0);
}

if (command === 'dev') {
  await startDevRelay();
} else {
  printHelp();
  process.exit(1);
}
