export interface ResolvedRef {
  sha: string;
  ref: string;
}

/** A source that can resolve refs, provide a tarball of a commit and build web links. */
export interface RepoSource {
  resolve(ref: string | null): Promise<ResolvedRef>;
  /** Tarball (gzip) of the commit, with one top-level directory. */
  tarball(sha: string): Promise<Response>;
  /** Browser URL to a file (and line) at a commit, or null when not applicable. */
  webUrl(sha: string, path: string, line?: number): string | null;
  repoUrl(): string | null;
}
