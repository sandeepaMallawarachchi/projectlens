import { HttpError } from '../http';
import type { RepoSource, ResolvedRef } from './types';

/** GitLab.com and self-hosted GitLab (REST API v4). */
export class GitLabSource implements RepoSource {
  private readonly base: string;
  private readonly id: string;

  constructor(
    private readonly repository: string,
    private readonly token: string | null,
    baseUrl: string | null,
    private readonly fetcher: typeof fetch = fetch
  ) {
    this.base = (baseUrl ?? 'https://gitlab.com').replace(/\/+$/, '');
    this.id = encodeURIComponent(repository);
  }

  private async request(path: string): Promise<Response> {
    const res = await this.fetcher(`${this.base}/api/v4${path}`, {
      headers: { 'user-agent': 'projectlens-api', ...(this.token ? { 'private-token': this.token } : {}) },
      redirect: 'follow'
    });
    if (!res.ok) {
      throw gitlabError(res.status, this.repository);
    }
    return res;
  }

  async resolve(ref: string | null): Promise<ResolvedRef> {
    let target = ref;
    if (!target) {
      const project = (await (await this.request(`/projects/${this.id}`)).json()) as { default_branch?: string };
      target = project.default_branch ?? 'main';
    }
    const commit = (await (await this.request(`/projects/${this.id}/repository/commits/${encodeURIComponent(target)}`)).json()) as { id?: string };
    if (!commit.id || !/^[0-9a-f]{40}$/.test(commit.id)) {
      throw new HttpError(502, 'repository_error', 'GitLab returned an unexpected commit id');
    }
    return { sha: commit.id, ref: target };
  }

  tarball(sha: string): Promise<Response> {
    return this.request(`/projects/${this.id}/repository/archive.tar.gz?sha=${sha}`);
  }

  webUrl(sha: string, path: string, line?: number): string {
    return `${this.base}/${this.repository}/-/blob/${sha}/${path.split('/').map(encodeURIComponent).join('/')}${line ? `#L${line}` : ''}`;
  }

  repoUrl(): string {
    return `${this.base}/${this.repository}`;
  }
}

function gitlabError(status: number, repo: string): HttpError {
  if (status === 401) {
    return new HttpError(400, 'repository_auth_failed', 'GitLab rejected the access token (401). Use a token with the read_repository scope.');
  }
  if (status === 403) {
    return new HttpError(400, 'repository_forbidden', 'GitLab denied access (403). The token needs read_repository / read_api access to this project.');
  }
  if (status === 404) {
    return new HttpError(400, 'repository_not_found', `GitLab project or ref not found: ${repo}. Private projects require a token.`);
  }
  if (status === 429) {
    return new HttpError(429, 'repository_rate_limited', 'GitLab rate limit reached. Retry later.');
  }
  return new HttpError(502, 'repository_error', `GitLab request failed (${status})`);
}
