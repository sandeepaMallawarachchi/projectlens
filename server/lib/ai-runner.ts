import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import { AIService } from '@/engine/ai/aiService';
import { AIError, describeAIError } from '@/engine/ai/errors';
import { createProvider } from '@/engine/ai/providers';
import type { AIProvider } from '@/engine/ai/AIProvider';
import { AI_PROVIDERS, type AIInsight, type AIProviderId, type AITask } from '@/engine/models/ai';
import type { ScanResult } from '@/engine/models/types';
import { fileUri, isInside, uriToPath } from '@/engine/utils/paths';
import { env } from './env';
import { decryptSecret } from './crypto';
import { assertQuota } from './quotas';
import { HttpError } from './http';
import { getStore, type InsightRecord, type ProjectRecord, type ScanRecord } from './store';
import { sourceFor } from './git';
import { downloadSnapshot } from './git/snapshot';

export interface AIRequest {
  task: AITask;
  provider?: AIProviderId;
  model?: string;
  findingId?: string;
  moduleId?: string;
  /** Repository-relative file path for `reviewFile`. */
  file?: string;
}

type ProviderFactory = (id: AIProviderId, apiKey: string) => AIProvider;
let providerFactory: ProviderFactory | null = null;

/** Test hook to replace real AI providers. */
export function setProviderFactory(f: ProviderFactory | null): void {
  providerFactory = f;
}

const MAX_AI_FILE_BYTES = 1024 * 1024;
const AI_MIN_INTERVAL_MS = () => Number(process.env.AI_MIN_INTERVAL_SECONDS ?? 10) * 1000;

/**
 * Runs an AI analysis on a completed scan using server-side provider keys. The scanned
 * commit is re-downloaded only for the duration of the request so redacted excerpts can be
 * included; it is deleted afterwards. Calling this endpoint is the consent to send context.
 */
export async function runInsight(project: ProjectRecord, scan: ScanRecord, req: AIRequest): Promise<InsightRecord> {
  const e = env();
  if (scan.status !== 'completed' || !scan.result) {
    throw new HttpError(409, 'scan_not_completed', 'AI insights require a completed scan');
  }
  const store = getStore();
  const org = await store.getOrg(project.orgId);
  const orgKeys = await store.listOrgAiKeys(project.orgId);
  // Provider: explicit request, the organization's default, or the only configured key.
  const providerId = req.provider ?? org?.aiProvider ?? orgKeys[0]?.provider ?? e.ai.provider;
  const orgKey = orgKeys.find((k) => k.provider === providerId);
  // Organizations bring their own keys; server keys are used only when explicitly allowed.
  const apiKey = orgKey ? decryptSecret(orgKey.keyEncrypted) : e.allowServerAiKeys ? e.ai.keys[providerId] : undefined;
  if (!apiKey) {
    throw new HttpError(400, 'ai_not_configured', `No ${AI_PROVIDERS[providerId].label} API key is set for this organization. Add one in VS Code: ProjectLens → Cloud → AI keys.`);
  }
  if (req.task === 'reviewFile' && !req.file) {
    throw new HttpError(400, 'invalid_request', '"file" is required for reviewFile');
  }

  await assertQuota(project.orgId, 'ai');
  const [latest] = await store.listInsights(project.orgId, { projectId: project.id, limit: 1 });
  if (latest && Date.now() - new Date(latest.createdAt).getTime() < AI_MIN_INTERVAL_MS()) {
    throw new HttpError(429, 'rate_limited', 'AI requests for this project are rate limited; retry shortly');
  }

  const source = sourceFor(project);
  let dir = project.repository;
  let cleanup: (() => Promise<void>) | null = null;
  if (project.provider !== 'local') {
    const snap = await downloadSnapshot(source, scan.commitSha!, { maxBytes: e.maxRepoBytes, maxFileBytes: e.maxFileBytes });
    dir = snap.dir;
    cleanup = snap.cleanup;
  }
  try {
    const local = toLocalResult(scan.result, dir);
    const provider = providerFactory
      ? providerFactory(providerId, apiKey)
      : createProvider(providerId, { getApiKey: async () => apiKey, timeoutMs: () => e.ai.timeoutMs, maxRetries: () => e.ai.maxRetries });
    const model = req.model ?? (org?.aiProvider === providerId && org.aiModel ? org.aiModel : !orgKey && providerId === e.ai.provider ? e.ai.model : AI_PROVIDERS[providerId].defaultModel);
    const service = new AIService({
      provider: () => provider,
      settings: () => ({ model, maxContextTokens: e.ai.maxContextTokens, maxOutputTokens: e.ai.maxOutputTokens, maxRequestsPerSession: Number.MAX_SAFE_INTEGER, maxConcurrentRequests: 2 }),
      readFile: async (uri) => {
        const p = uriToPath(uri);
        if (!p || !isInside(dir, p)) {
          return null;
        }
        try {
          const stat = await fs.stat(p);
          return stat.size > MAX_AI_FILE_BYTES ? null : await fs.readFile(p, 'utf8');
        } catch {
          return null;
        }
      },
      consent: async () => true
    });
    let insight: AIInsight;
    try {
      insight = await service.run(
        {
          task: req.task,
          scan: local,
          findingId: req.findingId,
          moduleId: req.moduleId,
          fileUri: req.file ? fileUri(resolve(dir, req.file)) : undefined,
          filePath: req.file
        },
        AbortSignal.timeout(e.ai.timeoutMs * 2)
      );
    } catch (err) {
      if (err instanceof AIError) {
        const status = err.kind === 'rate-limit' ? 429 : err.kind === 'auth' || err.kind === 'forbidden' ? 502 : err.kind === 'model' ? 400 : 502;
        throw new HttpError(status, `ai_${err.kind.replace(/-/g, '_')}`, describeAIError(err, AI_PROVIDERS[providerId].label));
      }
      if (err instanceof Error && /not found in the latest scan|No file selected/.test(err.message)) {
        throw new HttpError(400, 'invalid_request', err.message);
      }
      throw err;
    }
    // Replace temporary file links with repository web links.
    const fileUris: Record<string, string> = {};
    for (const path of Object.keys(insight.fileUris)) {
      fileUris[path] = source.webUrl(scan.commitSha!, path) ?? '';
    }
    return await store.addInsight({ ...insight, fileUris, orgId: project.orgId, projectId: project.id, scanId: scan.id });
  } finally {
    await cleanup?.().catch(() => undefined);
  }
}

/** Points every location in a stored (web-linked) result at files in `dir`. */
function toLocalResult(result: ScanResult, dir: string): ScanResult {
  const copy = structuredClone(result);
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (!node || typeof node !== 'object') {
      return;
    }
    const obj = node as Record<string, unknown>;
    if (typeof obj.file === 'string' && 'uri' in obj) {
      obj.uri = fileUri(join(dir, obj.file));
    }
    for (const value of Object.values(obj)) {
      if (value && typeof value === 'object') {
        visit(value);
      }
    }
  };
  visit(copy);
  copy.roots = copy.roots.map((r) => ({ ...r, uri: fileUri(dir) }));
  return copy;
}

/** Checks an AI provider key by listing models (no tokens are spent). */
export async function validateProviderKey(providerId: AIProviderId, apiKey: string): Promise<void> {
  const provider = providerFactory
    ? providerFactory(providerId, apiKey)
    : createProvider(providerId, { getApiKey: async () => apiKey, timeoutMs: () => 20_000, maxRetries: () => 1 });
  try {
    await provider.listModels();
  } catch (err) {
    const label = AI_PROVIDERS[providerId].label;
    const message = err instanceof AIError ? describeAIError(err, label) : `Could not verify the ${label} key`;
    throw new HttpError(400, 'invalid_ai_key', message);
  }
}
