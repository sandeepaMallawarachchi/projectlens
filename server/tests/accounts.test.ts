import { beforeEach, describe, expect, it } from 'vitest';
import * as authConfig from '@/app/api/v1/auth/config/route';
import * as githubAuth from '@/app/api/v1/auth/github/route';
import * as emailStart from '@/app/api/v1/auth/email/start/route';
import * as emailVerify from '@/app/api/v1/auth/email/verify/route';
import * as logout from '@/app/api/v1/auth/logout/route';
import * as me from '@/app/api/v1/me/route';
import * as orgs from '@/app/api/v1/orgs/route';
import * as members from '@/app/api/v1/orgs/[orgId]/members/route';
import * as member from '@/app/api/v1/orgs/[orgId]/members/[userId]/route';
import * as invitations from '@/app/api/v1/orgs/[orgId]/invitations/route';
import * as aiKeys from '@/app/api/v1/orgs/[orgId]/ai-keys/route';
import * as orgUsage from '@/app/api/v1/orgs/[orgId]/usage/route';
import * as usage from '@/app/api/v1/usage/route';
import * as keys from '@/app/api/v1/keys/route';
import * as projects from '@/app/api/v1/projects/route';
import * as project from '@/app/api/v1/projects/[projectId]/route';
import * as uploads from '@/app/api/v1/projects/[projectId]/uploads/route';
import * as findings from '@/app/api/v1/scans/[scanId]/findings/route';
import { setEmailSender, type EmailMessage } from '@/lib/email';
import { scanWorkspace } from '@/engine/core/scanner';
import { FIXTURES, body, ctx, req, resetEnv, signIn } from './helpers';
import { join } from 'node:path';
import type { MemoryStore } from '@/lib/store/memory';

let store: MemoryStore;
let sent: EmailMessage[];

beforeEach(() => {
  store = resetEnv();
  sent = [];
});

const enableEmail = () => setEmailSender(async (m) => void sent.push(m));
const codeFrom = (m: EmailMessage) => /(\d{6})/.exec(m.subject)![1];

describe('GitHub sign-in', () => {
  it('creates a user, a personal organization and a session; signing in again reuses them', async () => {
    const res = await githubAuth.POST(req('POST', '/api/v1/auth/github', { accessToken: 'gh-carol', label: 'VS Code' }));
    expect(res.status).toBe(200);
    const first = (await body<{ data: { token: string; user: { githubLogin: string; email: string }; organizations: { id: string; role: string; name: string }[] } }>(res)).data;
    expect(first.token).toMatch(/^pls_/);
    expect(first.user).toMatchObject({ githubLogin: 'carol', email: 'carol@example.com' });
    expect(first.organizations).toEqual([expect.objectContaining({ role: 'owner', name: "CAROL's team" })]);
    expect([...store.sessions.values()][0].tokenHash).not.toContain(first.token);

    const again = (await body<{ data: { organizations: { id: string }[] } }>(await githubAuth.POST(req('POST', '/api/v1/auth/github', { accessToken: 'gh-carol' })))).data;
    expect(again.organizations.map((o) => o.id)).toEqual(first.organizations.map((o) => o.id));
    expect(store.users.size).toBe(1);

    expect((await githubAuth.POST(req('POST', '/api/v1/auth/github', { accessToken: 'not-a-valid-token' }))).status).toBe(401);
  });

  it('signs out by revoking the session', async () => {
    const { token } = await signIn('dave');
    expect((await me.GET(req('GET', '/api/v1/me', undefined, token))).status).toBe(200);
    expect((await logout.POST(req('POST', '/api/v1/auth/logout', undefined, token))).status).toBe(204);
    expect((await me.GET(req('GET', '/api/v1/me', undefined, token))).status).toBe(401);
  });
});

describe('email sign-in', () => {
  it('is reported as unavailable unless email delivery is configured', async () => {
    expect((await body<{ data: { email: boolean } }>(await authConfig.GET())).data.email).toBe(false);
    expect((await emailStart.POST(req('POST', '/api/v1/auth/email/start', { email: 'x@example.com' }))).status).toBe(503);
    enableEmail();
    expect((await body<{ data: { email: boolean } }>(await authConfig.GET())).data.email).toBe(true);
  });

  it('verifies a 6-digit code, limits attempts and rejects reuse', async () => {
    enableEmail();
    expect((await emailStart.POST(req('POST', '/api/v1/auth/email/start', { email: 'Erin@Example.com' }))).status).toBe(200);
    expect(sent[0].to).toBe('erin@example.com');
    const code = codeFrom(sent[0]);
    expect(store.emailCodes[0].codeHash).not.toContain(code);

    const wrong = await emailVerify.POST(req('POST', '/api/v1/auth/email/verify', { email: 'erin@example.com', code: code === '000000' ? '111111' : '000000' }));
    expect(wrong.status).toBe(400);
    const ok = await emailVerify.POST(req('POST', '/api/v1/auth/email/verify', { email: 'erin@example.com', code }));
    expect(ok.status).toBe(200);
    const data = (await body<{ data: { token: string; user: { email: string } } }>(ok)).data;
    expect(data.user.email).toBe('erin@example.com');
    expect((await emailVerify.POST(req('POST', '/api/v1/auth/email/verify', { email: 'erin@example.com', code }))).status).toBe(400);

    for (let i = 0; i < 4; i++) {
      await emailStart.POST(req('POST', '/api/v1/auth/email/start', { email: 'erin@example.com' }));
    }
    expect((await emailStart.POST(req('POST', '/api/v1/auth/email/start', { email: 'erin@example.com' }))).status).toBe(429);
  });

  it('locks a code after too many wrong attempts', async () => {
    enableEmail();
    await emailStart.POST(req('POST', '/api/v1/auth/email/start', { email: 'frank@example.com' }));
    const code = codeFrom(sent[0]);
    const wrong = code === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) {
      await emailVerify.POST(req('POST', '/api/v1/auth/email/verify', { email: 'frank@example.com', code: wrong }));
    }
    expect((await emailVerify.POST(req('POST', '/api/v1/auth/email/verify', { email: 'frank@example.com', code }))).status).toBe(400);
  });
});

describe('teams', () => {
  it('invites by email; the invitee joins on sign-in and gets member permissions', async () => {
    enableEmail();
    const owner = await signIn('grace');
    const inv = await invitations.POST(req('POST', `/api/v1/orgs/${owner.orgId}/invitations`, { email: 'heidi@example.com', role: 'member' }, owner.token), ctx({ orgId: owner.orgId }));
    expect(inv.status).toBe(201);
    expect((await body<{ data: { emailed: boolean } }>(inv)).data.emailed).toBe(true);
    expect(sent.at(-1)!.subject).toContain('invited you');

    const heidi = await signIn('heidi'); // GitHub verified email heidi@example.com
    expect(heidi.orgId).toBe(owner.orgId);
    const list = await body<{ data: { role: string; user: { githubLogin: string } }[] }>(await members.GET(req('GET', `/api/v1/orgs/${owner.orgId}/members`, undefined, owner.token), ctx({ orgId: owner.orgId })));
    expect(list.data.map((m) => [m.user.githubLogin, m.role])).toEqual([['grace', 'owner'], ['heidi', 'member']]);

    // Members can read and scan, but not manage keys or members.
    expect((await projects.GET(req('GET', '/api/v1/projects', undefined, heidi.token))).status).toBe(200);
    expect((await keys.POST(req('POST', '/api/v1/keys', { name: 'x', scopes: ['read'] }, heidi.token))).status).toBe(403);
    expect((await invitations.POST(req('POST', `/api/v1/orgs/${owner.orgId}/invitations`, { email: 'z@example.com' }, heidi.token), ctx({ orgId: owner.orgId }))).status).toBe(403);

    // Owners promote; the last owner cannot leave.
    expect((await member.PATCH(req('PATCH', '/x', { role: 'admin' }, owner.token), ctx({ orgId: owner.orgId, userId: heidi.userId }))).status).toBe(200);
    expect((await keys.POST(req('POST', '/api/v1/keys', { name: 'pm', scopes: ['read'] }, heidi.token))).status).toBe(201);
    expect((await member.PATCH(req('PATCH', '/x', { role: 'owner' }, heidi.token), ctx({ orgId: owner.orgId, userId: heidi.userId }))).status).toBe(403);
    expect((await member.DELETE(req('DELETE', '/x', undefined, owner.token), ctx({ orgId: owner.orgId, userId: owner.userId }))).status).toBe(409);
    expect((await member.DELETE(req('DELETE', '/x', undefined, heidi.token), ctx({ orgId: owner.orgId, userId: heidi.userId }))).status).toBe(204);
  });

  it('creates additional organizations and selects them with X-ProjectLens-Org', async () => {
    const u = await signIn('ivan');
    const created = await orgs.POST(req('POST', '/api/v1/orgs', { name: 'Client work' }, u.token));
    const org = (await body<{ data: { id: string; role: string } }>(created)).data;
    expect(org.role).toBe('owner');
    await projects.POST(req('POST', '/api/v1/projects', { name: 'in client org', provider: 'none' }, u.token, { 'x-projectlens-org': org.id }));
    const defaultOrg = await body<{ data: unknown[] }>(await projects.GET(req('GET', '/api/v1/projects', undefined, u.token)));
    const clientOrg = await body<{ data: unknown[] }>(await projects.GET(req('GET', '/api/v1/projects', undefined, u.token, { 'x-projectlens-org': org.id })));
    expect(defaultOrg.data).toHaveLength(0);
    expect(clientOrg.data).toHaveLength(1);
  });

  it('reports AI key status without revealing keys, and usage', async () => {
    const u = await signIn('judy');
    const status = await body<{ data: { providers: { provider: string; configured: boolean }[] } }>(await aiKeys.GET(req('GET', '/x', undefined, u.token), ctx({ orgId: u.orgId })));
    expect(status.data.providers.map((p) => p.provider)).toEqual(['groq', 'openai', 'gemini', 'anthropic']);
    expect(status.data.providers.every((p) => !p.configured)).toBe(true);
    const use = await body<{ data: { limits: { projects: number }; projects: number } }>(await orgUsage.GET(req('GET', '/x', undefined, u.token), ctx({ orgId: u.orgId })));
    expect(use.data.limits.projects).toBe(25);
    const key = (await body<{ data: { key: string } }>(await keys.POST(req('POST', '/api/v1/keys', { name: 'pm', scopes: ['read'] }, u.token)))).data.key;
    expect((await usage.GET(req('GET', '/api/v1/usage', undefined, key))).status).toBe(200);
  });
});

describe('uploads from the VS Code extension', () => {
  it('stores a sanitized local scan: no local paths, repository links at the commit, redacted evidence', async () => {
    const u = await signIn('kim');
    const created = await projects.POST(req('POST', '/api/v1/projects', { name: 'Web', provider: 'github', repository: 'acme/web', externalId: 'pm-7' }, u.token));
    const p = (await body<{ data: { id: string } }>(created)).data;
    const root = join(FIXTURES, 'vulnerable-app');
    const local = await scanWorkspace({ roots: [{ name: 'web', path: root }], mode: 'full', respectGitignore: true, extraExcludes: [], maxFileSizeBytes: 512 * 1024, maxFiles: 5000, gitleaks: { enabled: false, trusted: true, path: '', timeoutMs: 0 } });
    // Simulate a tampered/unredacted evidence string to verify server-side redaction.
    local.findings[0].evidence = 'const password = "Zt9Qw2Er5Ty8Ui1Op4As7Df0xx";';
    local.warnings.push('Could not read /Users/kim/secret/project/file.ts');

    const sha = 'b'.repeat(40);
    const res = await uploads.POST(req('POST', `/api/v1/projects/${p.id}/uploads`, { result: local, commitSha: sha, branch: 'feature/x' }, u.token), ctx({ projectId: p.id }));
    expect(res.status).toBe(201);
    const scan = (await body<{ data: { id: string; source: string; ref: string; overview: { scores: { security: { score: number } } } } }>(res)).data;
    expect(scan.source).toBe('upload');
    expect(scan.ref).toBe('feature/x');
    expect(scan.overview.scores.security.score).toBe(local.scores.security.score);

    const stored = JSON.stringify(store.scans.get(scan.id));
    expect(stored).not.toContain('file://');
    expect(stored).not.toContain(root);
    expect(stored).not.toContain('/Users/kim');
    expect(stored).not.toContain('Zt9Qw2Er5Ty8Ui1Op4As7Df0xx');

    const f = await body<{ data: { file: string; url: string }[] }>(await findings.GET(req('GET', '/x?limit=500', undefined, u.token), ctx({ scanId: scan.id })));
    const sample = f.data.find((x) => x.file === 'src/routes/users.js')!;
    expect(sample.url).toMatch(new RegExp(`^https://github\\.com/acme/web/blob/${sha}/src/routes/users\\.js#L\\d+$`));

    const overview = await body<{ data: { latestScan: { id: string; source: string } } }>(await project.GET(req('GET', '/x', undefined, u.token), ctx({ projectId: 'ext:pm-7' })));
    expect(overview.data.latestScan).toMatchObject({ id: scan.id, source: 'upload' });
  });

  it('accepts uploads for projects without repository access and rejects malformed results', async () => {
    const u = await signIn('leo');
    const created = await projects.POST(req('POST', '/api/v1/projects', { name: 'Local only', provider: 'none' }, u.token));
    const p = (await body<{ data: { id: string } }>(created)).data;
    const local = await scanWorkspace({ roots: [{ name: 'app', path: join(FIXTURES, 'healthy-nextjs') }], mode: 'quick', respectGitignore: true, extraExcludes: [], maxFileSizeBytes: 512 * 1024, maxFiles: 5000, gitleaks: { enabled: false, trusted: true, path: '', timeoutMs: 0 } });
    const ok = await uploads.POST(req('POST', '/x', { result: local }, u.token), ctx({ projectId: p.id }));
    expect(ok.status).toBe(201);
    const bad = await uploads.POST(req('POST', '/x', { result: { version: 2 } }, u.token), ctx({ projectId: p.id }));
    expect(bad.status).toBe(400);
  });
});
