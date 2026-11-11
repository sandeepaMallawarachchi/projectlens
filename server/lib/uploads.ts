import type { z } from 'zod';
import type { ScanResult } from '@/engine/models/types';
import { safeEvidence } from '@/engine/utils/redaction';
import { HttpError } from './http';
import { getStore, type ProjectRecord, type ScanRecord } from './store';
import { GitHubSource } from './git/github';
import { GitLabSource } from './git/gitlab';
import type { RepoSource } from './git/types';
import { overviewDto } from './dto';
import { env } from './env';
import { assertQuota } from './quotas';
import type { uploadSchema } from './validation';

/** Web links only need the repository coordinates (no token, no network). */
function linkSource(project: ProjectRecord): RepoSource | null {
  if (project.provider === 'github') {
    return new GitHubSource(project.repository, null, project.baseUrl);
  }
  if (project.provider === 'gitlab') {
    return new GitLabSource(project.repository, null, project.baseUrl);
  }
  return null;
}

/**
 * Sanitizes a scan result produced by the VS Code extension:
 * - removes every local `file://` URI (they reveal the developer's paths) and replaces it with a
 *   repository link at the uploaded commit when possible;
 * - re-applies secret redaction to finding evidence (defense in depth);
 * - keeps only the documented result fields.
 */
export function sanitizeUpload(raw: z.infer<typeof uploadSchema>['result'], project: ProjectRecord, commitSha: string | undefined): ScanResult {
  const result = structuredClone(raw) as unknown as ScanResult;
  const source = linkSource(project);
  const multiRoot = result.roots.length > 1;
  const rootNames = result.roots.map((r) => r.name);
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.uri === 'string') {
      let path = typeof obj.file === 'string' ? obj.file : null;
      if (path && multiRoot) {
        const root = rootNames.find((n) => path!.startsWith(`${n}/`));
        path = root ? path.slice(root.length + 1) : path;
      }
      obj.uri = source && commitSha && path ? (source.webUrl(commitSha, path, typeof obj.line === 'number' ? obj.line : undefined) ?? '') : '';
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        visit(value);
      }
    }
  };
  visit(result);
  result.roots = result.roots.map((r) => ({ name: r.name, uri: source?.repoUrl() ?? '' }));
  for (const f of result.findings) {
    f.evidence = safeEvidence(f.evidence ?? '');
  }
  result.warnings = (result.warnings ?? []).filter((w) => !/[A-Za-z]:\\|\/Users\/|\/home\//.test(w));
  return result;
}

export async function storeUpload(project: ProjectRecord, body: z.infer<typeof uploadSchema>, actor: string): Promise<ScanRecord> {
  await assertQuota(project.orgId, 'upload');
  if (JSON.stringify(body.result).length > 4 * 1024 * 1024) {
    throw new HttpError(413, 'payload_too_large', 'Scan result exceeds 4 MB');
  }
  const result = sanitizeUpload(body.result, project, body.commitSha);
  const store = getStore();
  const scan = await store.createScan({
    orgId: project.orgId,
    projectId: project.id,
    source: 'upload',
    status: 'completed',
    mode: result.mode,
    ref: body.branch ?? null,
    commitSha: body.commitSha ?? null,
    triggeredBy: actor,
    callbackUrl: null,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    error: null,
    summary: overviewDto(result),
    result
  });
  await store.pruneScans(project.orgId, project.id, env().scanHistoryLimit);
  return scan;
}
