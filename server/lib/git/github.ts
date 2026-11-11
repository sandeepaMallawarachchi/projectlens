import { HttpError } from '../http';
import type { RepoSource, ResolvedRef } from './types';

/** GitHub and GitHub Enterprise (baseUrl = https://github.example.com). */
export class GitHubSource implements RepoSource {
  private readonly api: string;
  private readonly web: string;

  constructor(
    private readonly repository: string,
    private readonly token: string | null,
    baseUrl: string | null,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.web = (baseUrl ?? 'https://github.com').replace(/\/+$/, '');
    this.api = baseUrl ? `${this.web}/api/v3` : 'https://api.github.com';
  }

  private headers(accept = 'application/vnd.github+json'): Record<string, string> {
    return {
      accept,
      'user-agent': 'projectlens-api',
      'x-github-api-version': '2022-11-28',
      ...(this.token ? { authorization: `Bearer ${this.token}` } : {})
    };
  }

  private async request(path: string, accept?: string): Promise<Response> {
    const res = await this.fetcher(`${this.api}${path}`, { headers: this.headers(accept), redirect: 'follow' });
    if (!res.ok) {
      throw githubError(res.status, this.repository);
    }
    return res;
  }

  async resolve(ref: string | null): Promise<ResolvedRef> {
    let target = ref;
    if (!target) {
      const repo = (await (await this.request(`/repos/${this.repository}`)).json()) as { default_branch?: string };
      target = repo.default_branch ?? 'main';
    }
    const sha = (await (await this.request(`/repos/${this.repository}/commits/${encodeURIComponent(target)}`, 'application/vnd.github.sha')).text()).trim();
    if (!/^[0-9a-f]{40}$/.test(sha)) {
      throw new HttpError(502, 'repository_error', 'GitHub returned an unexpected commit id');
    }
    return { sha, ref: target };
  }

  tarball(sha: string): Promise<Response> {
    return this.request(`/repos/${this.repository}/tarball/${sha}`);
  }

  webUrl(sha: string, path: string, line?: number): string {
    return `${this.web}/${this.repository}/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}${line ? `#L${line}` : ''}`;
  }

  repoUrl(): string {
    return `${this.web}/${this.repository}`;
  }
}

function githubError(status: number, repo: string): HttpError {
  if (status === 401) {
    return new HttpError(400, 'repository_auth_failed', 'GitHub rejected the access token (401). Update the project token.');
  }
  if (status === 403 || status === 429) {
    return new HttpError(429, 'repository_rate_limited', 'GitHub denied the request (rate limit or missing token permissions).');
  }
  if (status === 404) {
    return new HttpError(400, 'repository_not_found', `GitHub repository or ref not found: ${repo}. Private repositories need a token with read access to contents.`);
  }
  return new HttpError(502, 'repository_error', `GitHub request failed (${status})`);
}
