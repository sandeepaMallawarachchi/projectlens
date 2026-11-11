import { randomUUID } from 'node:crypto';
import type { ApiKeyRecord, InsightRecord, ProjectRecord, ScanRecord, Store } from './types';
import { notFound } from '../http';

const now = () => new Date().toISOString();

/** In-process store for tests and local development. Data is lost on restart. */
export class MemoryStore implements Store {
  projects = new Map<string, ProjectRecord>();
  scans = new Map<string, ScanRecord>();
  insights: InsightRecord[] = [];
  keys = new Map<string, ApiKeyRecord>();

  async createProject(p: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    const rec: ProjectRecord = { ...p, id: randomUUID(), createdAt: now(), updatedAt: now() };
    this.projects.set(rec.id, rec);
    return rec;
  }
  async getProject(id: string) {
    return this.projects.get(id) ?? null;
  }
  async findProjectByExternalId(externalId: string) {
    return [...this.projects.values()].find((p) => p.externalId === externalId) ?? null;
  }
  async listProjects() {
    return [...this.projects.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async updateProject(id: string, patch: Partial<ProjectRecord>) {
    const cur = this.projects.get(id);
    if (!cur) {
      throw notFound('Project');
    }
    const next = { ...cur, ...patch, id, updatedAt: now() };
    this.projects.set(id, next);
    return next;
  }
  async deleteProject(id: string) {
    this.projects.delete(id);
    for (const [sid, s] of this.scans) {
      if (s.projectId === id) {
        this.scans.delete(sid);
      }
    }
    this.insights = this.insights.filter((i) => i.projectId !== id);
  }
  async createScan(s: Omit<ScanRecord, 'id' | 'createdAt'>) {
    const rec: ScanRecord = { ...s, id: randomUUID(), createdAt: now() };
    this.scans.set(rec.id, rec);
    return rec;
  }
  async getScan(id: string) {
    return this.scans.get(id) ?? null;
  }
  async updateScan(id: string, patch: Partial<ScanRecord>) {
    const cur = this.scans.get(id);
    if (!cur) {
      throw notFound('Scan');
    }
    const next = { ...cur, ...patch, id };
    this.scans.set(id, next);
    return next;
  }
  async listScans(projectId: string, opts: { limit: number; withResult: boolean }) {
    return [...this.scans.values()]
      .filter((s) => s.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .slice(0, opts.limit)
      .map((s) => (opts.withResult ? s : { ...s, result: null }));
  }
  async pruneScans(projectId: string, keep: number) {
    const all = await this.listScans(projectId, { limit: Number.MAX_SAFE_INTEGER, withResult: false });
    for (const s of all.slice(keep)) {
      this.scans.delete(s.id);
    }
  }
  async addInsight(i: InsightRecord) {
    this.insights.unshift(i);
    return i;
  }
  async listInsights(filter: { projectId?: string; scanId?: string; limit: number }) {
    return this.insights.filter((i) => (!filter.projectId || i.projectId === filter.projectId) && (!filter.scanId || i.scanId === filter.scanId)).slice(0, filter.limit);
  }
  async createApiKey(k: Omit<ApiKeyRecord, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>) {
    const rec: ApiKeyRecord = { ...k, id: randomUUID(), createdAt: now(), lastUsedAt: null, revokedAt: null };
    this.keys.set(rec.id, rec);
    return rec;
  }
  async findApiKeyByHash(hash: string) {
    return [...this.keys.values()].find((k) => k.keyHash === hash) ?? null;
  }
  async listApiKeys() {
    return [...this.keys.values()];
  }
  async touchApiKey(id: string) {
    const k = this.keys.get(id);
    if (k) {
      k.lastUsedAt = now();
    }
  }
  async revokeApiKey(id: string) {
    const k = this.keys.get(id);
    if (!k) {
      throw notFound('API key');
    }
    k.revokedAt = now();
  }
}
