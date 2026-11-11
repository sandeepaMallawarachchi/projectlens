import { env } from './env';
import { HttpError } from './http';
import { safeEqual, sha256 } from './crypto';
import { getStore, type ApiScope, type Role, type SessionRecord, type UserRecord } from './store';

export interface Principal {
  kind: 'session' | 'apiKey' | 'admin';
  /** Recorded as `triggeredBy` on scans. */
  actor: string;
  userId: string | null;
  orgId: string;
  role: Role | null;
  scopes: ApiScope[];
}

const ROLE_SCOPES: Record<Role, ApiScope[]> = {
  owner: ['read', 'scan', 'ai', 'admin'],
  admin: ['read', 'scan', 'ai', 'admin'],
  member: ['read', 'scan', 'ai']
};

function bearer(req: Request): string {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '');
  if (!match) {
    throw new HttpError(401, 'unauthorized', 'Missing or malformed Authorization header (expected "Bearer <token>")');
  }
  return match[1];
}

async function sessionFor(token: string): Promise<{ session: SessionRecord; user: UserRecord }> {
  const store = getStore();
  const session = await store.findSessionByHash(sha256(token));
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() < Date.now()) {
    throw new HttpError(401, 'unauthorized', 'Session expired or signed out. Sign in again.');
  }
  const user = await store.getUser(session.userId);
  if (!user) {
    throw new HttpError(401, 'unauthorized', 'User no longer exists');
  }
  void store.touchSession(session.id).catch(() => undefined);
  return { session, user };
}

/** For account-level endpoints (/me, /orgs): requires a signed-in user session. */
export async function authenticateUser(req: Request): Promise<{ session: SessionRecord; user: UserRecord }> {
  const token = bearer(req);
  if (!token.startsWith('pls_')) {
    throw new HttpError(401, 'unauthorized', 'This endpoint requires a signed-in user session');
  }
  return sessionFor(token);
}

/**
 * Authenticates an organization-scoped request:
 * - `pls_…` user session (extension): organization from the `X-ProjectLens-Org` header, or the user's first organization; scopes from the member role.
 * - `plk_…` API key: the key's organization and scopes.
 * - The platform admin key (PROJECTLENS_ADMIN_KEY): any organization given in `X-ProjectLens-Org` (operations only).
 * The `admin` scope means organization administration (keys, members, AI keys).
 */
export async function authenticate(req: Request, required: ApiScope): Promise<Principal> {
  const token = bearer(req);
  const store = getStore();
  const orgHeader = req.headers.get('x-projectlens-org');
  let principal: Principal;

  if (token.startsWith('pls_')) {
    const { user } = await sessionFor(token);
    const memberships = await store.listMembershipsForUser(user.id);
    const membership = orgHeader ? memberships.find((m) => m.orgId === orgHeader) : memberships[0];
    if (!membership) {
      throw new HttpError(orgHeader ? 403 : 400, orgHeader ? 'forbidden' : 'no_organization', orgHeader ? 'You are not a member of this organization' : 'Create or join an organization first');
    }
    principal = { kind: 'session', actor: `user:${user.githubLogin ?? user.email ?? user.id}`, userId: user.id, orgId: membership.orgId, role: membership.role, scopes: ROLE_SCOPES[membership.role] };
  } else if (token.startsWith('plk_')) {
    const key = await store.findApiKeyByHash(sha256(token));
    if (!key || key.revokedAt) {
      throw new HttpError(401, 'unauthorized', 'Invalid or revoked API key');
    }
    if (orgHeader && orgHeader !== key.orgId) {
      throw new HttpError(403, 'forbidden', 'API keys can only access their own organization');
    }
    void store.touchApiKey(key.id).catch(() => undefined);
    principal = { kind: 'apiKey', actor: `key:${key.name}`, userId: null, orgId: key.orgId, role: null, scopes: key.scopes };
  } else {
    const adminKey = env().adminKey;
    if (!adminKey || !safeEqual(token, adminKey)) {
      throw new HttpError(401, 'unauthorized', 'Invalid token');
    }
    if (!orgHeader || !(await store.getOrg(orgHeader))) {
      throw new HttpError(400, 'organization_required', 'The admin key must specify an existing organization in the X-ProjectLens-Org header');
    }
    principal = { kind: 'admin', actor: 'platform-admin', userId: null, orgId: orgHeader, role: 'owner', scopes: ROLE_SCOPES.owner };
  }

  if (!principal.scopes.includes('admin') && !principal.scopes.includes(required)) {
    throw new HttpError(403, 'forbidden', `Missing the "${required}" permission`);
  }
  return principal;
}
