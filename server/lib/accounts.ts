import { randomBytes, randomInt } from 'node:crypto';
import { env } from './env';
import { HttpError } from './http';
import { safeEqual, sha256 } from './crypto';
import { sendEmail, emailEnabled } from './email';
import { getStore, type OrgRecord, type Role, type UserRecord } from './store';

const SESSION_DAYS = 90;
const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_CODES_PER_HOUR = 5;

let fetcher: typeof fetch | null = null;
/** Test hook for GitHub API calls. */
export function setAccountsFetcher(f: typeof fetch | null): void {
  fetcher = f;
}

export interface SignInResult {
  token: string;
  expiresAt: string;
  user: UserRecord;
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

async function createSession(user: UserRecord, label: string | null): Promise<SignInResult> {
  const token = `pls_${randomBytes(32).toString('base64url')}`;
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 3600 * 1000).toISOString();
  await getStore().createSession({ userId: user.id, tokenHash: sha256(token), label, expiresAt });
  return { token, expiresAt, user };
}

/** Joins organizations the user was invited to (by verified email). */
export async function acceptPendingInvitations(user: UserRecord): Promise<number> {
  if (!user.email || !user.emailVerified) {
    return 0;
  }
  const store = getStore();
  const invitations = await store.listPendingInvitationsForEmail(user.email);
  for (const inv of invitations) {
    if (!(await store.getMembership(inv.orgId, user.id))) {
      await store.addMembership({ orgId: inv.orgId, userId: user.id, role: inv.role });
    }
    await store.acceptInvitation(inv.id);
  }
  return invitations.length;
}

/** Every user has at least one organization; the first sign-in creates a personal one. */
async function ensureOrganization(user: UserRecord): Promise<void> {
  const store = getStore();
  await acceptPendingInvitations(user);
  if ((await store.listMembershipsForUser(user.id)).length === 0) {
    const base = user.name || user.githubLogin || user.email?.split('@')[0] || 'My';
    const org = await store.createOrg({ name: `${base}'s team`, plan: 'free', aiProvider: null, aiModel: null });
    await store.addMembership({ orgId: org.id, userId: user.id, role: 'owner' });
  }
}

interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
}

/**
 * Verifies a GitHub OAuth token (from VS Code's built-in GitHub sign-in) by calling the GitHub API.
 * The GitHub token itself is never stored.
 */
export async function signInWithGitHub(accessToken: string, label: string | null): Promise<SignInResult> {
  const f = fetcher ?? fetch;
  const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'projectlens-api' };
  const userRes = await f('https://api.github.com/user', { headers, signal: AbortSignal.timeout(10_000) });
  if (!userRes.ok) {
    throw new HttpError(401, 'github_auth_failed', 'GitHub did not accept the sign-in token');
  }
  const gh = (await userRes.json()) as GitHubUser;
  let email: string | null = null;
  const emailsRes = await f('https://api.github.com/user/emails', { headers, signal: AbortSignal.timeout(10_000) });
  if (emailsRes.ok) {
    const emails = (await emailsRes.json()) as { email: string; primary: boolean; verified: boolean }[];
    const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
    email = primary ? normalizeEmail(primary.email) : null;
  }

  const store = getStore();
  const githubId = String(gh.id);
  let user = await store.findUserByGithubId(githubId);
  if (!user && email) {
    // Link to an existing account created by verified email sign-in.
    const byEmail = await store.findUserByEmail(email);
    if (byEmail && byEmail.emailVerified && !byEmail.githubId) {
      user = byEmail;
    }
  }
  const profile = { githubId, githubLogin: gh.login, name: gh.name ?? user?.name ?? gh.login, avatarUrl: gh.avatar_url };
  if (user) {
    user = await store.updateUser(user.id, { ...profile, ...(email && !user.email ? { email, emailVerified: true } : {}) });
  } else {
    user = await store.createUser({ ...profile, email, emailVerified: !!email });
  }
  await ensureOrganization(user);
  return createSession(user, label);
}

const codeHash = (email: string, code: string) => sha256(`${email}:${code}:${env().encryptionKey || env().adminKey}`);

/** Emails a 6-digit sign-in code. Responds the same way whether or not the account exists. */
export async function startEmailSignIn(rawEmail: string): Promise<{ expiresInSeconds: number }> {
  if (!emailEnabled()) {
    throw new HttpError(503, 'email_not_configured', 'Email sign-in is not available on this server. Use GitHub sign-in.');
  }
  const email = normalizeEmail(rawEmail);
  const store = getStore();
  const recent = await store.countEmailCodesSince(email, new Date(Date.now() - 3600 * 1000).toISOString());
  if (recent >= MAX_CODES_PER_HOUR) {
    throw new HttpError(429, 'rate_limited', 'Too many sign-in codes requested. Try again in an hour.');
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await store.createEmailCode({ email, codeHash: codeHash(email, code), expiresAt: new Date(Date.now() + CODE_TTL_MS).toISOString() });
  await sendEmail({
    to: email,
    subject: `${code} is your ProjectLens sign-in code`,
    text: `Your ProjectLens sign-in code is ${code}\n\nIt expires in 10 minutes. If you did not request it, ignore this email.`,
    html: `<p>Your ProjectLens sign-in code is</p><p style="font-size:28px;font-weight:600;letter-spacing:4px">${code}</p><p>It expires in 10 minutes. If you did not request it, ignore this email.</p>`
  });
  return { expiresInSeconds: CODE_TTL_MS / 1000 };
}

export async function verifyEmailCode(rawEmail: string, code: string, label: string | null): Promise<SignInResult> {
  const email = normalizeEmail(rawEmail);
  const store = getStore();
  const record = await store.latestEmailCode(email);
  const invalid = new HttpError(400, 'invalid_code', 'Invalid or expired code');
  if (!record || record.usedAt || new Date(record.expiresAt).getTime() < Date.now() || record.attempts >= MAX_CODE_ATTEMPTS) {
    throw invalid;
  }
  if (!safeEqual(record.codeHash, codeHash(email, code.trim()))) {
    await store.updateEmailCode(record.id, { attempts: record.attempts + 1 });
    throw invalid;
  }
  await store.updateEmailCode(record.id, { usedAt: new Date().toISOString() });
  let user = await store.findUserByEmail(email);
  if (user) {
    if (!user.emailVerified) {
      user = await store.updateUser(user.id, { emailVerified: true });
    }
  } else {
    user = await store.createUser({ email, emailVerified: true, githubId: null, githubLogin: null, name: email.split('@')[0], avatarUrl: null });
  }
  await ensureOrganization(user);
  return createSession(user, label);
}

export function userDto(u: UserRecord) {
  return { id: u.id, email: u.email, name: u.name, githubLogin: u.githubLogin, avatarUrl: u.avatarUrl };
}

export function orgDto(o: OrgRecord, role: Role) {
  return { id: o.id, name: o.name, plan: o.plan, role, aiProvider: o.aiProvider, aiModel: o.aiModel, createdAt: o.createdAt };
}

export async function meDto(user: UserRecord) {
  const store = getStore();
  const memberships = await store.listMembershipsForUser(user.id);
  const orgs = await Promise.all(memberships.map(async (m) => ({ m, org: await store.getOrg(m.orgId) })));
  return { user: userDto(user), organizations: orgs.filter((x) => x.org).map((x) => orgDto(x.org!, x.m.role)) };
}
