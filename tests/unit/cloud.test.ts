import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { CloudClient, CloudError, validateApiUrl } from '../../src/cloud/cloudClient';
import { parseRemote, readGitInfo } from '../../src/cloud/gitInfo';
import { trimForUpload } from '../../src/cloud/upload';
import { scanFixture, tempDir } from './helpers';

describe('cloud API client', () => {
  it('sends auth and organization headers and unwraps data', async () => {
    const seen: { url: string; headers: Headers; body?: string }[] = [];
    const fake = (async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers), body: init?.body as string | undefined });
      return Response.json({ data: [{ id: 'p1', name: 'Web' }] });
    }) as typeof fetch;
    const client = new CloudClient('https://api.example.com/api/v1', 'pls_token', 'org-1', fake);
    const projects = await client.projects();
    expect(projects).toEqual([{ id: 'p1', name: 'Web' }]);
    expect(seen[0].url).toBe('https://api.example.com/api/v1/projects');
    expect(seen[0].headers.get('authorization')).toBe('Bearer pls_token');
    expect(seen[0].headers.get('x-projectlens-org')).toBe('org-1');
  });

  it('maps API errors and network failures to CloudError', async () => {
    const failing = new CloudClient('https://api.example.com', null, null, (async () =>
      Response.json({ error: { code: 'quota_exceeded', message: 'Plan limit reached', details: { limit: 1 } } }, { status: 429 })) as typeof fetch);
    await expect(failing.projects()).rejects.toMatchObject({ status: 429, code: 'quota_exceeded', message: 'Plan limit reached' });
    const offline = new CloudClient('https://api.example.com', null, null, (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch);
    await expect(offline.me()).rejects.toBeInstanceOf(CloudError);
    await expect(offline.me()).rejects.toMatchObject({ code: 'network' });
  });

  it('requires https except for localhost', () => {
    expect(validateApiUrl('https://projectlensai.vercel.app/api/v1/')).toBe('https://projectlensai.vercel.app/api/v1');
    expect(validateApiUrl('http://localhost:3000/api/v1')).toBe('http://localhost:3000/api/v1');
    expect(() => validateApiUrl('http://example.com/api')).toThrow(/https/);
    expect(() => validateApiUrl('not a url')).toThrow(/Invalid/);
  });
});

describe('git info (no git execution)', () => {
  it('parses https and SSH remotes for GitHub, GitLab and self-hosted hosts', () => {
    expect(parseRemote('git@github.com:acme/web.git')).toEqual({ provider: 'github', repository: 'acme/web', baseUrl: null, webUrl: 'https://github.com/acme/web' });
    expect(parseRemote('https://gitlab.com/group/sub/app.git')).toMatchObject({ provider: 'gitlab', repository: 'group/sub/app', baseUrl: null });
    expect(parseRemote('ssh://git@git.acme.io/team/app')).toMatchObject({ provider: 'gitlab', repository: 'team/app', baseUrl: 'https://git.acme.io' });
    expect(parseRemote('https://user:secret@github.com/acme/web')).toMatchObject({ repository: 'acme/web', webUrl: 'https://github.com/acme/web' });
    expect(parseRemote('https://github.com/onlyowner')).toBeNull();
  });

  it('reads remote, branch and commit from .git files, including packed refs', async () => {
    const sha = 'c'.repeat(40);
    const dir = await tempDir({
      '.git/HEAD': 'ref: refs/heads/feature/login\n',
      '.git/config': '[core]\n\tbare = false\n[remote "origin"]\n\turl = git@github.com:acme/web.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n',
      '.git/packed-refs': `# pack-refs\n${sha} refs/heads/feature/login\n`
    });
    expect(await readGitInfo(dir)).toEqual({ remoteUrl: 'git@github.com:acme/web.git', branch: 'feature/login', commitSha: sha });
    await fs.writeFile(join(dir, '.git/HEAD'), `${'d'.repeat(40)}\n`);
    expect((await readGitInfo(dir)).commitSha).toBe('d'.repeat(40));
    expect(await readGitInfo(await tempDir({ 'a.txt': 'x' }))).toEqual({ remoteUrl: null, branch: null, commitSha: null });
  });
});

describe('upload payload', () => {
  it('trims large results to the server limits', async () => {
    const result = await scanFixture('vulnerable-app');
    const big = { ...result, findings: Array.from({ length: 3500 }, (_, i) => ({ ...result.findings[0], id: String(i), evidence: 'x'.repeat(3000) })) };
    const trimmed = trimForUpload(big);
    expect(trimmed.findings).toHaveLength(3000);
    expect(trimmed.findings[0].evidence.length).toBe(2000);
    expect(trimmed.scores).toBe(big.scores);
  });
});
