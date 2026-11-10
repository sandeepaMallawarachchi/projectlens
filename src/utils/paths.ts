import * as path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

export function fileUri(absPath: string): string {
  return pathToFileURL(absPath).toString();
}

export function uriToPath(uri: string): string | null {
  try {
    if (!uri.startsWith('file:')) {
      return null;
    }
    return fileURLToPath(uri);
  } catch {
    return null;
  }
}

/** True when `child` is located inside (or equal to) `parent`. Resolves `..` segments. */
export function isInside(parent: string, child: string): boolean {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function basename(p: string): string {
  const idx = p.lastIndexOf('/');
  return idx >= 0 ? p.slice(idx + 1) : p;
}
