import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { GitLabSource } from '../lib/git/gitlab';

const SHA = 'a'.repeat(40);
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.headers['private-token'] !== 'test-repo-token') {
      res.writeHead(401).end('{}');
      return;
    }
    if (req.url?.includes('/repository/archive.tar.gz')) {
      // GitLab::HotlinkingDetector rejects these fetch metadata modes.
      if (['cors', 'no-cors', 'websocket'].includes(String(req.headers['sec-fetch-mode']))) {
        res.writeHead(406, { 'content-type': 'application/json' }).end('{"message":"406 Not Acceptable"}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream' }).end('archive-stream');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: SHA }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

describe('GitLab archive fetch metadata', () => {
  it('reproduces HTTP 406 with Node fetch defaults despite a valid repository token', async () => {
    const response = await fetch(`${base}/api/v4/projects/team%2Fapp/repository/archive.tar.gz?sha=${SHA}`, {
      headers: { 'private-token': 'test-repo-token' }
    });
    expect(response.status).toBe(406);
    await response.body?.cancel();
  });

  it('resolves and downloads with real Node fetch without triggering hotlink protection', async () => {
    const source = new GitLabSource('team/app', 'test-repo-token', base);
    expect(await source.resolve('main')).toEqual({ sha: SHA, ref: 'main' });
    const archive = await source.tarball(SHA);
    expect(archive.status).toBe(200);
    expect(await archive.text()).toBe('archive-stream');
  });
});
