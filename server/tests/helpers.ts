import { resolve } from 'node:path';
import { c as createTar } from 'tar';
import { setStore } from '@/lib/store';
import { MemoryStore } from '@/lib/store/memory';
import { setFetcher } from '@/lib/git';
import { setProviderFactory } from '@/lib/ai-runner';
import { setAccountsFetcher, signInWithGitHub } from '@/lib/accounts';
import { setEmailSender } from '@/lib/email';

export const FIXTURES = resolve(__dirname, '../../tests/fixtures');
export const ADMIN = 'test-admin-key-1234567890';
export const SHA = 'a'.repeat(40);

export function resetEnv(extra: Record<string, string> = {}) {
  for (const k of Object.keys(process.env)) {
    if (/^(PROJECTLENS_|SUPABASE_|STORAGE|ALLOW_|SCAN_|MAX_|AI_|GROQ_|OPENAI_|GEMINI_|ANTHROPIC_|WEBHOOK_|GITLAB_|FREE_|RESEND_|EMAIL_)/.test(k)) {
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
  setEmailSender(null);
  setAccountsFetcher(githubAccounts);
  return store;
}

/** Fake GitHub identity API: token "gh-<login>" belongs to user <login> with email <login>@example.com. */
const githubAccounts = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const token = new Headers(init?.headers).get('authorization')?.replace('Bearer ', '') ?? '';
  const login = token.startsWith('gh-') ? token.slice(3) : null;
  if (!login) {
    return new Response('{"message":"Bad credentials"}', { status: 401 });
  }
  const id = [...login].reduce((h, c) => h * 31 + c.charCodeAt(0), 7);
  if (String(input).endsWith('/user')) {
    return Response.json({ id, login, name: login.toUpperCase(), avatar_url: null });
  }
  return Response.json([{ email: `${login}@example.com`, primary: true, verified: true }]);
}) as typeof fetch;

/** Signs a user in via (mocked) GitHub and returns their session token and first org id. */
export async function signIn(login: string): Promise<{ token: string; orgId: string; userId: string }> {
  const session = await signInWithGitHub(`gh-${login}`, 'test');
  const { getStore } = await import('@/lib/store');
  const [membership] = await getStore().listMembershipsForUser(session.user.id);
  return { token: session.token, orgId: membership.orgId, userId: session.user.id };
}

export function req(method: string, path: string, body?: unknown, token: string | null = null, headers: Record<string, string> = {}): Request {
  return new Request(`https://api.test${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
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
