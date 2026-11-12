import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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

type Row = Record<string, unknown>;

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const camel = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/** Top-level key conversion only; JSON columns (metadata, summary, result, data, scopes) keep their contents. */
function toRow(obj: object): Row {
  const row: Row = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      row[snake(k)] = v;
    }
  }
  return row;
}

function fromRow<T>(row: Row): T {
  const obj: Row = {};
  for (const [k, v] of Object.entries(row)) {
    obj[camel(k)] = v;
  }
  return obj as T;
}

const SCAN_LIST_COLUMNS = 'id, org_id, project_id, source, status, mode, ref, commit_sha, triggered_by, callback_url, created_at, started_at, finished_at, error, summary';

type Result<T> = { data: T; error: { message: string; code?: string } | null };

/** Supabase Postgres store. Uses the service-role/secret key server-side; tables have RLS enabled with no public policies. */
export class SupabaseStore implements Store {
  private readonly db: SupabaseClient;

  constructor(url: string, serviceKey: string) {
    this.db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  private check<T>(res: Result<T>): T {
    if (res.error) {
      if (res.error.code === '23505') {
        throw new HttpError(409, 'conflict', 'A record with the same unique value already exists');
      }
      throw new HttpError(500, 'storage_error', res.error.message);
    }
    return res.data;
  }

  private one<T>(res: Result<Row | null>, what = 'Record'): T {
    const row = this.check(res);
    if (!row) {
      throw notFound(what);
    }
    return fromRow<T>(row);
  }

  private maybe<T>(res: Result<Row | null>): T | null {
    const row = this.check(res);
    return row ? fromRow<T>(row) : null;
  }

  private many<T>(res: Result<Row[] | null>): T[] {
    return (this.check(res) ?? []).map((r) => fromRow<T>(r));
  }

  private async count(query: PromiseLike<{ count: number | null; error: { message: string } | null }>): Promise<number> {
    const res = await query;
    if (res.error) {
      throw new HttpError(500, 'storage_error', res.error.message);
    }
    return res.count ?? 0;
  }

  // Organizations, users, memberships
  async createOrg(o: Omit<OrgRecord, 'id' | 'createdAt'>) {
    return this.one<OrgRecord>(await this.db.from('organizations').insert(toRow(o)).select().single());
  }
  async getOrg(id: string) {
    return this.maybe<OrgRecord>(await this.db.from('organizations').select().eq('id', id).maybeSingle());
  }
  async updateOrg(id: string, patch: Partial<OrgRecord>) {
    return this.one<OrgRecord>(await this.db.from('organizations').update(toRow(patch)).eq('id', id).select().maybeSingle(), 'Organization');
  }
  async createUser(u: Omit<UserRecord, 'id' | 'createdAt'>) {
    return this.one<UserRecord>(await this.db.from('users').insert(toRow(u)).select().single());
  }
  async getUser(id: string) {
    return this.maybe<UserRecord>(await this.db.from('users').select().eq('id', id).maybeSingle());
  }
  async findUserByGithubId(githubId: string) {
    return this.maybe<UserRecord>(await this.db.from('users').select().eq('github_id', githubId).maybeSingle());
  }
  async findUserByEmail(email: string) {
    const rows = this.many<UserRecord>(await this.db.from('users').select().eq('email', email).order('created_at').limit(1));
    return rows[0] ?? null;
  }
  async updateUser(id: string, patch: Partial<UserRecord>) {
    return this.one<UserRecord>(await this.db.from('users').update(toRow(patch)).eq('id', id).select().maybeSingle(), 'User');
  }
  async addMembership(m: Omit<MembershipRecord, 'createdAt'>) {
    return this.one<MembershipRecord>(await this.db.from('memberships').upsert(toRow(m), { onConflict: 'org_id,user_id', ignoreDuplicates: false }).select().single());
  }
  async getMembership(orgId: string, userId: string) {
    return this.maybe<MembershipRecord>(await this.db.from('memberships').select().eq('org_id', orgId).eq('user_id', userId).maybeSingle());
  }
  async listMembershipsForUser(userId: string) {
    return this.many<MembershipRecord>(await this.db.from('memberships').select().eq('user_id', userId).order('created_at'));
  }
  async listMembers(orgId: string) {
    return this.many<MembershipRecord>(await this.db.from('memberships').select().eq('org_id', orgId).order('created_at'));
  }
  async updateMembership(orgId: string, userId: string, role: Role) {
    this.one(await this.db.from('memberships').update({ role }).eq('org_id', orgId).eq('user_id', userId).select().maybeSingle(), 'Member');
  }
  async removeMembership(orgId: string, userId: string) {
    this.check(await this.db.from('memberships').delete().eq('org_id', orgId).eq('user_id', userId));
  }

  // Invitations
  async createInvitation(i: Omit<InvitationRecord, 'id' | 'createdAt' | 'acceptedAt'>) {
    return this.one<InvitationRecord>(await this.db.from('invitations').insert(toRow(i)).select().single());
  }
  async listInvitations(orgId: string) {
    return this.many<InvitationRecord>(await this.db.from('invitations').select().eq('org_id', orgId).order('created_at', { ascending: false }));
  }
  async listPendingInvitationsForEmail(email: string) {
    return this.many<InvitationRecord>(
      await this.db.from('invitations').select().eq('email', email).is('accepted_at', null).gt('expires_at', new Date().toISOString())
    );
  }
  async acceptInvitation(id: string) {
    this.check(await this.db.from('invitations').update({ accepted_at: new Date().toISOString() }).eq('id', id));
  }
  async deleteInvitation(orgId: string, id: string) {
    this.one(await this.db.from('invitations').delete().eq('org_id', orgId).eq('id', id).select().maybeSingle(), 'Invitation');
  }

  // Sessions and email codes
  async createSession(s: Omit<SessionRecord, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>) {
    return this.one<SessionRecord>(await this.db.from('sessions').insert(toRow(s)).select().single());
  }
  async findSessionByHash(hash: string) {
    return this.maybe<SessionRecord>(await this.db.from('sessions').select().eq('token_hash', hash).maybeSingle());
  }
  async touchSession(id: string) {
    await this.db.from('sessions').update({ last_used_at: new Date().toISOString() }).eq('id', id);
  }
  async revokeSession(id: string) {
    this.check(await this.db.from('sessions').update({ revoked_at: new Date().toISOString() }).eq('id', id));
  }
  async createEmailCode(c: Omit<EmailCodeRecord, 'id' | 'createdAt' | 'attempts' | 'usedAt'>) {
    return this.one<EmailCodeRecord>(await this.db.from('email_codes').insert(toRow(c)).select().single());
  }
  async latestEmailCode(email: string) {
    const rows = this.many<EmailCodeRecord>(await this.db.from('email_codes').select().eq('email', email).order('created_at', { ascending: false }).limit(1));
    return rows[0] ?? null;
  }
  async countEmailCodesSince(email: string, since: string) {
    return this.count(this.db.from('email_codes').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', since));
  }
  async updateEmailCode(id: string, patch: Partial<Pick<EmailCodeRecord, 'attempts' | 'usedAt'>>) {
    this.check(await this.db.from('email_codes').update(toRow(patch)).eq('id', id));
  }

  // Organization AI keys
  async upsertOrgAiKey(k: Omit<OrgAiKeyRecord, 'updatedAt'>) {
    return this.one<OrgAiKeyRecord>(
      await this.db.from('org_ai_keys').upsert({ ...toRow(k), updated_at: new Date().toISOString() }, { onConflict: 'org_id,provider' }).select().single()
    );
  }
  async listOrgAiKeys(orgId: string) {
    return this.many<OrgAiKeyRecord>(await this.db.from('org_ai_keys').select().eq('org_id', orgId));
  }
  async deleteOrgAiKey(orgId: string, provider: AIProviderId) {
    this.check(await this.db.from('org_ai_keys').delete().eq('org_id', orgId).eq('provider', provider));
  }

  // Projects
  async createProject(p: Omit<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    return this.one<ProjectRecord>(await this.db.from('projects').insert(toRow(p)).select().single());
  }
  async getProject(orgId: string, id: string) {
    return this.maybe<ProjectRecord>(await this.db.from('projects').select().eq('org_id', orgId).eq('id', id).maybeSingle());
  }
  async findProjectByExternalId(orgId: string, externalId: string) {
    return this.maybe<ProjectRecord>(await this.db.from('projects').select().eq('org_id', orgId).eq('external_id', externalId).maybeSingle());
  }
  async listProjects(orgId: string) {
    return this.many<ProjectRecord>(await this.db.from('projects').select().eq('org_id', orgId).order('created_at', { ascending: false }));
  }
  async countProjects(orgId: string) {
    return this.count(this.db.from('projects').select('id', { count: 'exact', head: true }).eq('org_id', orgId));
  }
  async updateProject(orgId: string, id: string, patch: Partial<ProjectRecord>) {
    return this.one<ProjectRecord>(
      await this.db.from('projects').update({ ...toRow(patch), updated_at: new Date().toISOString() }).eq('org_id', orgId).eq('id', id).select().maybeSingle(),
      'Project'
    );
  }
  async deleteProject(orgId: string, id: string) {
    this.one(await this.db.from('projects').delete().eq('org_id', orgId).eq('id', id).select('id').maybeSingle(), 'Project');
  }

  // Scans
  async createScan(s: Omit<ScanRecord, 'id' | 'createdAt'>) {
    return this.one<ScanRecord>(await this.db.from('scans').insert(toRow(s)).select().single());
  }
  async getScan(orgId: string, id: string) {
    return this.maybe<ScanRecord>(await this.db.from('scans').select().eq('org_id', orgId).eq('id', id).maybeSingle());
  }
  async updateScan(id: string, patch: Partial<ScanRecord>) {
    return this.one<ScanRecord>(await this.db.from('scans').update(toRow(patch)).eq('id', id).select().maybeSingle(), 'Scan');
  }
  async listScans(orgId: string, projectId: string, opts: { limit: number; withResult: boolean }) {
    const rows = this.many<ScanRecord>(
      (await this.db
        .from('scans')
        .select(opts.withResult ? '*' : SCAN_LIST_COLUMNS)
        .eq('org_id', orgId)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(opts.limit)) as unknown as Result<Row[]>
    );
    return rows.map((r) => ({ ...r, result: r.result ?? null }));
  }
  async countScansSince(orgId: string, since: string, source?: ScanSource) {
    let q = this.db.from('scans').select('id', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', since);
    if (source) {
      q = q.eq('source', source);
    }
    return this.count(q);
  }
  async pruneScans(orgId: string, projectId: string, keep: number) {
    const rows = this.check(
      await this.db.from('scans').select('id').eq('org_id', orgId).eq('project_id', projectId).order('created_at', { ascending: false }).range(keep, keep + 1000)
    ) ?? [];
    if (rows.length) {
      this.check(await this.db.from('scans').delete().in('id', rows.map((r) => r.id)));
    }
  }

  // Insights
  async addInsight(i: InsightRecord) {
    const { orgId, projectId, scanId, ...data } = i;
    this.check(await this.db.from('ai_insights').insert({ id: i.id, org_id: orgId, project_id: projectId, scan_id: scanId, task: i.task, data, created_at: i.createdAt }));
    return i;
  }
  async listInsights(orgId: string, filter: { projectId?: string; scanId?: string; limit: number }) {
    let q = this.db.from('ai_insights').select().eq('org_id', orgId).order('created_at', { ascending: false }).limit(filter.limit);
    if (filter.projectId) {
      q = q.eq('project_id', filter.projectId);
    }
    if (filter.scanId) {
      q = q.eq('scan_id', filter.scanId);
    }
    return (this.check(await q) ?? []).map((r: Row) => ({ ...(r.data as InsightRecord), orgId: r.org_id as string, projectId: r.project_id as string, scanId: r.scan_id as string }));
  }
  async countInsightsSince(orgId: string, since: string) {
    return this.count(this.db.from('ai_insights').select('id', { count: 'exact', head: true }).eq('org_id', orgId).gte('created_at', since));
  }

  // API keys
  async createApiKey(k: Omit<ApiKeyRecord, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>) {
    return this.one<ApiKeyRecord>(await this.db.from('api_keys').insert(toRow(k)).select().single());
  }
  async findApiKeyByHash(hash: string) {
    return this.maybe<ApiKeyRecord>(await this.db.from('api_keys').select().eq('key_hash', hash).maybeSingle());
  }
  async listApiKeys(orgId: string) {
    return this.many<ApiKeyRecord>(await this.db.from('api_keys').select().eq('org_id', orgId).order('created_at', { ascending: false }));
  }
  async touchApiKey(id: string) {
    await this.db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', id);
  }
  async revokeApiKey(orgId: string, id: string) {
    this.one(await this.db.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('org_id', orgId).eq('id', id).select().maybeSingle(), 'API key');
  }

  // Prompt Guard
  async getPromptPolicy(orgId: string) {
    const row = this.check(await this.db.from('prompt_policies').select('policy').eq('org_id', orgId).maybeSingle()) as Row | null;
    return row ? (row.policy as PromptPolicy) : null;
  }
  async savePromptPolicy(orgId: string, policy: PromptPolicy) {
    this.check(await this.db.from('prompt_policies').upsert({ org_id: orgId, policy, updated_at: new Date().toISOString() }, { onConflict: 'org_id' }));
    return policy;
  }
  async getPromptGuardMember(orgId: string, userId: string) {
    return this.maybe<PromptGuardMemberRecord>(await this.db.from('prompt_guard_members').select().eq('org_id', orgId).eq('user_id', userId).maybeSingle());
  }
  async upsertPromptGuardMember(m: PromptGuardMemberRecord) {
    return this.one<PromptGuardMemberRecord>(await this.db.from('prompt_guard_members').upsert(toRow(m), { onConflict: 'org_id,user_id' }).select().single());
  }
  async listPromptGuardMembers(orgId: string) {
    return this.many<PromptGuardMemberRecord>(await this.db.from('prompt_guard_members').select().eq('org_id', orgId));
  }
  async addPromptEvents(events: PromptEventRecord[]) {
    if (!events.length) {
      return 0;
    }
    const rows = this.check(
      await this.db.from('prompt_events').upsert(events.map(toRow), { onConflict: 'org_id,id', ignoreDuplicates: true }).select('id')
    ) as Row[] | null;
    return rows?.length ?? 0;
  }
  async listPromptEvents(orgId: string, f: PromptEventFilter) {
    let q = this.db.from('prompt_events').select().eq('org_id', orgId).order('occurred_at', { ascending: false }).limit(f.limit);
    if (f.userId) {
      q = q.eq('user_id', f.userId);
    }
    if (f.since) {
      q = q.gte('occurred_at', f.since);
    }
    if (f.tool) {
      q = q.eq('tool', f.tool);
    }
    return this.many<PromptEventRecord>(await q);
  }
}
