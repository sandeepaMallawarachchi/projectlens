import { scanWorkspace } from '@/engine/core/scanner';
import { fileUri } from '@/engine/utils/paths';
import type { ScanMode, ScanResult } from '@/engine/models/types';
import { env } from './env';
import { HttpError } from './http';
import { getStore, type ProjectRecord, type ScanRecord } from './store';
import { sourceFor, type RepoSource } from './git';
import { downloadSnapshot } from './git/snapshot';
import { overviewDto, scanDto } from './dto';
import { sendWebhook } from './webhook';
import { assertQuota } from './quotas';

export interface StartScanOptions {
  mode: ScanMode;
  ref?: string | null;
  force?: boolean;
  triggeredBy: string;
  callbackUrl?: string | null;
}

export interface StartedScan {
  scan: ScanRecord;
  /** True when an existing result for the same commit was returned instead of scanning again. */
  cached: boolean;
  /** Executes the scan; undefined when cached. */
  run?: () => Promise<ScanRecord>;
}

/** A running scan older than this is considered abandoned (function crashed or timed out). */
const STALE_RUNNING_MS = 15 * 60 * 1000;

/**
 * Validates and records a scan request. Expensive work happens in `run()`, so the
 * route can answer immediately (202) and finish in the background.
 */
export async function startScan(project: ProjectRecord, opts: StartScanOptions): Promise<StartedScan> {
  const store = getStore();
  const e = env();
  if (project.provider === 'none') {
    throw new HttpError(400, 'no_repository', 'This project has no repository connection. Upload scans from the VS Code extension, or set a GitHub/GitLab repository.');
  }
  const recent = await store.listScans(project.orgId, project.id, { limit: 5, withResult: false });
  const active = recent.find((s) => (s.status === 'running' || s.status === 'queued') && Date.now() - new Date(s.createdAt).getTime() < STALE_RUNNING_MS);
  if (active) {
    throw new HttpError(409, 'scan_in_progress', 'A scan is already running for this project', { scanId: active.id });
  }

  const source = sourceFor(project);
  const resolved = await source.resolve(opts.ref ?? project.ref);

  // Same commit and mode already analyzed: reuse it (no download, no compute).
  const sameCommit = recent.find((s) => s.source === 'cloud' && s.status === 'completed' && s.commitSha === resolved.sha && s.mode === opts.mode && resolved.sha !== 'local');
  if (sameCommit && !opts.force) {
    return { scan: sameCommit, cached: true };
  }

  await assertQuota(project.orgId, 'cloudScan');
  const last = recent.find((s) => s.source === 'cloud');
  if (last && Date.now() - new Date(last.createdAt).getTime() < e.scanMinIntervalMs) {
    const retryAfter = Math.ceil((e.scanMinIntervalMs - (Date.now() - new Date(last.createdAt).getTime())) / 1000);
    throw new HttpError(429, 'rate_limited', `Scans for this project are limited to one every ${Math.round(e.scanMinIntervalMs / 1000)} s`, { retryAfterSeconds: retryAfter });
  }

  const scan = await store.createScan({
    orgId: project.orgId,
    projectId: project.id,
    source: 'cloud',
    status: 'queued',
    mode: opts.mode,
    ref: resolved.ref,
    commitSha: resolved.sha,
    triggeredBy: opts.triggeredBy,
    callbackUrl: opts.callbackUrl ?? null,
    startedAt: null,
    finishedAt: null,
    error: null,
    summary: null,
    result: null
  });
  return { scan, cached: false, run: () => executeScan(project, scan, source) };
}

async function executeScan(project: ProjectRecord, scan: ScanRecord, source: RepoSource): Promise<ScanRecord> {
  const store = getStore();
  const e = env();
  let current = await store.updateScan(scan.id, { status: 'running', startedAt: new Date().toISOString() });
  let cleanup: (() => Promise<void>) | null = null;
  try {
    let dir: string;
    const extraWarnings: string[] = [];
    if (project.provider === 'local') {
      dir = project.repository;
    } else {
      const snapshot = await downloadSnapshot(source, scan.commitSha!, { maxBytes: e.maxRepoBytes, maxFileBytes: e.maxFileBytes });
      cleanup = snapshot.cleanup;
      dir = snapshot.dir;
      if (snapshot.skippedLarge) {
        extraWarnings.push(`${snapshot.skippedLarge} file(s) larger than ${Math.round(e.maxFileBytes / 1024)} KB were not downloaded.`);
      }
    }
    const raw = await scanWorkspace({
      roots: [{ name: project.name, path: dir }],
      mode: scan.mode,
      respectGitignore: true,
      extraExcludes: [],
      maxFileSizeBytes: e.maxFileBytes,
      maxFiles: e.maxFiles,
      // External binaries are never executed on the server.
      gitleaks: { enabled: false, trusted: false, path: '', timeoutMs: 0 }
    });
    // The engine's "untrusted workspace" warning refers to Gitleaks being off, which is expected here.
    raw.warnings = [...raw.warnings.filter((w) => !/not trusted/i.test(w)), ...extraWarnings];
    const result = toPublicResult(raw, dir, source, scan.commitSha!);
    current = await store.updateScan(scan.id, { status: 'completed', finishedAt: new Date().toISOString(), result, summary: overviewDto(result) });
    await store.pruneScans(project.orgId, project.id, e.scanHistoryLimit);
  } catch (err) {
    const message = err instanceof HttpError ? err.message : err instanceof Error ? `Scan failed: ${err.message}` : 'Scan failed';
    console.error('[projectlens-api] scan failed', scan.id, err);
    current = await store.updateScan(scan.id, { status: 'failed', finishedAt: new Date().toISOString(), error: message });
  } finally {
    await cleanup?.().catch(() => undefined);
  }
  if (current.callbackUrl) {
    await sendWebhook(current.callbackUrl, current.status === 'completed' ? 'scan.completed' : 'scan.failed', { projectId: project.id, externalId: project.externalId, scan: scanDto(current) });
  }
  return current;
}

/**
 * Rewrites temporary `file://` URIs in the engine result to repository web links
 * (e.g. GitHub blob URLs at the scanned commit). Objects with a `uri` and optional `line` are handled generically.
 */
export function toPublicResult(result: ScanResult, dir: string, source: RepoSource, sha: string): ScanResult {
  const prefix = fileUri(dir).replace(/\/$/, '') + '/';
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.uri === 'string' && obj.uri.startsWith(prefix)) {
      const path = decodeURIComponent(obj.uri.slice(prefix.length));
      obj.uri = source.webUrl(sha, path, typeof obj.line === 'number' ? obj.line : undefined) ?? '';
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        visit(value);
      }
    }
  };
  const copy = structuredClone(result);
  visit(copy);
  copy.roots = copy.roots.map((r) => ({ ...r, uri: source.repoUrl() ?? '' }));
  return copy;
}
