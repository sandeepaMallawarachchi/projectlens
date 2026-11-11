import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { c as createTar } from 'tar';
import { env } from '@/lib/env';
import { downloadSnapshot } from '@/lib/git/snapshot';
import type { RepoSource } from '@/lib/git';
import { scanWorkspace } from '@/engine/core/scanner';
import { resetEnv } from './helpers';

let sourceDir: string;
let cleanupSnapshot: (() => Promise<void>) | undefined;
beforeEach(async () => { resetEnv(); sourceDir = await mkdtemp(join(tmpdir(), 'projectlens-large-source-test-')); });
afterEach(async () => { await cleanupSnapshot?.(); cleanupSnapshot = undefined; await rm(sourceDir, { recursive: true, force: true }); });

async function source(): Promise<{ repo: RepoSource; content: string }> {
  const content = `/*${'x'.repeat(768 * 1024)}*/\nexport const answer = 42;\n`;
  await writeFile(join(sourceDir, 'app.ts'), content);
  const chunks: Buffer[] = [];
  for await (const chunk of createTar({ gzip: true, cwd: sourceDir, prefix: 'repository/', portable: true }, ['app.ts'])) chunks.push(Buffer.from(chunk));
  const bytes = Buffer.concat(chunks);
  return { content, repo: {
    resolve: async () => ({ sha: 'a'.repeat(40), ref: 'main' }),
    tarball: async () => new Response(new Uint8Array(bytes)),
    webUrl: () => null, repoUrl: () => null
  } };
}

describe('repository file size limits', () => {
  it('downloads and analyzes a source file larger than the old 512 KB default', async () => {
    const { repo, content } = await source();
    const config = env();
    expect(config.maxFileBytes).toBe(10 * 1024 * 1024);
    expect(config.maxRepoBytes).toBe(200 * 1024 * 1024);
    const snapshot = await downloadSnapshot(repo, 'a'.repeat(40), { maxBytes: config.maxRepoBytes, maxFileBytes: config.maxFileBytes });
    cleanupSnapshot = snapshot.cleanup;
    expect(snapshot.skippedLarge).toBe(0);
    expect(await readFile(join(snapshot.dir, 'app.ts'), 'utf8')).toBe(content);
    const result = await scanWorkspace({ roots: [{ name: 'App', path: snapshot.dir }], mode: 'full', respectGitignore: true, extraExcludes: [], maxFileSizeBytes: config.maxFileBytes, maxFiles: config.maxFiles, gitleaks: { enabled: false, trusted: false, path: '', timeoutMs: 0 } });
    expect(result.coverage.filesAnalyzed).toBe(1);
  });

  it('continues to honor a deliberately configured per-file limit', async () => {
    process.env.MAX_FILE_KB = '512';
    const { repo } = await source();
    const config = env();
    expect(config.maxFileBytes).toBe(512 * 1024);
    const snapshot = await downloadSnapshot(repo, 'a'.repeat(40), { maxBytes: config.maxRepoBytes, maxFileBytes: config.maxFileBytes });
    cleanupSnapshot = snapshot.cleanup;
    expect(snapshot.skippedLarge).toBe(1);
    expect(snapshot.files).toBe(0);
  });
});
