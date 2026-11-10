import { describe, expect, it } from 'vitest';
import { discoverFiles } from '../../src/core/fileDiscovery';
import { tempDir } from './helpers';

const opts = (dir: string, extra = {}) => ({
  roots: [{ name: 'app', path: dir }],
  respectGitignore: true,
  extraExcludes: [],
  maxFileSizeBytes: 1024,
  maxFiles: 1000,
  ...extra
});

describe('workspace discovery', () => {
  it('respects .gitignore, nested .gitignore and default excludes', async () => {
    const dir = await tempDir({
      '.gitignore': 'secret-notes.txt\nlogs/\n',
      'src/index.ts': 'export const a = 1;',
      'src/legacy/.gitignore': 'old.ts\n',
      'src/legacy/old.ts': 'x',
      'src/legacy/keep.ts': 'x',
      'secret-notes.txt': 'x',
      'logs/app.log': 'x',
      'node_modules/pkg/index.js': 'x',
      '.next/server.js': 'x',
      'dist/bundle.js': 'x',
      'coverage/lcov.info': 'x'
    });
    const { files, skipped } = await discoverFiles(opts(dir));
    const paths = files.map((f) => f.relPath).sort();
    expect(paths).toEqual(['.gitignore', 'src/index.ts', 'src/legacy/.gitignore', 'src/legacy/keep.ts']);
    expect(skipped.get('ignored by .gitignore')).toBeGreaterThanOrEqual(2);
  });

  it('can ignore .gitignore when disabled but still applies default excludes', async () => {
    const dir = await tempDir({ '.gitignore': 'notes.txt\n', 'notes.txt': 'x', 'node_modules/a.js': 'x' });
    const { files } = await discoverFiles(opts(dir, { respectGitignore: false }));
    expect(files.map((f) => f.relPath).sort()).toEqual(['.gitignore', 'notes.txt']);
  });

  it('flags binary and oversized files and detects languages', async () => {
    const dir = await tempDir({ 'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'big.ts': 'x'.repeat(5000), 'a.tsx': 'x', 'Dockerfile': 'FROM node:20' });
    const { files } = await discoverFiles(opts(dir));
    const byName = Object.fromEntries(files.map((f) => [f.relPath, f]));
    expect(byName['logo.png'].binary).toBe(true);
    expect(byName['big.ts'].tooLarge).toBe(true);
    expect(byName['a.tsx'].language).toBe('TypeScript');
    expect(byName['Dockerfile'].language).toBe('Dockerfile');
  });

  it('reports root env files with their gitignore status even when ignored', async () => {
    const dir = await tempDir({ '.gitignore': '.env.local\n', '.env': 'A=1', '.env.local': 'B=2' });
    const { envFiles, files } = await discoverFiles(opts(dir));
    const status = Object.fromEntries(envFiles.map((e) => [e.file.relPath, e.gitignored]));
    expect(status).toEqual({ '.env': false, '.env.local': true });
    expect(files.some((f) => f.relPath === '.env.local')).toBe(false);
  });

  it('supports multi-root workspaces with prefixed display paths', async () => {
    const a = await tempDir({ 'a.ts': 'x' });
    const b = await tempDir({ 'b.ts': 'x' });
    const { files } = await discoverFiles({ ...opts(a), roots: [{ name: 'web', path: a }, { name: 'api', path: b }] });
    expect(files.map((f) => f.displayPath).sort()).toEqual(['api/b.ts', 'web/a.ts']);
  });

  it('honours the file limit and supports cancellation', async () => {
    const dir = await tempDir(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}.ts`, 'x'])));
    const limited = await discoverFiles(opts(dir, { maxFiles: 5 }));
    expect(limited.files).toHaveLength(5);
    expect(limited.truncated).toBe(true);
    const controller = new AbortController();
    controller.abort();
    await expect(discoverFiles(opts(dir, { signal: controller.signal }))).rejects.toThrow(/cancelled/i);
  });
});
