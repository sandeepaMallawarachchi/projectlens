import * as path from 'node:path';
import * as os from 'node:os';
import { promises as fs } from 'node:fs';
import { scanWorkspace } from '../../src/core/scanner';
import type { ScanMode, ScanResult } from '../../src/models/types';
import { createFileContext, type FileContext } from '../../src/core/fileContext';
import type { DiscoveredFile } from '../../src/core/fileDiscovery';
import { fileUri } from '../../src/utils/paths';

export const FIXTURES = path.resolve(__dirname, '../fixtures');

const cache = new Map<string, Promise<ScanResult>>();

export function scanFixture(name: string, mode: ScanMode = 'full'): Promise<ScanResult> {
  const key = `${name}:${mode}`;
  if (!cache.has(key)) {
    cache.set(key, scanDir(path.join(FIXTURES, name), mode));
  }
  return cache.get(key)!;
}

export function scanDir(dir: string, mode: ScanMode = 'full', extra: Partial<Parameters<typeof scanWorkspace>[0]> = {}): Promise<ScanResult> {
  return scanWorkspace({
    roots: [{ name: path.basename(dir), path: dir }],
    mode,
    respectGitignore: true,
    extraExcludes: [],
    maxFileSizeBytes: 512 * 1024,
    maxFiles: 5000,
    gitleaks: { enabled: false, trusted: true, path: '', timeoutMs: 1000 },
    ...extra
  });
}

/** Builds an in-memory FileContext for analyzer unit tests. */
export function ctxFor(relPath: string, text: string, parse = true): FileContext {
  const abs = path.join('/workspace', relPath);
  const file: DiscoveredFile = {
    root: '/workspace',
    rootName: 'workspace',
    absPath: abs,
    relPath,
    displayPath: relPath,
    uri: fileUri(abs),
    size: text.length,
    mtimeMs: 0,
    language: undefined,
    binary: false,
    tooLarge: false
  };
  return createFileContext(file, text, parse);
}

export async function tempDir(files: Record<string, string | Buffer>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'projectlens-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }
  return dir;
}

/**
 * Dummy credentials assembled at runtime so that no provider-format token
 * appears literally in the repository. None of these are real.
 */
export const DUMMY = {
  aws: 'AKIA' + 'QZ7T2LPRB4NW6KXD',
  github: 'ghp' + '_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8',
  stripeLive: 'sk' + '_live_' + 'Zt9Qw2Er5Ty8Ui1Op4As7Df0',
  groq: 'gsk' + '_' + 'Tq8Wm2Lx9Rk4Zp7Vn3Bc6Hd1Fj5Gs0Ky2Qe8Ua4Mi',
  privateKeyHeader: '-----BEGIN ' + 'RSA PRIVATE KEY-----',
  genericPassword: 'Xk9#mQ2v!Lp7Rz4w'
};
