import type { ScanMode, ScanResult } from '@/engine/models/types';
import type { AIInsight, AIProviderId } from '@/engine/models/ai';
import type { ScanOverview } from '../dto';

export type GitProviderId = 'github' | 'gitlab' | 'none' | 'local';
export type Role = 'owner' | 'admin' | 'member';

export interface OrgRecord {
  id: string;
  name: string;
  /** Billing plan; everything is free for now. */
  plan: string;
  /** Default provider/model for server-side AI insights (keys are in org AI keys). */
  aiProvider: AIProviderId | null;
  aiModel: string | null;
  createdAt: string;
}

export interface UserRecord {
  id: string;
  email: string | null;
  emailVerified: boolean;
  githubId: string | null;
  githubLogin: string | null;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface MembershipRecord {
  orgId: string;
  userId: string;
  role: Role;
  createdAt: string;
}

export interface InvitationRecord {
  id: string;
  orgId: string;
  email: string;
  role: Role;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

/** Extension/browser sign-in session. Only the SHA-256 of the token is stored. */
export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** One-time email sign-in code (hashed). */
export interface EmailCodeRecord {
  id: string;
  email: string;
  codeHash: string;
  attempts: number;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

/** An organization's own AI provider key, encrypted. */
export interface OrgAiKeyRecord {
  orgId: string;
  provider: AIProviderId;
  keyEncrypted: string;
  /** Last 4 characters, for display only. */
  last4: string;
  updatedAt: string;
}

export interface ProjectRecord {
  id: string;
  orgId: string;
  name: string;
  /** `none` = no repository access (results arrive as uploads from the extension). */
  provider: GitProviderId;
  /** `owner/repo` (GitHub), `group/subgroup/project` (GitLab), a path (local), or '' (none). */
  repository: string;
  baseUrl: string | null;
  ref: string | null;
  tokenEncrypted: string | null;
  externalId: string | null;
  metadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ScanStatus = 'queued' | 'running' | 'completed' | 'failed';
export type ScanSource = 'cloud' | 'upload';

export interface ScanRecord {
  id: string;
  orgId: string;
  projectId: string;
  source: ScanSource;
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
  summary: ScanOverview | null;
  result: ScanResult | null;
}

export interface InsightRecord extends AIInsight {
  orgId: string;
  projectId: string;
  scanId: string;
}

export const API_SCOPES = ['read', 'scan', 'ai', 'admin'] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface ApiKeyRecord {
  id: string;
  orgId: string;
  name: string;
  prefix: string;
  keyHash: string;
  scopes: ApiScope[];
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

type New<T, Auto extends keyof T> = Omit<T, Auto>;

/**
 * Persistence. Every tenant-owned record is read and written with an explicit orgId so that
 * organizations are isolated structurally, not by convention in route handlers.
 */
export interface Store {
  // Organizations, users, memberships
  createOrg(o: New<OrgRecord, 'id' | 'createdAt'>): Promise<OrgRecord>;
  getOrg(id: string): Promise<OrgRecord | null>;
  updateOrg(id: string, patch: Partial<New<OrgRecord, 'id' | 'createdAt'>>): Promise<OrgRecord>;
  createUser(u: New<UserRecord, 'id' | 'createdAt'>): Promise<UserRecord>;
  getUser(id: string): Promise<UserRecord | null>;
  findUserByGithubId(githubId: string): Promise<UserRecord | null>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  updateUser(id: string, patch: Partial<New<UserRecord, 'id' | 'createdAt'>>): Promise<UserRecord>;
  addMembership(m: New<MembershipRecord, 'createdAt'>): Promise<MembershipRecord>;
  getMembership(orgId: string, userId: string): Promise<MembershipRecord | null>;
  listMembershipsForUser(userId: string): Promise<MembershipRecord[]>;
  listMembers(orgId: string): Promise<MembershipRecord[]>;
  updateMembership(orgId: string, userId: string, role: Role): Promise<void>;
  removeMembership(orgId: string, userId: string): Promise<void>;

  // Invitations
  createInvitation(i: New<InvitationRecord, 'id' | 'createdAt' | 'acceptedAt'>): Promise<InvitationRecord>;
  listInvitations(orgId: string): Promise<InvitationRecord[]>;
  listPendingInvitationsForEmail(email: string): Promise<InvitationRecord[]>;
  acceptInvitation(id: string): Promise<void>;
  deleteInvitation(orgId: string, id: string): Promise<void>;

  // Sessions and email codes
  createSession(s: New<SessionRecord, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>): Promise<SessionRecord>;
  findSessionByHash(hash: string): Promise<SessionRecord | null>;
  touchSession(id: string): Promise<void>;
  revokeSession(id: string): Promise<void>;
  createEmailCode(c: New<EmailCodeRecord, 'id' | 'createdAt' | 'attempts' | 'usedAt'>): Promise<EmailCodeRecord>;
  latestEmailCode(email: string): Promise<EmailCodeRecord | null>;
  countEmailCodesSince(email: string, since: string): Promise<number>;
  updateEmailCode(id: string, patch: Partial<Pick<EmailCodeRecord, 'attempts' | 'usedAt'>>): Promise<void>;

  // Organization AI keys
  upsertOrgAiKey(k: New<OrgAiKeyRecord, 'updatedAt'>): Promise<OrgAiKeyRecord>;
  listOrgAiKeys(orgId: string): Promise<OrgAiKeyRecord[]>;
  deleteOrgAiKey(orgId: string, provider: AIProviderId): Promise<void>;

  // Projects
  createProject(p: New<ProjectRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<ProjectRecord>;
  getProject(orgId: string, id: string): Promise<ProjectRecord | null>;
  findProjectByExternalId(orgId: string, externalId: string): Promise<ProjectRecord | null>;
  listProjects(orgId: string): Promise<ProjectRecord[]>;
  countProjects(orgId: string): Promise<number>;
  updateProject(orgId: string, id: string, patch: Partial<New<ProjectRecord, 'id' | 'orgId' | 'createdAt'>>): Promise<ProjectRecord>;
  deleteProject(orgId: string, id: string): Promise<void>;

  // Scans
  createScan(s: New<ScanRecord, 'id' | 'createdAt'>): Promise<ScanRecord>;
  getScan(orgId: string, id: string): Promise<ScanRecord | null>;
  updateScan(id: string, patch: Partial<New<ScanRecord, 'id' | 'orgId' | 'projectId' | 'createdAt'>>): Promise<ScanRecord>;
  /** Newest first. `withResult: false` omits the heavy result payload (summary is always included). */
  listScans(orgId: string, projectId: string, opts: { limit: number; withResult: boolean }): Promise<ScanRecord[]>;
  countScansSince(orgId: string, since: string, source?: ScanSource): Promise<number>;
  pruneScans(orgId: string, projectId: string, keep: number): Promise<void>;

  // Insights
  addInsight(i: InsightRecord): Promise<InsightRecord>;
  listInsights(orgId: string, filter: { projectId?: string; scanId?: string; limit: number }): Promise<InsightRecord[]>;
  countInsightsSince(orgId: string, since: string): Promise<number>;

  // API keys
  createApiKey(k: New<ApiKeyRecord, 'id' | 'createdAt' | 'lastUsedAt' | 'revokedAt'>): Promise<ApiKeyRecord>;
  findApiKeyByHash(hash: string): Promise<ApiKeyRecord | null>;
  listApiKeys(orgId: string): Promise<ApiKeyRecord[]>;
  touchApiKey(id: string): Promise<void>;
  revokeApiKey(orgId: string, id: string): Promise<void>;
}
