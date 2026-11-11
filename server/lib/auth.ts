import { env } from './env';
import { HttpError } from './http';
import { safeEqual, sha256 } from './crypto';
import { getStore, type ApiScope } from './store';

export interface Principal {
  actor: string;
  scopes: ApiScope[];
}

/**
 * Authenticates `Authorization: Bearer <key>`. Accepts the bootstrap admin key from
 * PROJECTLENS_ADMIN_KEY or an API key created via /api/v1/keys (stored as SHA-256 only).
 * `admin` implies every scope.
 */
export async function authenticate(req: Request, required: ApiScope): Promise<Principal> {
  const header = req.headers.get('authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) {
    throw new HttpError(401, 'unauthorized', 'Missing or malformed Authorization header (expected "Bearer <api key>")');
  }
  const token = match[1];
  const adminKey = env().adminKey;
  let principal: Principal | null = null;
  if (adminKey && safeEqual(token, adminKey)) {
    principal = { actor: 'admin', scopes: ['admin'] };
  } else {
    const key = await getStore().findApiKeyByHash(sha256(token));
    if (key && !key.revokedAt) {
      principal = { actor: `key:${key.name}`, scopes: key.scopes };
      void getStore().touchApiKey(key.id).catch(() => undefined);
    }
  }
  if (!principal) {
    throw new HttpError(401, 'unauthorized', 'Invalid or revoked API key');
  }
  if (!principal.scopes.includes('admin') && !principal.scopes.includes(required)) {
    throw new HttpError(403, 'forbidden', `This API key lacks the "${required}" scope`);
  }
  return principal;
}
