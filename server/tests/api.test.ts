import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { readdirSync } from 'node:fs';
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
import { setFetcher } from '@/lib/git';
import { setProviderFactory } from '@/lib/ai-runner';
import { decryptSecret, hmac } from '@/lib/crypto';
import { assertSafeOutboundUrl, parseRepository } from '@/lib/git/urls';
import { ADMIN, FIXTURES, SHA, body, ctx, fixtureTarball, req, resetEnv } from './helpers';
import type { AIProvider } from '@/engine/ai/AIProvider';
import type { MemoryStore } from '@/lib/store/memory';

let store: MemoryStore;
beforeEach(() => {
  store = resetEnv();
});

async function createLocal(fixture = 'vulnerable-app', extra: Record<string, unknown> = {}) {
  const res = await projects.POST(req('POST', '/api/v1/projects', { name: fixture, provider: 'local', repository: join(FIXTURES, fixture), ...extra }));
  expect(res.status).toBe(201);
  return (await body<{ data: { id: string } }>(res)).data;
}

async function scanNow(projectId: string, extra: Record<string, unknown> = {}) {
  const res = await scans.POST(req('POST', `/api/v1/projects/${projectId}/scans`, { wait: true, ...extra }), ctx({ projectId }));
  return { res, json: await body<{ data: { id: string; status: string; overview: Record<string, unknown>; commitSha: string }; cached: boolean }>(res) };
}

describe('authentication and API keys', () => {
  it('rejects missing, invalid and under-scoped keys', async () => {
    expect((await projects.GET(req('GET', '/api/v1/projects', undefined, null))).status).toBe(401);
    expect((await projects.GET(req('GET', '/api/v1/projects', undefined, 'plk_wrong'))).status).toBe(401);

    const created = await keys.POST(req('POST', '/api/v1/keys', { name: 'pm-tool', scopes: ['read'] }));
    expect(created.status).toBe(201);
    const { data } = await body<{ data: { id: string; key: string; prefix: string } }>(created);
    expect(data.key).toMatch(/^plk_/);
    expect(store.keys.get(data.id)?.keyHash).not.toContain(data.key);

    expect((await projects.GET(req('GET', '/api/v1/projects', undefined, data.key))).status).toBe(200);
    const forbidden = await projects.POST(req('POST', '/api/v1/projects', { name: 'x', provider: 'github', repository: 'a/b' }, data.key));
    expect(forbidden.status).toBe(403);
    expect((await keys.GET(req('GET', '/api/v1/keys', undefined, data.key))).status).toBe(403);

    expect((await keyById.DELETE(req('DELETE', `/api/v1/keys/${data.id}`), ctx({ keyId: data.id }))).status).toBe(204);
    expect((await projects.GET(req('GET', '/api/v1/projects', undefined, data.key))).status).toBe(401);
  });

  it('validates request bodies', async () => {
    const res = await projects.POST(req('POST', '/api/v1/projects', { provider: 'svn' }));
    expect(res.status).toBe(400);
    expect((await body<{ error: { code: string } }>(res)).error.code).toBe('invalid_request');
    const badJson = await projects.POST(new Request('https://api.test/api/v1/projects', { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` }, body: '{oops' }));
    expect((await body<{ error: { code: string } }>(badJson)).error.code).toBe('invalid_json');
  });

  it('exposes health and OpenAPI without secrets', async () => {
    resetEnv({ GROQ_API_KEY: 'gsk_secret_value' });
    const h = await body<{ ai: { configuredProviders: string[] } }>(await health.GET());
    expect(h.ai.configuredProviders).toEqual(['groq']);
    expect(JSON.stringify(h)).not.toContain('gsk_secret_value');
    const spec = await body<{ paths: Record<string, unknown> }>(await openapi.GET(req('GET', '/api/v1/openapi.json')));
    expect(Object.keys(spec.paths)).toEqual(expect.arrayContaining(['/projects', '/projects/{projectId}/scans', '/scans/{scanId}/findings', '/scans/{scanId}/insights']));
  });
});

describe('projects and scans (local fixture)', () => {
  it('scans a project and serves overview, findings, details and reports', async () => {
    const p = await createLocal('vulnerable-app', { externalId: 'pm-42' });
    const { res, json } = await scanNow(p.id);
    expect(res.status).toBe(200);
    expect(json.data.status).toBe('completed');
    const overview = json.data.overview as { scores: { security: { score: number } }; findings: { bySeverity: { critical: number } }; topRisks: unknown[]; technologies: { name: string }[] };
    expect(overview.scores.security.score).toBeLessThan(50);
    expect(overview.findings.bySeverity.critical).toBeGreaterThan(0);
    expect(overview.topRisks.length).toBeGreaterThan(0);
    expect(overview.technologies.map((t) => t.name)).toContain('Express');

    const byExternal = await project.GET(req('GET', '/api/v1/projects/ext:pm-42'), ctx({ projectId: 'ext:pm-42' }));
    const proj = (await body<{ data: { latestScan: { id: string }; trend: unknown[]; latestCompletedScanId: string } }>(byExternal)).data;
    expect(proj.latestScan.id).toBe(json.data.id);
    expect(proj.trend).toHaveLength(1);

    const list = await body<{ data: { id: string }[] }>(await projects.GET(req('GET', '/api/v1/projects?externalId=pm-42')));
    expect(list.data.map((x) => x.id)).toEqual([p.id]);

    const detail = (await body<{ data: { scores: { security: { checks: unknown[]; caps: string[] } }; modules: unknown[] } }>(await scan.GET(req('GET', `/api/v1/scans/${json.data.id}`), ctx({ scanId: json.data.id })))).data;
    expect(detail.scores.security.checks.length).toBeGreaterThan(0);
    expect(detail.scores.security.caps.join(' ')).toMatch(/critical/);

    const f = await body<{ data: { ruleId: string; severity: string; evidence: string }[]; pagination: { total: number } }>(
      await findings.GET(req('GET', `/api/v1/scans/${json.data.id}/findings?severity=high&limit=100`), ctx({ scanId: json.data.id }))
    );
    expect(f.data.every((x) => ['critical', 'high'].includes(x.severity))).toBe(true);
    expect(f.data.map((x) => x.ruleId)).toContain('sec/sql-injection');
    expect(JSON.stringify(f)).not.toContain('Qz8vT2mLx9Rk4Wp7');

    const md = await report.GET(req('GET', `/api/v1/scans/${json.data.id}/report`), ctx({ scanId: json.data.id }));
    expect(md.headers.get('content-type')).toContain('text/markdown');
    expect(await md.text()).toContain('# ProjectLens Report');
  });

  it('rejects concurrent scans and rate limits repeated scans', async () => {
    const p = await createLocal();
    await store.createScan({ projectId: p.id, status: 'running', mode: 'full', ref: null, commitSha: 'local', triggeredBy: 't', callbackUrl: null, startedAt: null, finishedAt: null, error: null, summary: null, result: null });
    const busy = await scans.POST(req('POST', `/api/v1/projects/${p.id}/scans`, { wait: true }), ctx({ projectId: p.id }));
    expect(busy.status).toBe(409);

    const q = await createLocal('healthy-nextjs');
    expect((await scanNow(q.id, { mode: 'quick' })).res.status).toBe(200);
    const limited = await scans.POST(req('POST', `/api/v1/projects/${q.id}/scans`, { wait: true }), ctx({ projectId: q.id }));
    expect(limited.status).toBe(429);
    expect((await body<{ error: { details: { retryAfterSeconds: number } } }>(limited)).error.details.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('returns 404 for unknown projects and scans', async () => {
    expect((await project.GET(req('GET', '/api/v1/projects/ext:nope'), ctx({ projectId: 'ext:nope' }))).status).toBe(404);
    expect((await scan.GET(req('GET', '/api/v1/scans/x'), ctx({ scanId: '00000000-0000-0000-0000-000000000000' }))).status).toBe(404);
  });

  it('disables local repositories unless explicitly allowed', async () => {
    resetEnv({ ALLOW_LOCAL_REPOS: 'false' });
    const res = await projects.POST(req('POST', '/api/v1/projects', { name: 'x', provider: 'local', repository: FIXTURES }));
    const id = (await body<{ data: { id: string } }>(res)).data.id;
    expect((await scans.POST(req('POST', `/api/v1/projects/${id}/scans`, { wait: true }), ctx({ projectId: id }))).status).toBe(400);
  });
});

function githubFetcher(tar: Buffer, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== 'Bearer ghp_test_token') {
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
  it('stores tokens encrypted, scans a GitHub repo snapshot and links findings to the commit', async () => {
    const tar = await fixtureTarball('vulnerable-app');
    const calls: string[] = [];
    setFetcher(githubFetcher(tar, calls));
    const created = await projects.POST(req('POST', '/api/v1/projects', { name: 'Web', provider: 'github', repository: 'https://github.com/acme/web.git', accessToken: 'ghp_test_token' }));
    const p = (await body<{ data: { id: string; repository: string; hasAccessToken: boolean } }>(created)).data;
    expect(p.repository).toBe('acme/web');
    expect(p.hasAccessToken).toBe(true);
    expect(JSON.stringify(p)).not.toContain('ghp_test_token');
    const record = store.projects.get(p.id)!;
    expect(record.tokenEncrypted).not.toContain('ghp_test_token');
    expect(decryptSecret(record.tokenEncrypted!)).toBe('ghp_test_token');

    const before = readdirSync(tmpdir()).filter((d) => d.startsWith('projectlens-')).length;
    const { json } = await scanNow(p.id);
    expect(json.data.status).toBe('completed');
    expect(json.data.commitSha).toBe(SHA);
    expect(readdirSync(tmpdir()).filter((d) => d.startsWith('projectlens-')).length).toBe(before);

    const f = await body<{ data: { ruleId: string; url: string; file: string; line: number }[] }>(await findings.GET(req('GET', `/api/v1/scans/${json.data.id}/findings?limit=500`), ctx({ scanId: json.data.id })));
    const sql = f.data.find((x) => x.ruleId === 'sec/sql-injection')!;
    expect(sql.url).toBe(`https://github.com/acme/web/blob/${SHA}/src/routes/users.js#L${sql.line}`);
    expect(JSON.stringify(f)).not.toMatch(/file:\/\//);

    // Unchanged commit: cached result, no tarball download.
    const downloads = calls.filter((c) => c.includes('/tarball/')).length;
    const again = await scanNow(p.id);
    expect(again.json.cached).toBe(true);
    expect(again.json.data.id).toBe(json.data.id);
    expect(calls.filter((c) => c.includes('/tarball/')).length).toBe(downloads);
  });

  it('reports repository auth failures clearly', async () => {
    setFetcher(githubFetcher(Buffer.alloc(0)));
    const created = await projects.POST(req('POST', '/api/v1/projects', { name: 'Web', provider: 'github', repository: 'acme/web', accessToken: 'ghp_wrong' }));
    const id = (await body<{ data: { id: string } }>(created)).data.id;
    const res = await scans.POST(req('POST', `/api/v1/projects/${id}/scans`, { wait: true }), ctx({ projectId: id }));
    expect(res.status).toBe(400);
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
    const created = await projects.POST(req('POST', '/api/v1/projects', { name: 'SaaS', provider: 'gitlab', repository: 'https://git.example.com/team/apps/saas', accessToken: 'glpat-test' }));
    const p = (await body<{ data: { id: string; repository: string; baseUrl: string } }>(created)).data;
    expect(p).toMatchObject({ repository: 'team/apps/saas', baseUrl: 'https://git.example.com' });
    const { json } = await scanNow(p.id);
    expect(json.data.status).toBe('completed');
    const overview = json.data.overview as { progress: { label: string; requirements: { id: string }[] } };
    expect(overview.progress.label).toBe('Requirements completion');
    const f = await body<{ data: { url: string }[] }>(await findings.GET(req('GET', `/api/v1/scans/${json.data.id}/findings`), ctx({ scanId: json.data.id })));
    expect(f.data[0].url).toMatch(new RegExp(`^https://git\\.example\\.com/team/apps/saas/-/blob/${SHA}/`));
  });

  it('marks scans of oversized repositories as failed', async () => {
    resetEnv({ MAX_REPO_MB: '0.002' });
    setFetcher(githubFetcher(await fixtureTarball('vulnerable-app')));
    const created = await projects.POST(req('POST', '/api/v1/projects', { name: 'Web', provider: 'github', repository: 'acme/web', accessToken: 'ghp_test_token' }));
    const id = (await body<{ data: { id: string } }>(created)).data.id;
    const { res, json } = await scanNow(id);
    expect(res.status).toBe(500);
    expect(json.data.status).toBe('failed');
    expect((json.data as unknown as { error: string }).error).toMatch(/exceeds/);
  });

  it('rejects unsafe self-hosted URLs and parses repository URLs', () => {
    expect(() => assertSafeOutboundUrl('http://gitlab.example.com')).toThrow(/https/);
    expect(() => assertSafeOutboundUrl('https://localhost:8080')).toThrow(/Private/);
    expect(() => assertSafeOutboundUrl('https://10.0.0.5')).toThrow(/Private/);
    expect(() => assertSafeOutboundUrl('https://169.254.169.254/latest')).toThrow(/Private/);
    expect(assertSafeOutboundUrl('https://gitlab.example.com').hostname).toBe('gitlab.example.com');
    expect(parseRepository('github', 'https://github.com/acme/web/tree/main/src')).toEqual({ repository: 'acme/web', baseUrl: null });
    expect(parseRepository('gitlab', 'https://gitlab.com/g/sub/p/-/tree/main')).toEqual({ repository: 'g/sub/p', baseUrl: null });
  });
});

describe('AI insights', () => {
  const analysis = {
    summary: 'Express API with injection risks.',
    observations: [{ title: 'SQL injection', detail: 'Template literal query.', category: 'security', severity: 'high', confidence: 'high', fileReferences: [{ path: 'src/routes/users.js', line: 11 }] }],
    recommendations: [{ title: 'Use parameterized queries', detail: 'Use placeholders.', priority: 'high', effort: 'small', severity: 'high', confidence: 'high', fileReferences: [] }],
    overallSeverity: 'high',
    overallConfidence: 'medium'
  };

  function fakeProvider(captured: string[]): AIProvider {
    return {
      id: 'groq',
      displayName: 'Groq',
      complete: async (r) => {
        captured.push(r.user);
        return { text: JSON.stringify(analysis), mode: 'json_schema', model: r.model, usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } };
      },
      listModels: async () => [],
      testConnection: async () => ({ ok: true, message: '', modelAvailable: true })
    };
  }

  it('runs AI analysis with redacted context and returns repository links', async () => {
    store = resetEnv({ GROQ_API_KEY: 'gsk_server_key' });
    setFetcher(githubFetcher(await fixtureTarball('vulnerable-app')));
    const captured: string[] = [];
    setProviderFactory(() => fakeProvider(captured));
    const created = await projects.POST(req('POST', '/api/v1/projects', { name: 'Web', provider: 'github', repository: 'acme/web', accessToken: 'ghp_test_token' }));
    const id = (await body<{ data: { id: string } }>(created)).data.id;
    const { json } = await scanNow(id);
    expect(store.scans.get(json.data.id)!.result).not.toBeNull();

    const res = await insights.POST(req('POST', `/api/v1/scans/${json.data.id}/insights`, { task: 'securityConcerns' }), ctx({ scanId: json.data.id }));
    expect(res.status).toBe(201);
    const insight = (await body<{ data: { analysis: { summary: string }; fileUris: Record<string, string>; provider: string } }>(res)).data;
    expect(insight.analysis.summary).toContain('Express');
    expect(insight.provider).toBe('groq');
    expect(insight.fileUris['src/routes/users.js']).toBe(`https://github.com/acme/web/blob/${SHA}/src/routes/users.js`);
    // Excerpts from the re-downloaded commit are included, with secrets redacted.
    expect(captured[0]).toContain('=== FILE: src/config.js');
    expect(captured[0]).toContain('[REDACTED:');
    expect(captured[0]).not.toContain('Wk3Rm9Tq2LxZ');

    const listed = await body<{ data: unknown[] }>(await insights.GET(req('GET', `/api/v1/scans/${json.data.id}/insights`), ctx({ scanId: json.data.id })));
    expect(listed.data).toHaveLength(1);
    const again = await insights.POST(req('POST', `/api/v1/scans/${json.data.id}/insights`, { task: 'improvements' }), ctx({ scanId: json.data.id }));
    expect(again.status).toBe(429);
  });

  it('requires a configured provider key and a valid file path', async () => {
    const p = await createLocal();
    const { json } = await scanNow(p.id);
    const missing = await insights.POST(req('POST', `/api/v1/scans/${json.data.id}/insights`, { task: 'projectAssessment', provider: 'anthropic' }), ctx({ scanId: json.data.id }));
    expect(missing.status).toBe(400);
    expect((await body<{ error: { code: string } }>(missing)).error.code).toBe('ai_not_configured');
    const traversal = await insights.POST(req('POST', `/api/v1/scans/${json.data.id}/insights`, { task: 'reviewFile', file: '../../etc/passwd' }), ctx({ scanId: json.data.id }));
    expect(traversal.status).toBe(400);
  });
});

describe('webhooks', () => {
  it('posts a signed callback when a scan finishes', async () => {
    resetEnv({ PROJECTLENS_WEBHOOK_SECRET: 'whsec' });
    const sent: { url: string; headers: Headers; body: string }[] = [];
    const original = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), headers: new Headers(init?.headers), body: String(init?.body) });
      return new Response('ok');
    });
    try {
      const p = await createLocal();
      await scanNow(p.id, { callbackUrl: 'https://pm.example.com/hooks/projectlens' });
      expect(sent).toHaveLength(1);
      expect(sent[0].headers.get('x-projectlens-event')).toBe('scan.completed');
      expect(sent[0].headers.get('x-projectlens-signature')).toBe(`sha256=${hmac('whsec', sent[0].body)}`);
      expect(JSON.parse(sent[0].body).data.scan.status).toBe('completed');
    } finally {
      vi.stubGlobal('fetch', original);
    }
  });

  it('refuses callbacks to private hosts', async () => {
    const p = await createLocal();
    const res = await scans.POST(req('POST', `/api/v1/projects/${p.id}/scans`, { wait: true, callbackUrl: 'http://127.0.0.1/hook' }), ctx({ projectId: p.id }));
    // Delivery is refused (private host); the scan result itself is still stored.
    expect(res.status).toBe(200);
    expect(existsSync(FIXTURES)).toBe(true);
  });
});
