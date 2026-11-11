import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as projects from '@/app/api/v1/projects/route';
import * as project from '@/app/api/v1/projects/[projectId]/route';
import * as scans from '@/app/api/v1/projects/[projectId]/scans/route';
import * as scan from '@/app/api/v1/scans/[scanId]/route';
import * as findings from '@/app/api/v1/scans/[scanId]/findings/route';
import * as report from '@/app/api/v1/scans/[scanId]/report/route';
import * as insights from '@/app/api/v1/scans/[scanId]/insights/route';
import * as keys from '@/app/api/v1/keys/route';
import * as keyById from '@/app/api/v1/keys/[keyId]/route';
import * as health from '@/app/api/v1/health/route';
import * as openapi from '@/app/api/v1/openapi.json/route';
import * as aiKey from '@/app/api/v1/orgs/[orgId]/ai-keys/[provider]/route';
import { setFetcher } from '@/lib/git';
import { setProviderFactory } from '@/lib/ai-runner';
import { decryptSecret, hmac } from '@/lib/crypto';
import { assertSafeOutboundUrl, parseRepository } from '@/lib/git/urls';
import { ADMIN, FIXTURES, SHA, body, ctx, fixtureTarball, req, resetEnv, signIn } from './helpers';
import type { AIProvider } from '@/engine/ai/AIProvider';
import type { MemoryStore } from '@/lib/store/memory';

let store: MemoryStore;
let TOKEN: string;
let ORG: string;

async function setup(extra: Record<string, string> = {}) {
  store = resetEnv(extra);
  const alice = await signIn('alice');
  TOKEN = alice.token;
  ORG = alice.orgId;
}

beforeEach(async () => {
  await setup();
});

const r = (method: string, path: string, data?: unknown, token: string | null = TOKEN) => req(method, path, data, token);

async function createLocal(fixture = 'vulnerable-app', extra: Record<string, unknown> = {}) {
  const res = await projects.POST(r('POST', '/api/v1/projects', { name: fixture, provider: 'local', repository: join(FIXTURES, fixture), ...extra }));
  expect(res.status).toBe(201);
  return (await body<{ data: { id: string } }>(res)).data;
}

async function scanNow(projectId: string, extra: Record<string, unknown> = {}, token = TOKEN) {
  const res = await scans.POST(req('POST', `/api/v1/projects/${projectId}/scans`, { wait: true, ...extra }, token), ctx({ projectId }));
  return { res, json: await body<{ data: { id: string; status: string; overview: Record<string, unknown>; commitSha: string; source: string }; cached: boolean }>(res) };
}

describe('authentication and API keys', () => {
  it('rejects missing and invalid tokens; API keys follow their scopes', async () => {
    expect((await projects.GET(r('GET', '/api/v1/projects', undefined, null))).status).toBe(401);
    expect((await projects.GET(r('GET', '/api/v1/projects', undefined, 'plk_wrong'))).status).toBe(401);
    expect((await projects.GET(r('GET', '/api/v1/projects', undefined, 'pls_wrong'))).status).toBe(401);

    const created = await keys.POST(r('POST', '/api/v1/keys', { name: 'pm-tool', scopes: ['read'] }));
    expect(created.status).toBe(201);
    const { data } = await body<{ data: { id: string; key: string } }>(created);
    expect(data.key).toMatch(/^plk_/);
    expect(store.keys.get(data.id)?.orgId).toBe(ORG);

    expect((await projects.GET(r('GET', '/api/v1/projects', undefined, data.key))).status).toBe(200);
    expect((await projects.POST(r('POST', '/api/v1/projects', { name: 'x', provider: 'github', repository: 'a/b' }, data.key))).status).toBe(403);
    expect((await keys.GET(r('GET', '/api/v1/keys', undefined, data.key))).status).toBe(403);

    expect((await keyById.DELETE(r('DELETE', `/api/v1/keys/${data.id}`), ctx({ keyId: data.id }))).status).toBe(204);
    expect((await projects.GET(r('GET', '/api/v1/projects', undefined, data.key))).status).toBe(401);
  });

  it('requires an organization header for the platform admin key', async () => {
    expect((await projects.GET(r('GET', '/api/v1/projects', undefined, ADMIN))).status).toBe(400);
    const ok = await projects.GET(req('GET', '/api/v1/projects', undefined, ADMIN, { 'x-projectlens-org': ORG }));
    expect(ok.status).toBe(200);
  });

  it('validates request bodies', async () => {
    const res = await projects.POST(r('POST', '/api/v1/projects', { provider: 'svn' }));
    expect(res.status).toBe(400);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe('invalid_request');
    const badJson = await projects.POST(new Request('https://api.test/api/v1/projects', { method: 'POST', headers: { authorization: `Bearer ${TOKEN}` }, body: '{oops' }));
    expect((await body<{ error: { code: string } }>(badJson)).error.code).toBe('invalid_json');
  });

  it('exposes health and OpenAPI without secrets', async () => {
    await setup({ GROQ_API_KEY: 'gsk_secret_value' });
    const h = await body<{ ai: { configuredProviders: string[] } }>(await health.GET());
    expect(JSON.stringify(h)).not.toContain('gsk_secret_value');
    const spec = await body<{ paths: Record<string, unknown> }>(await openapi.GET(r('GET', '/api/v1/openapi.json')));
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/projects', '/projects/{projectId}/scans', '/projects/{projectId}/uploads', '/auth/github', '/orgs/{orgId}/members']));
  });
});

describe('projects and scans (local fixture)', () => {
  it('scans a project and serves overview, findings, details and reports', async () => {
    const p = await createLocal('vulnerable-app', { externalId: 'pm-42' });
    const { res, json } = await scanNow(p.id);
    expect(res.status).toBe(200);
    expect(json.data.status).toBe('completed');
    expect(json.data.source).toBe('cloud');
    const overview = json.data.overview as { scores: { security: { score: number } }; findings: { bySeverity: { critical: number } }; technologies: { name: string }[] };
    expect(overview.scores.security.score).toBeLessThan(50);
    expect(overview.findings.bySeverity.critical).toBeGreaterThan(0);
    expect(overview.technologies.map((t) => t.name)).toContain('Express');

    const byExternal = await project.GET(r('GET', '/api/v1/projects/ext:pm-42'), ctx({ projectId: 'ext:pm-42' }));
    const proj = (await body<{ data: { latestScan: { id: string }; trend: unknown[] } }>(byExternal)).data;
    expect(proj.latestScan.id).toBe(json.data.id);
    expect(proj.trend).toHaveLength(1);

    const detail = (await body<{ data: { scores: { security: { checks: unknown[]; caps: string[] } } } }>(await scan.GET(r('GET', `/api/v1/scans/${json.data.id}`), ctx({ scanId: json.data.id })))).data;
    expect(detail.scores.security.checks.length).toBeGreaterThan(0);
    expect(detail.scores.security.caps.join(' ')).toMatch(/critical/);

    const f = await body<{ data: { ruleId: string; severity: string }[] }>(await findings.GET(r('GET', `/api/v1/scans/${json.data.id}/findings?severity=high&limit=100`), ctx({ scanId: json.data.id })));
    expect(f.data.every((x) => ['critical', 'high'].includes(x.severity))).toBe(true);
    expect(f.data.map((x) => x.ruleId)).toContain('sec/sql-injection');
    expect(JSON.stringify(f)).not.toContain('Qz8vT2mLx9Rk4Wp7');

    const md = await report.GET(r('GET', `/api/v1/scans/${json.data.id}/report`), ctx({ scanId: json.data.id }));
    expect(await md.text()).toContain('# ProjectLens Report');
  });

  it('isolates organizations', async () => {
    const p = await createLocal('vulnerable-app', { externalId: 'shared-id' });
    const { json } = await scanNow(p.id);
    const bob = await signIn('bob');
    expect((await project.GET(r('GET', `/api/v1/projects/${p.id}`, undefined, bob.token), ctx({ projectId: p.id }))).status).toBe(404);
    expect((await scan.GET(r('GET', `/api/v1/scans/${json.data.id}`, undefined, bob.token), ctx({ scanId: json.data.id }))).status).toBe(404);
    expect((await body<{ data: unknown[] }>(await projects.GET(r('GET', '/api/v1/projects', undefined, bob.token)))).data).toHaveLength(0);
    // The same externalId is allowed in another organization.
    const bobProject = await projects.POST(r('POST', '/api/v1/projects', { name: 'b', provider: 'none', externalId: 'shared-id' }, bob.token));
    expect(bobProject.status).toBe(201);
    // Explicitly selecting someone else's organization is refused.
    const foreign = await projects.GET(req('GET', '/api/v1/projects', undefined, bob.token, { 'x-projectlens-org': ORG }));
    expect(foreign.status).toBe(403);
  });

  it('rejects concurrent scans, rate limits, and enforces plan quotas', async () => {
    const p = await createLocal();
    await store.createScan({ orgId: ORG, projectId: p.id, source: 'cloud', status: 'running', mode: 'full', ref: null, commitSha: 'local', triggeredBy: 't', callbackUrl: null, startedAt: null, finishedAt: null, error: null, summary: null, result: null });
    expect((await scans.POST(r('POST', `/api/v1/projects/${p.id}/scans`, { wait: true }), ctx({ projectId: p.id }))).status).toBe(409);

    const q = await createLocal('healthy-nextjs');
    expect((await scanNow(q.id, { mode: 'quick' })).res.status).toBe(200);
    const limited = await scans.POST(r('POST', `/api/v1/projects/${q.id}/scans`, { wait: true }), ctx({ projectId: q.id }));
    expect(limited.status).toBe(429);

    await setup({ FREE_MAX_PROJECTS: '1' });
    await createLocal();
    const over = await projects.POST(r('POST', '/api/v1/projects', { name: 'two', provider: 'none' }));
    expect(over.status).toBe(429);
    expect((await body<{ error: { code: string } }>(over)).error.code).toBe('quota_exceeded');
  });

  it('refuses cloud scans for projects without a repository', async () => {
    const res = await projects.POST(r('POST', '/api/v1/projects', { name: 'uploads only', provider: 'none' }));
    const id = (await body<{ data: { id: string } }>(res)).data.id;
    const scanRes = await scans.POST(r('POST', `/api/v1/projects/${id}/scans`, { wait: true }), ctx({ projectId: id }));
    expect((await body<{ error: { code: string } }>(scanRes)).error.code).toBe('no_repository');
  });

  it('disables local repositories unless explicitly allowed', async () => {
    await setup({ ALLOW_LOCAL_REPOS: 'false' });
    const res = await projects.POST(r('POST', '/api/v1/projects', { name: 'x', provider: 'local', repository: FIXTURES }));
    const id = (await body<{ data: { id: string } }>(res)).data.id;
    expect((await scans.POST(r('POST', `/api/v1/projects/${id}/scans`, { wait: true }), ctx({ projectId: id }))).status).toBe(400);
  });
});

function githubFetcher(tar: Buffer, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    if (new Headers(init?.headers).get('authorization') !== 'Bearer ghp_test_token') {
      return new Response('{"message":"Bad credentials"}', { status: 401 });
    }
    if (url === 'https://api.github.com/repos/acme/web') {
      return Response.json({ default_branch: 'main' });
    }
    if (url === 'https://api.github.com/repos/acme/web/commits/main') {
      return new Response(SHA);
    }
    if (url === `https://api.github.com/repos/acme/web/tarball/${SHA}`) {
      return new Response(new Uint8Array(tar), { headers: { 'content-length': String(tar.length) } });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('GitHub and GitLab repositories (mocked HTTP)', () => {
  it('stores tokens encrypted, scans a snapshot, links findings and reuses unchanged commits', async () => {
    const calls: string[] = [];
    setFetcher(githubFetcher(await fixtureTarball('vulnerable-app'), calls));
    const created = await projects.POST(r('POST', '/api/v1/projects', { name: 'Web', provider: 'github', repository: 'https://github.com/acme/web.git', accessToken: 'ghp_test_token' }));
    const p = (await body<{ data: { id: string; repository: string; hasAccessToken: boolean } }>(created)).data;
    expect(p.repository).toBe('acme/web');
    expect(JSON.stringify(p)).not.toContain('ghp_test_token');
    expect(decryptSecret(store.projects.get(p.id)!.tokenEncrypted!)).toBe('ghp_test_token');

    const before = readdirSync(tmpdir()).filter((d) => d.startsWith('projectlens-')).length;
    const { json } = await scanNow(p.id);
    expect(json.data.status).toBe('completed');
    expect(readdirSync(tmpdir()).filter((d) => d.startsWith('projectlens-')).length).toBe(before);

    const f = await body<{ data: { ruleId: string; url: string; line: number }[] }>(await findings.GET(r('GET', `/api/v1/scans/${json.data.id}/findings?limit=500`), ctx({ scanId: json.data.id })));
    const sql = f.data.find((x) => x.ruleId === 'sec/sql-injection')!;
    expect(sql.url).toBe(`https://github.com/acme/web/blob/${SHA}/src/routes/users.js#L${sql.line}`);
    expect(JSON.stringify(f)).not.toMatch(/file:\/\//);

    const downloads = calls.filter((c) => c.includes('/tarball/')).length;
    const again = await scanNow(p.id);
    expect(again.json.cached).toBe(true);
    expect(calls.filter((c) => c.includes('/tarball/')).length).toBe(downloads);
  });

  it('reports repository auth failures clearly', async () => {
    setFetcher(githubFetcher(Buffer.alloc(0)));
    const created = await projects.POST(r('POST', '/api/v1/projects', { name: 'Web', provider: 'github', repository: 'acme/web', accessToken: 'ghp_wrong' }));
    const id = (await body<{ data: { id: string } }>(created)).data.id;
    const res = await scans.POST(r('POST', `/api/v1/projects/${id}/scans`, { wait: true }), ctx({ projectId: id }));
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe('repository_auth_failed');
  });

  it('scans a self-hosted GitLab project', async () => {
    const tar = await fixtureTarball('partial-saas');
    const encoded = encodeURIComponent('team/apps/saas');
    setFetcher((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (new Headers(init?.headers).get('private-token') !== 'glpat-test') {
        return new Response('{}', { status: 401 });
      }
      if (url === `https://git.example.com/api/v4/projects/${encoded}`) {
        return Response.json({ default_branch: 'develop' });
      }
      if (url === `https://git.example.com/api/v4/projects/${encoded}/repository/commits/develop`) {
        return Response.json({ id: SHA });
      }
      if (url === `https://git.example.com/api/v4/projects/${encoded}/repository/archive.tar.gz?sha=${SHA}`) {
        return new Response(new Uint8Array(tar));
      }
      return new Response('', { status: 404 });
    }) as typeof fetch);
    const created = await projects.POST(r('POST', '/api/v1/projects', { name: 'SaaS', provider: 'gitlab', repository: 'https://git.example.com/team/apps/saas', accessToken: 'glpat-test' }));
    const p = (await body<{ data: { id: string; baseUrl: string } }>(created)).data;
    expect(p.baseUrl).toBe('https://git.example.com');
    const { json } = await scanNow(p.id);
    expect(json.data.status).toBe('completed');
    const f = await body<{ data: { url: string }[] }>(await findings.GET(r('GET', `/api/v1/scans/${json.data.id}/findings`), ctx({ scanId: json.data.id })));
    expect(f.data[0].url).toMatch(new RegExp(`^https://git\\.example\\.com/team/apps/saas/-/blob/${SHA}/`));
  });

  it('regenerates an unchanged commit when a previous report skipped files under a smaller limit', async () => {
    const calls: string[] = [];
    setFetcher(githubFetcher(await fixtureTarball('vulnerable-app'), calls));
    const created = await projects.POST(r('POST', '/api/v1/projects', { name: 'Web', provider: 'github', repository: 'acme/web', accessToken: 'ghp_test_token' }));
    const id = (await body<{ data: { id: string } }>(created)).data.id;
    const first = await scanNow(id);
    expect(first.json.data.status).toBe('completed');
    const previous = store.scans.get(first.json.data.id)!;
    // Simulate a persisted report produced by the old 512 KB deployment.
    previous.summary!.warnings.push('10 file(s) larger than 512 KB were not downloaded.');
    previous.createdAt = new Date(Date.now() - 120000).toISOString();
    const regenerated = await scanNow(id);
    expect(regenerated.json.cached).toBe(false);
    expect(regenerated.json.data.id).not.toBe(first.json.data.id);
    expect(regenerated.json.data.status).toBe('completed');
    expect(calls.filter((call) => call.includes('/tarball/'))).toHaveLength(2);
  });

  it('marks scans of oversized repositories as failed', async () => {
    await setup({ MAX_REPO_MB: '0.002' });
    setFetcher(githubFetcher(await fixtureTarball('vulnerable-app')));
    const created = await projects.POST(r('POST', '/api/v1/projects', { name: 'Web', provider: 'github', repository: 'acme/web', accessToken: 'ghp_test_token' }));
    const id = (await body<{ data: { id: string } }>(created)).data.id;
    const { json } = await scanNow(id);
    expect(json.data.status).toBe('failed');
  });

  it('rejects unsafe self-hosted URLs and parses repository URLs', () => {
    expect(() => assertSafeOutboundUrl('http://gitlab.example.com')).toThrow(/https/);
    expect(() => assertSafeOutboundUrl('https://localhost:8080')).toThrow(/Private/);
    expect(() => assertSafeOutboundUrl('https://169.254.169.254/latest')).toThrow(/Private/);
    expect(parseRepository('github', 'https://github.com/acme/web/tree/main/src')).toEqual({ repository: 'acme/web', baseUrl: null });
    expect(parseRepository('gitlab', 'https://gitlab.com/g/sub/p/-/tree/main')).toEqual({ repository: 'g/sub/p', baseUrl: null });
  });
});

describe('AI insights with organization keys', () => {
  const analysis = {
    summary: 'Express API with injection risks.',
    observations: [{ title: 'SQL injection', detail: 'Template literal query.', category: 'security', severity: 'high', confidence: 'high', fileReferences: [{ path: 'src/routes/users.js', line: 11 }] }],
    recommendations: [{ title: 'Use parameterized queries', detail: 'Use placeholders.', priority: 'high', effort: 'small', severity: 'high', confidence: 'high', fileReferences: [] }],
    overallSeverity: 'high',
    overallConfidence: 'medium'
  };

  function fakeProvider(captured: { key: string; prompt: string }[], key: string): AIProvider {
    return {
      id: 'groq',
      displayName: 'Groq',
      complete: async (q) => {
        captured.push({ key, prompt: q.user });
        return { text: JSON.stringify(analysis), mode: 'json_schema', model: q.model, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
      },
      listModels: async () => {
        if (key === 'bad-key-123') {
          throw new Error('invalid');
        }
        return ['m'];
      },
      testConnection: async () => ({ ok: true, message: '', modelAvailable: true })
    };
  }

  it('uses the organization key, never a server key, and links file references', async () => {
    await setup({ GROQ_API_KEY: 'gsk_server_key_should_not_be_used' });
    setFetcher(githubFetcher(await fixtureTarball('vulnerable-app')));
    const captured: { key: string; prompt: string }[] = [];
    setProviderFactory((_id, key) => fakeProvider(captured, key));
    const created = await projects.POST(r('POST', '/api/v1/projects', { name: 'Web', provider: 'github', repository: 'acme/web', accessToken: 'ghp_test_token' }));
    const id = (await body<{ data: { id: string } }>(created)).data.id;
    const { json } = await scanNow(id);

    const missing = await insights.POST(r('POST', `/api/v1/scans/${json.data.id}/insights`, { task: 'securityConcerns' }), ctx({ scanId: json.data.id }));
    expect((await body<{ error: { code: string } }>(missing)).error.code).toBe('ai_not_configured');

    const bad = await aiKey.PUT(r('PUT', `/api/v1/orgs/${ORG}/ai-keys/groq`, { apiKey: 'bad-key-123' }), ctx({ orgId: ORG, provider: 'groq' }));
    expect((await body<{ error: { code: string } }>(bad)).error.code).toBe('invalid_ai_key');
    const saved = await aiKey.PUT(r('PUT', `/api/v1/orgs/${ORG}/ai-keys/groq`, { apiKey: 'gsk_org_key_abcd' }), ctx({ orgId: ORG, provider: 'groq' }));
    expect((await body<{ data: { last4: string } }>(saved)).data.last4).toBe('abcd');
    expect(JSON.stringify(store.aiKeys)).not.toContain('gsk_org_key_abcd');
    expect(store.orgs.get(ORG)!.aiProvider).toBe('groq');

    const res = await insights.POST(r('POST', `/api/v1/scans/${json.data.id}/insights`, { task: 'securityConcerns' }), ctx({ scanId: json.data.id }));
    expect(res.status).toBe(201);
    const insight = (await body<{ data: { fileUris: Record<string, string> } }>(res)).data;
    expect(captured.at(-1)!.key).toBe('gsk_org_key_abcd');
    expect(captured.at(-1)!.prompt).toContain('[REDACTED:');
    expect(captured.at(-1)!.prompt).not.toContain('Wk3Rm9Tq2LxZ');
    expect(insight.fileUris['src/routes/users.js']).toBe(`https://github.com/acme/web/blob/${SHA}/src/routes/users.js`);
  });

  it('rejects invalid file paths', async () => {
    const p = await createLocal();
    const { json } = await scanNow(p.id);
    const traversal = await insights.POST(r('POST', `/api/v1/scans/${json.data.id}/insights`, { task: 'reviewFile', file: '../../etc/passwd' }), ctx({ scanId: json.data.id }));
    expect(traversal.status).toBe(400);
  });
});

describe('webhooks', () => {
  it('posts a signed callback when a scan finishes', async () => {
    await setup({ PROJECTLENS_WEBHOOK_SECRET: 'whsec' });
    const sent: { headers: Headers; body: string }[] = [];
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response('ok');
    });
    try {
      const p = await createLocal();
      await scanNow(p.id, { callbackUrl: 'https://pm.example.com/hooks/projectlens' });
      expect(sent).toHaveLength(1);
      expect(sent[0].headers.get('x-projectlens-signature')).toBe(`sha256=${hmac('whsec', sent[0].body)}`);
    } finally {
      vi.stubGlobal('fetch', original);
    }
  });
});
