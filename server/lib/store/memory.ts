import { randomUUID } from 'node:crypto';
import type { AIProviderId } from '@/engine/models/ai';
import type {
  ApiKeyRecord,
  EmailCodeRecord,
  InsightRecord,
  InvitationRecord,
  MembershipRecord,
  OrgAiKeyRecord,
  OrgRecord,
  ProjectRecord,
  Role,
  ScanRecord,
  ScanSource,
  PromptEventFilter,
  PromptEventRecord,
  PromptGuardMemberRecord,
  SessionRecord,
  Store,
  UserRecord
} from './types';
import { HttpError, notFound } from '../http';
import type { PromptPolicy } from '@/engine/models/promptGuard';

const now = () => new Date().toISOString();
const byNewest = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);

/** In-process store for tests and local development. Data is lost on restart. */
export class MemoryStore implements Store {
  orgs = new Map<string, OrgRecord>();
  users = new Map<string, UserRecord>();
  memberships: MembershipRecord[] = [];
  invitations = new Map<string, InvitationRecord>();
  sessions = new Map<string, SessionRecord>();
  emailCodes: EmailCodeRecord[] = [];
  aiKeys: OrgAiKeyRecord[] = [];
  projects = new Map<string, ProjectRecord>();
  scans = new Map<string, ScanRecord>();
  insights: InsightRecord[] = [];
  keys = new Map<string, ApiKeyRecord>();
  promptPolicies = new Map<string, PromptPolicy>();
  promptMembers: PromptGuardMemberRecord[] = [];
  promptEvents: PromptEventRecord[] = [];
  private seq = 0;

  /** Monotonic timestamps keep "newest first" ordering deterministic within one millisecond. */
  private stamp(): string {
    this.seq++;
    return new Date(Date.now() + this.seq).toISOString();
  }

  // Organizations, users, memberships
  async createOrg(o: Omit<OrgRecord, 'id' | 'createdAt'>) {
    const rec = { ...o, id: randomUUID(), createdAt: now() };
    this.orgs.set(rec.id, rec);
    return rec;
  }
  async getOrg(id: string) {
    return this.orgs.get(id) ?? null;
  }
  async updateOrg(id: string, patch: Partial<OrgRecord>) {
    const cur = this.orgs.get(id);
    if (!cur) {
      throw notFound('Organization');
    }
    const next = { ...cur, ...patch, id };
    this.orgs.set(id, next);
    return next;
  }
  async createUser(u: Omit<UserRecord, 'id' | 'createdAt'>) {
    if (u.githubId && [...this.users.values()].some((x) => x.githubId === u.githubId)) {
      throw new HttpError(409, 'conflict', 'User already exists');
    }
    const rec = { ...u, id: randomUUID(), createdAt: now() };
    this.users.set(rec.id, rec);
    return rec;
  }
  async getUser(id: string) {
    return this.users.get(id) ?? null;
  }
  async findUserByGithubId(githubId: string) {
    return [...this.users.values()].find((u) => u.githubId === githubId) ?? null;
  }
  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async updateUser(id: string, patch: Partial<UserRecord>) {
    const cur = this.users.get(id);
    if (!cur) {
      throw notFound('User');
    }
    const next = { ...cur, ...patch, id };
    this.users.set(id, next);
    return next;
  }
  async addMembership(m: Omit<MembershipRecord, 'createdAt'>) {
    const existing = this.memberships.find((x) => x.orgId === m.orgId && x.userId === m.userId);
    if (existing) {
      return existing;
    }
    const rec = { ...m, createdAt: this.stamp() };
    this.memberships.push(rec);
    return rec;
  }
  async getMembership(orgId: string, userId: string) {
    return this.memberships.find((m) => m.orgId === orgId && m.userId === userId) ?? null;
  }
  async listMembershipsForUser(userId: string) {
    return this.memberships.filter((m) => m.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async listMembers(orgId: string) {
    return this.memberships.filter((m) => m.orgId === orgId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async updateMembership(orgId: string, userId: string, role: Role) {
    const m = await this.getMembership(orgId, userId);
    if (!m) {
      throw notFound('Member');
    }
    m.role = role;
  }
  async removeMembership(orgId: string, userId: string) {
    this.memberships = this.memberships.filter((m) => !(m.orgId === orgId && m.userId === userId));
  }

  // Invitations
  async createInvitation(i: Omit<InvitationRecord, 'id' | 'createdAt' | 'acceptedAt'>) {
    const rec = { ...i, id: randomUUID(), createdAt: this.stamp(), acceptedAt: null };
    this.invitations.set(rec.id, rec);
    return rec;
  }
  async listInvitations(orgId: string) {
    return [...this.invitations.values()].filter((i) => i.orgId === orgId).sort(byNewest);
  }
  async listPendingInvitationsForEmail(email: string) {
    const t = now();
    return [...this.invitations.values()].filter((i) => i.email === email && !i.acceptedAt && i.expiresAt > t);
  }
  async acceptInvitation(id: string) {
    const i = this.invitations.get(id);
    if (i) {
      i.acceptedAt = now();
    }
  }
  async deleteInvitation(orgId: string, id: string) {
    const i = this.invitations.get(id);
    if (!i || i.orgId !== orgId) {
      throw notFound('Invitation');
    }
    this.invitations.delete(id);
  }

  // Sessions and email codes
  async createSession(s: Omit<SessionRecord, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>) {
    const rec = { ...s, id: randomUUID(), createdAt: now(), lastUsedAt: null, revokedAt: null };
    this.sessions.set(rec.id, rec);
    return rec;
  }
  async findSessionByHash(hash: string) {
    return [...this.sessions.values()].find((s) => s.tokenHash === hash) ?? null;
  }
  async touchSession(id: string) {
    const s = this.sessions.get(id);
    if (s) {
      s.lastUsedAt = now();
    }
  }
  async revokeSession(id: string) {
    const s = this.sessions.get(id);
    if (s) {
      s.revokedAt = now();
    }
  }
  async createEmailCode(c: Omit<EmailCodeRecord, 'id' | 'createdAt' | 'attempts' | 'usedAt'>) {
    const rec = { ...c, id: randomUUID(), createdAt: this.stamp(), attempts: 0, usedAt: null };
    this.emailCodes.push(rec);
    return rec;
  }
  async latestEmailCode(email: string) {
    return this.emailCodes.filter((c) => c.email === email).sort(byNewest)[0] ?? null;
  }
  async countEmailCodesSince(email: string, since: string) {
    return this.emailCodes.filter((c) => c.email === email && c.createdAt >= since).length;
  }
  async updateEmailCode(id: string, patch: Partial<Pick<EmailCodeRecord, 'attempts' | 'usedAt'>>) {
    const c = this.emailCodes.find((x) => x.id === id);
    if (c) {
      Object.assign(c, patch);
    }
  }

  // Organization AI keys
  async upsertOrgAiKey(k: Omit<OrgAiKeyRecord, 'updatedAt'>) {
    this.aiKeys = this.aiKeys.filter((x) => !(x.orgId === k.orgId && x.provider === k.provider));
    const rec = { ...k, updatedAt: now() };
    this.aiKeys.push(rec);
    return rec;
  }
  async listOrgAiKeys(orgId: string) {
    return this.aiKeys.filter((k) => k.orgId === orgId);
  }
  async deleteOrgAiKey(orgId: string, provider: AIProviderId) {
    this.aiKeys = this.aiKeys.filter((k) => !(k.orgId === orgId && k.provider === provider));
  }

  // Projects
  async createProject(p: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    if (p.externalId && (await this.findProjectByExternalId(p.orgId, p.externalId))) {
      throw new HttpError(409, 'conflict', `A project with externalId "${p.externalId}" already exists`);
    }
    const ts = this.stamp();
    const rec = { ...p, id: randomUUID(), createdAt: ts, updatedAt: ts };
    this.projects.set(rec.id, rec);
    return rec;
  }
  async getProject(orgId: string, id: string) {
    const p = this.projects.get(id);
    return p && p.orgId === orgId ? p : null;
  }
  async findProjectByExternalId(orgId: string, externalId: string) {
    return [...this.projects.values()].find((p) => p.orgId === orgId && p.externalId === externalId) ?? null;
  }
  async listProjects(orgId: string) {
    return [...this.projects.values()].filter((p) => p.orgId === orgId).sort(byNewest);
  }
  async countProjects(orgId: string) {
    return (await this.listProjects(orgId)).length;
  }
  async updateProject(orgId: string, id: string, patch: Partial<ProjectRecord>) {
    const cur = await this.getProject(orgId, id);
    if (!cur) {
      throw notFound('Project');
    }
    const next = { ...cur, ...patch, id, orgId, updatedAt: now() };
    this.projects.set(id, next);
    return next;
  }
  async deleteProject(orgId: string, id: string) {
    if (!(await this.getProject(orgId, id))) {
      throw notFound('Project');
    }
    this.projects.delete(id);
    for (const [sid, s] of this.scans) {
      if (s.projectId === id) {
        this.scans.delete(sid);
      }
    }
    this.insights = this.insights.filter((i) => i.projectId !== id);
  }

  // Scans
  async createScan(s: Omit<ScanRecord, 'id' | 'createdAt'>) {
    const rec = { ...s, id: randomUUID(), createdAt: this.stamp() };
    this.scans.set(rec.id, rec);
    return rec;
  }
  async getScan(orgId: string, id: string) {
    const s = this.scans.get(id);
    return s && s.orgId === orgId ? s : null;
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
  async listScans(orgId: string, projectId: string, opts: { limit: number; withResult: boolean }) {
    return [...this.scans.values()]
      .filter((s) => s.orgId === orgId && s.projectId === projectId)
      .sort(byNewest)
      .slice(0, opts.limit)
      .map((s) => (opts.withResult ? s : { ...s, result: null }));
  }
  async countScansSince(orgId: string, since: string, source?: ScanSource) {
    return [...this.scans.values()].filter((s) => s.orgId === orgId && s.createdAt >= since && (!source || s.source === source)).length;
  }
  async pruneScans(orgId: string, projectId: string, keep: number) {
    const all = await this.listScans(orgId, projectId, { limit: Number.MAX_SAFE_INTEGER, withResult: false });
    for (const s of all.slice(keep)) {
      this.scans.delete(s.id);
    }
  }

  // Insights
  async addInsight(i: InsightRecord) {
    this.insights.unshift(i);
    return i;
  }
  async listInsights(orgId: string, filter: { projectId?: string; scanId?: string; limit: number }) {
    return this.insights
      .filter((i) => i.orgId === orgId && (!filter.projectId || i.projectId === filter.projectId) && (!filter.scanId || i.scanId === filter.scanId))
      .slice(0, filter.limit);
  }
  async countInsightsSince(orgId: string, since: string) {
    return this.insights.filter((i) => i.orgId === orgId && i.createdAt >= since).length;
  }

  // API keys
  async createApiKey(k: Omit<ApiKeyRecord, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>) {
    const rec = { ...k, id: randomUUID(), createdAt: this.stamp(), lastUsedAt: null, revokedAt: null };
    this.keys.set(rec.id, rec);
    return rec;
  }
  async findApiKeyByHash(hash: string) {
    return [...this.keys.values()].find((k) => k.keyHash === hash) ?? null;
  }
  async listApiKeys(orgId: string) {
    return [...this.keys.values()].filter((k) => k.orgId === orgId).sort(byNewest);
  }
  async touchApiKey(id: string) {
    const k = this.keys.get(id);
    if (k) {
      k.lastUsedAt = now();
    }
  }
  async revokeApiKey(orgId: string, id: string) {
    const k = this.keys.get(id);
    if (!k || k.orgId !== orgId) {
      throw notFound('API key');
    }
    k.revokedAt = now();
  }

  // Prompt Guard
  async getPromptPolicy(orgId: string) {
    const p = this.promptPolicies.get(orgId);
    return p ? structuredClone(p) : null;
  }
  async savePromptPolicy(orgId: string, policy: PromptPolicy) {
    this.promptPolicies.set(orgId, structuredClone(policy));
    return policy;
  }
  async getPromptGuardMember(orgId: string, userId: string) {
    const m = this.promptMembers.find((x) => x.orgId === orgId && x.userId === userId);
    return m ? { ...m } : null;
  }
  async upsertPromptGuardMember(m: PromptGuardMemberRecord) {
    this.promptMembers = this.promptMembers.filter((x) => !(x.orgId === m.orgId && x.userId === m.userId));
    this.promptMembers.push({ ...m });
    return m;
  }
  async listPromptGuardMembers(orgId: string) {
    return this.promptMembers.filter((x) => x.orgId === orgId).map((x) => ({ ...x }));
  }
  async addPromptEvents(events: PromptEventRecord[]) {
    let n = 0;
    for (const e of events) {
      if (!this.promptEvents.some((x) => x.orgId === e.orgId && x.id === e.id)) {
        this.promptEvents.push({ ...e });
        n++;
      }
    }
    return n;
  }
  async listPromptEvents(orgId: string, f: PromptEventFilter) {
    return this.promptEvents
      .filter((e) => e.orgId === orgId && (!f.userId || e.userId === f.userId) && (!f.since || e.occurredAt >= f.since) && (!f.tool || e.tool === f.tool))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, f.limit);
  }
}
