import { z } from 'zod';

/** Error with an HTTP status and machine-readable code; rendered as `{ error: { code, message } }`. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(), ...headers }
  });
}

export function corsHeaders(): Record<string, string> {
  // Browser access is opt-in (server-to-server calls are the expected integration).
  const origin = process.env.CORS_ALLOW_ORIGIN;
  return origin
    ? { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS' }
    : {};
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) {
    return json({ error: { code: err.code, message: err.message, details: err.details } }, err.status);
  }
  if (err instanceof z.ZodError) {
    return json({ error: { code: 'invalid_request', message: 'Request validation failed', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } }, 400);
  }
  console.error('[projectlens-api] unexpected error', err);
  return json({ error: { code: 'internal_error', message: 'Unexpected server error' } }, 500);
}

export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  let body: unknown = {};
  const text = await req.text();
  if (text.trim()) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON');
    }
  }
  return schema.parse(body);
}

/** Wraps a route handler with consistent error handling. Routes without params take no context argument. */
export function handle<C = undefined>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ...rest: C extends undefined ? [] : [C]): Promise<Response> => {
    try {
      return await fn(req, rest[0] as C);
    } catch (err) {
      return errorResponse(err);
    }
  };
}
