import { HttpError } from '../http';
import { env } from '../env';
import { decryptSecret } from '../crypto';
import type { ProjectRecord } from '../store';
import { GitHubSource } from './github';
import { GitLabSource } from './gitlab';
import type { RepoSource } from './types';

let fetcherOverride: typeof fetch | null = null;

/** Test hook for mocking GitHub/GitLab HTTP calls. */
export function setFetcher(f: typeof fetch | null): void {
  fetcherOverride = f;
}

/** Local directories (development/tests only, ALLOW_LOCAL_REPOS=true) are scanned in place. */
class LocalSource implements RepoSource {
  async resolve(ref: string | null) {
    return { sha: 'local', ref: ref ?? 'working-tree' };
  }
  async tarball(): Promise<Response> {
    throw new HttpError(500, 'internal_error', 'Local sources are scanned in place');
  }
  webUrl() {
    return null;
  }
  repoUrl() {
    return null;
  }
}

export function sourceFor(project: ProjectRecord): RepoSource {
  const token = project.tokenEncrypted ? decryptSecret(project.tokenEncrypted) : null;
  const f = fetcherOverride ?? fetch;
  switch (project.provider) {
    case 'github':
      return new GitHubSource(project.repository, token, project.baseUrl, f);
    case 'gitlab':
      return new GitLabSource(project.repository, token, project.baseUrl, f);
    case 'none':
      throw new HttpError(400, 'no_repository', 'This project has no repository connection');
    case 'local':
      if (!env().allowLocalRepos) {
        throw new HttpError(400, 'invalid_request', 'Local repositories are disabled (ALLOW_LOCAL_REPOS)');
      }
      return new LocalSource();
  }
}

export type { RepoSource } from './types';
