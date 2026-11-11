import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { x as extract } from 'tar';
import { HttpError } from '../http';
import type { RepoSource } from './types';

const SKIP_DIRS = /(^|\/)(node_modules|\.git|\.next|dist|build|coverage|vendor|\.venv|__pycache__|target)\//;

export interface Snapshot {
  dir: string;
  bytes: number;
  files: number;
  skippedLarge: number;
  cleanup(): Promise<void>;
}

/**
 * Downloads a commit tarball and extracts it into a temporary directory.
 * - Streams (no full archive in memory); stops when the uncompressed size limit is exceeded.
 * - Skips symlinks, hard links, generated/dependency folders and oversized files.
 * - node-tar strips absolute paths and `..` segments, preventing writes outside `dir`.
 * The caller must call cleanup(); nothing is kept after the scan.
 */
export async function downloadSnapshot(source: RepoSource, sha: string, limits: { maxBytes: number; maxFileBytes: number }): Promise<Snapshot> {
  const dir = await mkdtemp(join(tmpdir(), 'projectlens-'));
  const cleanup = () => rm(dir, { recursive: true, force: true });
  let bytes = 0;
  let files = 0;
  let skippedLarge = 0;
  let tooLarge = false;
  try {
    const res = await source.tarball(sha);
    if (!res.body) {
      throw new HttpError(502, 'repository_error', 'Empty archive response');
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > limits.maxBytes) {
      throw new HttpError(413, 'repository_too_large', `Repository archive exceeds ${Math.round(limits.maxBytes / 1048576)} MB`);
    }
    await pipeline(
      Readable.fromWeb(res.body as NodeReadableStream),
      extract({
        cwd: dir,
        strip: 1,
        preservePaths: false,
        filter: (path, entry) => {
          const e = entry as unknown as { type?: string; size?: number };
          if (tooLarge || (e.type && e.type !== 'File' && e.type !== 'Directory' && e.type !== 'OldFile' && e.type !== 'ContiguousFile')) {
            return false;
          }
          if (SKIP_DIRS.test(`${path}/`) || SKIP_DIRS.test(path)) {
            return false;
          }
          const size = e.size ?? 0;
          if (e.type !== 'Directory' && size > limits.maxFileBytes) {
            skippedLarge++;
            return false;
          }
          bytes += size;
          if (bytes > limits.maxBytes) {
            tooLarge = true;
            return false;
          }
          if (e.type !== 'Directory') {
            files++;
          }
          return true;
        }
      })
    );
    if (tooLarge) {
      throw new HttpError(413, 'repository_too_large', `Repository exceeds ${Math.round(limits.maxBytes / 1048576)} MB of source files`);
    }
    await stat(dir);
    return { dir, bytes, files, skippedLarge, cleanup };
  } catch (err) {
    await cleanup();
    throw err;
  }
}
