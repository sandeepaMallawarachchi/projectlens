import { promises as fs, type Dirent } from 'node:fs';
import * as path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { fileUri, toPosix } from '../utils/paths';
import { detectLanguage, extensionOf } from './languages';
import { throwIfCancelled, yieldToEventLoop } from '../utils/async';

export const DEFAULT_EXCLUDES = [
  'node_modules/', '.git/', '.next/', '.nuxt/', '.svelte-kit/', '.turbo/', '.vercel/', '.output/',
  'dist/', 'build/', 'out/', 'coverage/', '.cache/', '.parcel-cache/', '.vscode-test/', 'vendor/',
  '__pycache__/', '.venv/', 'venv/', 'target/', '.idea/', '.DS_Store', '*.min.js', '*.min.css', '*.map',
  '*.vsix', '*.lock.json'
];

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp', 'tiff', 'avif', 'psd', 'mp3', 'mp4', 'mov', 'avi', 'webm',
  'wav', 'ogg', 'flac', 'zip', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'tar', 'jar', 'war', 'exe', 'dll', 'so',
  'dylib', 'bin', 'o', 'a', 'class', 'pyc', 'wasm', 'woff', 'woff2', 'ttf', 'otf', 'eot', 'pdf', 'doc', 'docx',
  'xls', 'xlsx', 'ppt', 'pptx', 'sqlite', 'db', 'node', 'p12', 'pfx', 'jks', 'keystore', 'der'
]);

/** Credential containers detected by name even though their content is binary or skipped. */
export const SENSITIVE_FILE_PATTERNS: { regex: RegExp; label: string }[] = [
  { regex: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, label: 'SSH private key' },
  { regex: /\.(pem|key)$/i, label: 'PEM/key file' },
  { regex: /\.(p12|pfx|jks|keystore)$/i, label: 'Certificate/keystore' },
  { regex: /(^|\/)(credentials|client_secret[\w-]*|service[-_]?account[\w-]*)\.json$/i, label: 'Cloud credential JSON' },
  { regex: /(^|\/)\.htpasswd$/, label: 'htpasswd file' },
  { regex: /(^|\/)\.pgpass$/, label: 'PostgreSQL password file' }
];

export interface DiscoveredFile {
  root: string;
  rootName: string;
  absPath: string;
  /** Path relative to its workspace folder (posix). */
  relPath: string;
  /** Display path, prefixed with the folder name in multi-root workspaces. */
  displayPath: string;
  uri: string;
  size: number;
  mtimeMs: number;
  language?: string;
  binary: boolean;
  tooLarge: boolean;
}

export interface DiscoveryOptions {
  roots: { name: string; path: string }[];
  respectGitignore: boolean;
  extraExcludes: string[];
  maxFileSizeBytes: number;
  maxFiles: number;
  signal?: AbortSignal;
  onProgress?: (count: number) => void;
}

export interface DiscoveryResult {
  files: DiscoveredFile[];
  skipped: Map<string, number>;
  /** Root-level dotenv files (discovered regardless of ignore rules) and whether Git ignores them. */
  envFiles: { file: DiscoveredFile; gitignored: boolean }[];
  truncated: boolean;
}

async function readIgnoreFile(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

interface IgnoreScope {
  base: string; // posix relative dir ('' for root)
  matcher: Ignore;
}

function isIgnoredBy(scopes: IgnoreScope[], relPath: string, isDir: boolean): boolean {
  for (const scope of scopes) {
    if (scope.base && !relPath.startsWith(scope.base + '/')) {
      continue;
    }
    const sub = scope.base ? relPath.slice(scope.base.length + 1) : relPath;
    if (sub && scope.matcher.ignores(isDir ? `${sub}/` : sub)) {
      return true;
    }
  }
  return false;
}

export async function discoverFiles(options: DiscoveryOptions): Promise<DiscoveryResult> {
  const files: DiscoveredFile[] = [];
  const skipped = new Map<string, number>();
  const envFiles: DiscoveryResult['envFiles'] = [];
  const bump = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  const multiRoot = options.roots.length > 1;
  let truncated = false;

  for (const root of options.roots) {
    const defaults = ignore().add(DEFAULT_EXCLUDES).add(options.extraExcludes);
    const gitScopes: IgnoreScope[] = [];
    const rootGitignore = await readIgnoreFile(path.join(root.path, '.gitignore'));
    const rootGitMatcher = ignore();
    if (rootGitignore) {
      rootGitMatcher.add(rootGitignore);
    }
    gitScopes.push({ base: '', matcher: rootGitMatcher });

    let rootCount = 0;
    const makeEntry = (abs: string, rel: string, stat: { size: number; mtimeMs: number }): DiscoveredFile => {
      const ext = extensionOf(rel);
      return {
        root: root.path,
        rootName: root.name,
        absPath: abs,
        relPath: rel,
        displayPath: multiRoot ? `${root.name}/${rel}` : rel,
        uri: fileUri(abs),
        size: stat.size,
        mtimeMs: stat.mtimeMs,
        language: detectLanguage(rel),
        binary: BINARY_EXTENSIONS.has(ext),
        tooLarge: stat.size > options.maxFileSizeBytes
      };
    };

    // Root-level env files are inspected even when ignored, to verify they are ignored.
    try {
      for (const name of await fs.readdir(root.path)) {
        if (/^\.env(\..+)?$/.test(name)) {
          const abs = path.join(root.path, name);
          const stat = await fs.stat(abs);
          if (stat.isFile()) {
            envFiles.push({ file: makeEntry(abs, name, stat), gitignored: rootGitMatcher.ignores(name) });
          }
        }
      }
    } catch {
      // Unreadable root; reported by the walk below.
    }

    const stack: string[] = [''];
    let visited = 0;
    while (stack.length > 0) {
      throwIfCancelled(options.signal);
      const relDir = stack.pop()!;
      const absDir = path.join(root.path, relDir);
      let entries: Dirent[];
      try {
        entries = await fs.readdir(absDir, { withFileTypes: true });
      } catch {
        bump('unreadable directory');
        continue;
      }
      if (options.respectGitignore && relDir) {
        const nested = entries.find((e) => e.isFile() && e.name === '.gitignore');
        if (nested) {
          const content = await readIgnoreFile(path.join(absDir, '.gitignore'));
          if (content) {
            gitScopes.push({ base: relDir, matcher: ignore().add(content) });
          }
        }
      }
      for (const entry of entries) {
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) {
          bump('symbolic link');
          continue;
        }
        const isDir = entry.isDirectory();
        if (!isDir && !entry.isFile()) {
          continue;
        }
        if (defaults.ignores(isDir ? `${rel}/` : rel)) {
          if (!isDir) {
            bump('excluded by pattern');
          }
          continue;
        }
        if (options.respectGitignore && isIgnoredBy(gitScopes, rel, isDir)) {
          if (!isDir) {
            bump('ignored by .gitignore');
          }
          continue;
        }
        if (isDir) {
          stack.push(rel);
          continue;
        }
        if (rootCount >= options.maxFiles) {
          truncated = true;
          bump('file limit reached');
          continue;
        }
        const abs = path.join(absDir, entry.name);
        let stat;
        try {
          stat = await fs.stat(abs);
        } catch {
          bump('unreadable file');
          continue;
        }
        const discovered = makeEntry(abs, toPosix(rel), stat);
        if (discovered.binary) {
          bump('binary file');
        } else if (discovered.tooLarge) {
          bump('file too large');
        }
        files.push(discovered);
        rootCount++;
        if (++visited % 200 === 0) {
          options.onProgress?.(files.length);
          await yieldToEventLoop();
        }
      }
    }
  }
  options.onProgress?.(files.length);
  files.sort((a, b) => a.displayPath.localeCompare(b.displayPath));
  return { files, skipped, envFiles, truncated };
}
