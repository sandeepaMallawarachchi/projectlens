import { corsHeaders } from './http';

/** CORS preflight (only meaningful when CORS_ALLOW_ORIGIN is set). */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export type Params<T extends string> = { params: Promise<Record<T, string>> };
