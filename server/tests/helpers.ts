import { resolve } from 'node:path';
import { c as createTar } from 'tar';
import { setStore } from '@/lib/store';
import { MemoryStore } from '@/lib/store/memory';
import { setFetcher } from '@/lib/git';
import { setProviderFactory } from '@/lib/ai-runner';

export const FIXTURES = resolve(__dirname, '../../tests/fixtures');
export const ADMIN = 'test-admin-key-1234567890';
export const SHA = 'a'.repeat(40);

export function resetEnv(extra: Record<string, string> = {}) {
  for (const k of Object.keys(process.env)) {
    if (/^(PROJECTLENS_|SUPABASE_|STORAGE|ALLOW_LOCAL_REPOS|SCAN_|MAX_|AI_|GROQ_|OPENAI_|GEMINI_|ANTHROPIC_|WEBHOOK_|GITLAB_)/.test(k)) {
      delete process.env[k];
    }
  }
  Object.assign(process.env, {
    PROJECTLENS_ADMIN_KEY: ADMIN,
    PROJECTLENS_ENCRYPTION_KEY: 'test-encryption-passphrase',
    STORAGE: 'memory',
    ALLOW_LOCAL_REPOS: 'true',
    ...extra
  });
  const store = new MemoryStore();
  setStore(store);
  setFetcher(null);
  setProviderFactory(null);
  return store;
}

export function req(method: string, path: string, body?: unknown, key: string | null = ADMIN): Request {
  return new Request(`https://api.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
}

export const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

export async function body<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Builds a GitHub/GitLab-style tarball (one top-level directory) of a fixture folder. */
export async function fixtureTarball(name: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const stream = createTar({ gzip: true, cwd: resolve(FIXTURES, name), prefix: `repo-${SHA.slice(0, 7)}/`, portable: true }, ['.']);
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
