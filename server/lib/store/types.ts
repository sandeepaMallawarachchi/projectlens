import type { ScanMode, ScanResult } from '@/engine/models/types';
import type { AIInsight } from '@/engine/models/ai';
import type { ScanOverview } from '../dto';

export type GitProviderId = 'github' | 'gitlab' | 'local';

export interface ProjectRecord {
  id: string;
  name: string;
  provider: GitProviderId;
  /** `owner/repo` (GitHub), `group/subgroup/project` or numeric id (GitLab), or a path (local). */
  repository: string;
  /** Self-hosted GitLab base URL (default https://gitlab.com). */
  baseUrl: string | null;
  /** Branch, tag or commit to scan; null = default branch. */
  ref: string | null;
  /** Encrypted repository access token; never returned by the API. */
  tokenEncrypted: string | null;
  /** Identifier of the project in the calling system (e.g. the PM tool). */
  externalId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ScanRecord {
  id: string;
  projectId: string;
  status: ScanStatus;
  mode: ScanMode;
  ref: string | null;
  commitSha: string | null;
  triggeredBy: string | null;
  callbackUrl: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** Compact overview (scores, counts, progress) used by list and trend endpoints. */
  summary: ScanOverview | null;
  /** Full engine result with repository-relative paths and web links (no source code). */
  result: ScanResult | null;
}

export interface InsightRecord extends AIInsight {
  projectId: string;
  scanId: string;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: ApiScope[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export const API_SCOPES = ['read', 'scan', 'ai', 'admin'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface Store {
  createProject(p: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProjectRecord>;
  getProject(id: string): Promise<ProjectRecord | null>;
  findProjectByExternalId(externalId: string): Promise<ProjectRecord | null>;
  listProjects(): Promise<ProjectRecord[]>;
  updateProject(id: string, patch: Partial<Omit<ProjectRecord, 'id' | 'createdAt'>>): Promise<ProjectRecord>;
  deleteProject(id: string): Promise<void>;

  createScan(s: Omit<ScanRecord, 'id' | 'createdAt'>): Promise<ScanRecord>;
  getScan(id: string): Promise<ScanRecord | null>;
  updateScan(id: string, patch: Partial<Omit<ScanRecord, 'id' | 'projectId' | 'createdAt'>>): Promise<ScanRecord>;
  /** Newest first. `withResult: false` omits the heavy result payload (summary is always included). */
  listScans(projectId: string, opts: { limit: number; withResult: boolean }): Promise<ScanRecord[]>;
  /** Removes all but the newest `keep` scans of a project. */
  pruneScans(projectId: string, keep: number): Promise<void>;

  addInsight(i: InsightRecord): Promise<InsightRecord>;
  listInsights(filter: { projectId?: string; scanId?: string; limit: number }): Promise<InsightRecord[]>;

  createApiKey(k: Omit<ApiKeyRecord, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>): Promise<ApiKeyRecord>;
  findApiKeyByHash(hash: string): Promise<ApiKeyRecord | null>;
  listApiKeys(): Promise<ApiKeyRecord[]>;
  touchApiKey(id: string): Promise<void>;
  revokeApiKey(id: string): Promise<void>;
}
