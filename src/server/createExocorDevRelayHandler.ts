import { createExocorResolverEndpoint, type ExocorResolverEndpointOptions } from './createExocorResolverEndpoint';

export interface ExocorDevRelayHandlerOptions extends ExocorResolverEndpointOptions {
  allowedOrigins?: string[];
}

const HEALTH_PATH = '/health';
const RESOLVER_PATH = '/api/exocor/resolve';

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

function isAllowedLocalOrigin(origin: string, allowedOrigins: string[]): boolean {
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  try {
    const url = new URL(origin);
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

function buildCorsHeaders(request: Request, allowedOrigins: string[]): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  });
  const origin = request.headers.get('Origin');

  if (!origin) {
    headers.set('Access-Control-Allow-Origin', '*');
  } else if (isAllowedLocalOrigin(origin, allowedOrigins)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

function withCors(response: Response, request: Request, allowedOrigins: string[]): Response {
  const headers = new Headers(response.headers);
  const corsHeaders = buildCorsHeaders(request, allowedOrigins);
  corsHeaders.forEach((value, key) => {
    headers.set(key, value);
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function resolveApiKey(options: ExocorResolverEndpointOptions): string {
  return options.apiKey || process.env.ANTHROPIC_API_KEY || '';
}

export function createExocorDevRelayHandler(options: ExocorDevRelayHandlerOptions = {}) {
  const resolverHandler = createExocorResolverEndpoint(options);
  const allowedOrigins = options.allowedOrigins || [];

  return async function handleExocorDevRelay(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === 'OPTIONS' && pathname === RESOLVER_PATH) {
      return withCors(new Response(null, { status: 204 }), request, allowedOrigins);
    }

    if (request.method === 'GET' && pathname === HEALTH_PATH) {
      const apiKey = resolveApiKey(options);
      const response = apiKey
        ? jsonResponse({
            ok: true,
            data: {
              status: 'ready'
            }
          })
        : jsonResponse(
            {
              ok: false,
              error: 'ANTHROPIC_API_KEY is not configured on the local Exocor relay.'
            },
            503
          );

      return withCors(response, request, allowedOrigins);
    }

    if (pathname === RESOLVER_PATH) {
      return withCors(await resolverHandler(request), request, allowedOrigins);
    }

    return withCors(jsonResponse({ ok: false, error: 'Not found.' }, 404), request, allowedOrigins);
  };
}
