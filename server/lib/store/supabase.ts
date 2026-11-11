import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ApiKeyRecord, ApiScope, InsightRecord, ProjectRecord, ScanRecord, Store } from './types';
import { HttpError, notFound } from '../http';

/* Row <-> record mapping (snake_case columns, see supabase/schema.sql). */
type Row = Record<string, unknown>;

const toProject = (r: Row): ProjectRecord => ({
  id: r.id as string,
  name: r.name as string,
  provider: r.provider as ProjectRecord['provider'],
  repository: r.repository as string,
  baseUrl: (r.base_url as string) ?? null,
  ref: (r.ref as string) ?? null,
  tokenEncrypted: (r.token_encrypted as string) ?? null,
  externalId: (r.external_id as string) ?? null,
  metadata: (r.metadata as Record<string, unknown>) ?? {},
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string
});

const fromProject = (p: Partial<ProjectRecord>): Row => {
  const row: Row = {};
  const map: [keyof ProjectRecord, string][] = [
    ['name', 'name'], ['provider', 'provider'], ['repository', 'repository'], ['baseUrl', 'base_url'], ['ref', 'ref'],
    ['tokenEncrypted', 'token_encrypted'], ['externalId', 'external_id'], ['metadata', 'metadata']
  ];
  for (const [k, col] of map) {
    if (k in p) {
      row[col] = p[k];
    }
  }
  return row;
};

const toScan = (r: Row): ScanRecord => ({
  id: r.id as string,
  projectId: r.project_id as string,
  status: r.status as ScanRecord['status'],
  mode: r.mode as ScanRecord['mode'],
  ref: (r.ref as string) ?? null,
  commitSha: (r.commit_sha as string) ?? null,
  triggeredBy: (r.triggered_by as string) ?? null,
  callbackUrl: (r.callback_url as string) ?? null,
  createdAt: r.created_at as string,
  startedAt: (r.started_at as string) ?? null,
  finishedAt: (r.finished_at as string) ?? null,
  error: (r.error as string) ?? null,
  summary: (r.summary as ScanRecord['summary']) ?? null,
  result: (r.result as ScanRecord['result']) ?? null
});

const fromScan = (s: Partial<ScanRecord>): Row => {
  const row: Row = {};
  const map: [keyof ScanRecord, string][] = [
    ['projectId', 'project_id'], ['status', 'status'], ['mode', 'mode'], ['ref', 'ref'], ['commitSha', 'commit_sha'],
    ['triggeredBy', 'triggered_by'], ['callbackUrl', 'callback_url'], ['startedAt', 'started_at'], ['finishedAt', 'finished_at'],
    ['error', 'error'], ['summary', 'summary'], ['result', 'result']
  ];
  for (const [k, col] of map) {
    if (k in s) {
      row[col] = s[k];
    }
  }
  return row;
};

const toKey = (r: Row): ApiKeyRecord => ({
  id: r.id as string,
  name: r.name as string,
  prefix: r.prefix as string,
  keyHash: r.key_hash as string,
  scopes: (r.scopes as ApiScope[]) ?? [],
  createdAt: r.created_at as string,
  lastUsedAt: (r.last_used_at as string) ?? null,
  revokedAt: (r.revoked_at as string) ?? null
});

const toInsight = (r: Row): InsightRecord => ({ ...(r.data as InsightRecord), projectId: r.project_id as string, scanId: r.scan_id as string });

const SCAN_LIST_COLUMNS = 'id, project_id, status, mode, ref, commit_sha, triggered_by, callback_url, created_at, started_at, finished_at, error, summary';

/** Supabase Postgres store. Uses the service-role key server-side; tables have RLS enabled with no public policies. */
export class SupabaseStore implements Store {
  private readonly db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private check<T>(res: { data: T; error: { message: string; code?: string } | null }): T {
    if (res.error) {
      if (res.error.code === '23505') {
        throw new HttpError(409, 'conflict', 'A record with the same unique value already exists');
      }
      throw new HttpError(500, 'storage_error', res.error.message);
    }
    return res.data;
  }

  private one(res: { data: Row | null; error: { message: string; code?: string } | null }): Row {
    const row = this.check(res);
    if (!row) {
      throw new HttpError(500, 'storage_error', 'Insert returned no row');
    }
    return row;
  }

  async createProject(p: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    return toProject(this.one(await this.db.from('projects').insert(fromProject(p)).select().single()));
  }
  async getProject(id: string) {
    const data = this.check(await this.db.from('projects').select().eq('id', id).maybeSingle());
    return data ? toProject(data) : null;
  }
  async findProjectByExternalId(externalId: string) {
    const data = this.check(await this.db.from('projects').select().eq('external_id', externalId).maybeSingle());
    return data ? toProject(data) : null;
  }
  async listProjects() {
    return (this.check(await this.db.from('projects').select().order('created_at', { ascending: false })) ?? []).map(toProject);
  }
  async updateProject(id: string, patch: Partial<ProjectRecord>) {
    const data = this.check(await this.db.from('projects').update({ ...fromProject(patch), updated_at: new Date().toISOString() }).eq('id', id).select().maybeSingle());
    if (!data) {
      throw notFound('Project');
    }
    return toProject(data);
  }
  async deleteProject(id: string) {
    this.check(await this.db.from('projects').delete().eq('id', id));
  }

  async createScan(s: Omit<ScanRecord, 'id' | 'createdAt'>) {
    return toScan(this.one(await this.db.from('scans').insert(fromScan(s)).select().single()));
  }
  async getScan(id: string) {
    const data = this.check(await this.db.from('scans').select().eq('id', id).maybeSingle());
    return data ? toScan(data) : null;
  }
  async updateScan(id: string, patch: Partial<ScanRecord>) {
    const data = this.check(await this.db.from('scans').update(fromScan(patch)).eq('id', id).select().maybeSingle());
    if (!data) {
      throw notFound('Scan');
    }
    return toScan(data);
  }
  async listScans(projectId: string, opts: { limit: number; withResult: boolean }) {
    const rows = this.check(
      await this.db.from('scans').select(opts.withResult ? '*' : SCAN_LIST_COLUMNS).eq('project_id', projectId).order('created_at', { ascending: false }).limit(opts.limit)
    ) as unknown as Row[];
    return (rows ?? []).map(toScan);
  }
  async pruneScans(projectId: string, keep: number) {
    const rows = this.check(await this.db.from('scans').select('id').eq('project_id', projectId).order('created_at', { ascending: false }).range(keep, keep + 1000)) ?? [];
    if (rows.length) {
      this.check(await this.db.from('scans').delete().in('id', rows.map((r) => r.id)));
    }
  }

  async addInsight(i: InsightRecord) {
    const { projectId, scanId, ...data } = i;
    this.check(await this.db.from('ai_insights').insert({ id: i.id, project_id: projectId, scan_id: scanId, task: i.task, data }));
    return i;
  }
  async listInsights(filter: { projectId?: string; scanId?: string; limit: number }) {
    let q = this.db.from('ai_insights').select().order('created_at', { ascending: false }).limit(filter.limit);
    if (filter.projectId) {
      q = q.eq('project_id', filter.projectId);
    }
    if (filter.scanId) {
      q = q.eq('scan_id', filter.scanId);
    }
    return (this.check(await q) ?? []).map(toInsight);
  }

  async createApiKey(k: Omit<ApiKeyRecord, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>) {
    return toKey(this.one(await this.db.from('api_keys').insert({ name: k.name, prefix: k.prefix, key_hash: k.keyHash, scopes: k.scopes }).select().single()));
  }
  async findApiKeyByHash(hash: string) {
    const data = this.check(await this.db.from('api_keys').select().eq('key_hash', hash).maybeSingle());
    return data ? toKey(data) : null;
  }
  async listApiKeys() {
    return (this.check(await this.db.from('api_keys').select().order('created_at', { ascending: false })) ?? []).map(toKey);
  }
  async touchApiKey(id: string) {
    await this.db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', id);
  }
  async revokeApiKey(id: string) {
    const data = this.check(await this.db.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', id).select().maybeSingle());
    if (!data) {
      throw notFound('API key');
    }
  }
}
