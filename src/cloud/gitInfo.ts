import { promises as fs } from 'node:fs';
import * as path from 'node:path';

export interface GitInfo {
  remoteUrl: string | null;
  branch: string | null;
  commitSha: string | null;
}

export interface RemoteRepository {
  provider: 'github' | 'gitlab';
  repository: string;
  baseUrl: string | null;
  webUrl: string;
}

async function read(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Resolves the git directory, including worktrees/submodules where `.git` is a file. */
async function gitDir(root: string): Promise<string | null> {
  const dotGit = path.join(root, '.git');
  try {
    const stat = await fs.stat(dotGit);
    if (stat.isDirectory()) {
      return dotGit;
    }
    const content = await read(dotGit);
    const m = content && /^gitdir:\s*(.+)$/m.exec(content);
    return m ? path.resolve(root, m[1].trim()) : null;
  } catch {
    return null;
  }
}

/**
 * Reads remote, branch and HEAD commit from .git files. Git itself is never executed.
 */
export async function readGitInfo(root: string): Promise<GitInfo> {
  const dir = await gitDir(root);
  if (!dir) {
    return { remoteUrl: null, branch: null, commitSha: null };
  }
  const commonDir = (await read(path.join(dir, 'commondir')))?.trim();
  const shared = commonDir ? path.resolve(dir, commonDir) : dir;
  const config = (await read(path.join(shared, 'config'))) ?? '';
  const origin = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(config) ?? /\[remote "[^"]+"\][^[]*?url\s*=\s*(\S+)/.exec(config);
  const head = ((await read(path.join(dir, 'HEAD'))) ?? '').trim();
  let branch: string | null = null;
  let commitSha: string | null = null;
  const ref = /^ref:\s*(refs\/heads\/(.+))$/.exec(head);
  if (ref) {
    branch = ref[2];
    commitSha = ((await read(path.join(shared, ref[1]))) ?? (await read(path.join(dir, ref[1]))) ?? '').trim() || null;
    if (!commitSha) {
      const packed = (await read(path.join(shared, 'packed-refs'))) ?? '';
      const line = packed.split('\n').find((l) => l.endsWith(` ${ref[1]}`));
      commitSha = line ? line.split(' ')[0] : null;
    }
  } else if (/^[0-9a-f]{40}$/.test(head)) {
    commitSha = head;
  }
  return { remoteUrl: origin ? origin[1] : null, branch, commitSha: commitSha && /^[0-9a-f]{40}$/.test(commitSha) ? commitSha : null };
}

/** Parses https and SSH remotes (git@host:owner/repo.git, ssh://git@host/owner/repo). Credentials in URLs are dropped. */
export function parseRemote(remoteUrl: string): RemoteRepository | null {
  let host: string;
  let repoPath: string;
  const scp = /^[\w.-]+@([^:/]+):(.+)$/.exec(remoteUrl);
  if (scp) {
    host = scp[1];
    repoPath = scp[2];
  } else {
    try {
      const url = new URL(remoteUrl);
      host = url.hostname;
      repoPath = url.pathname;
    } catch {
      return null;
    }
  }
  repoPath = repoPath.replace(/^\/+/, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (repoPath.split('/').length < 2) {
    return null;
  }
  const lowered = host.toLowerCase();
  const provider: 'github' | 'gitlab' = lowered === 'github.com' || lowered.includes('github') ? 'github' : 'gitlab';
  const isDefault = lowered === 'github.com' || lowered === 'gitlab.com';
  const origin = `https://${host}`;
  return { provider, repository: repoPath, baseUrl: isDefault ? null : origin, webUrl: `${origin}/${repoPath}` };
}
