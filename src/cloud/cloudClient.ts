import type { AiTool, ConsentStatus, PromptEvent, PromptGuardView, PromptPolicy } from '../models/promptGuard';

/**
 * Minimal typed client for the hosted ProjectLens API. Runs in the extension host only;
 * the session token never reaches the webview.
 */

export class CloudError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'CloudError';
  }
}

export interface CloudUser {
  id: string;
  email: string | null;
  name: string | null;
  githubLogin: string | null;
  avatarUrl: string | null;
}

export interface CloudOrg {
  id: string;
  name: string;
  plan: string;
  role: 'owner' | 'admin' | 'member';
  aiProvider: string | null;
  aiModel: string | null;
}

export interface SessionResponse {
  token: string;
  expiresAt: string;
  user: CloudUser;
  organizations: CloudOrg[];
}

type Json = Record<string, unknown>;

/** Accepts https URLs, or http only for localhost development. */
export function validateApiUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new CloudError(0, 'invalid_url', `Invalid ProjectLens Cloud URL: ${raw}`);
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new CloudError(0, 'invalid_url', 'ProjectLens Cloud URL must use https://');
  }
  return url.toString().replace(/\/+$/, '');
}

export class CloudClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | null,
    private readonly orgId: string | null,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private async request<T>(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
    let res: Response;
    try {
      res = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'user-agent': 'projectlens-vscode',
          ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          ...(this.orgId ? { 'x-projectlens-org': this.orgId } : {})
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (err) {
      const msg = err instanceof Error && err.name === 'TimeoutError' ? 'ProjectLens Cloud did not respond in time' : 'Could not reach ProjectLens Cloud. Check your connection.';
      throw new CloudError(0, 'network', msg);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    let payload: Json = {};
    try {
      payload = (await res.json()) as Json;
    } catch {
      // non-JSON error page
    }
    if (!res.ok) {
      const e = (payload.error ?? {}) as { code?: string; message?: string; details?: unknown };
      throw new CloudError(res.status, e.code ?? `http_${res.status}`, e.message ?? `ProjectLens Cloud returned ${res.status}`, e.details);
    }
    return (payload.data ?? payload) as T;
  }

  // Auth
  authConfig() {
    return this.request<{ github: boolean; email: boolean }>('GET', '/auth/config');
  }
  signInWithGitHub(accessToken: string, label: string) {
    return this.request<SessionResponse>('POST', '/auth/github', { accessToken, label });
  }
  startEmail(email: string) {
    return this.request<{ expiresInSeconds: number }>('POST', '/auth/email/start', { email });
  }
  verifyEmail(email: string, code: string, label: string) {
    return this.request<SessionResponse>('POST', '/auth/email/verify', { email, code, label });
  }
  logout() {
    return this.request<void>('POST', '/auth/logout');
  }
  me() {
    return this.request<{ user: CloudUser; organizations: CloudOrg[] }>('GET', '/me');
  }

  // Prompt Guard (organization-scoped session endpoints)
  promptGuardPolicy(orgId: string) {
    return this.request<{ organization: { id: string; name: string }; policy: PromptPolicy; me: { consent: ConsentStatus; acceptedAt: string | null; enabled: boolean; tools: AiTool[]; policyVersion: number | null } }>(
      'GET',
      `/orgs/${orgId}/prompt-guard/policy`
    );
  }
  savePromptGuardPolicy(orgId: string, patch: Json) {
    return this.request<PromptPolicy>('PUT', `/orgs/${orgId}/prompt-guard/policy`, patch);
  }
  promptGuardConsent(orgId: string, consentVersion: number, accept: boolean) {
    return this.request<{ consent: ConsentStatus }>('POST', `/orgs/${orgId}/prompt-guard/consent`, { consentVersion, accept });
  }
  promptGuardHeartbeat(orgId: string, body: { enabled: boolean; tools: AiTool[]; policyVersion: number | null; clientVersion: string }) {
    return this.request<unknown>('POST', `/orgs/${orgId}/prompt-guard/heartbeat`, body);
  }
  uploadPromptEvents(orgId: string, events: PromptEvent[]) {
    return this.request<{ accepted: number; duplicates: number }>('POST', `/orgs/${orgId}/prompt-guard/events`, { events });
  }
  promptGuardEvents(orgId: string, limit = 50) {
    return this.request<(PromptEvent & { userId: string })[]>('GET', `/orgs/${orgId}/prompt-guard/events?limit=${limit}`);
  }
  promptGuardMembers(orgId: string) {
    return this.request<
      { user: { id: string; name?: string | null; email?: string | null; githubLogin?: string | null }; role: string; consent: ConsentStatus; enabled: boolean; tools: AiTool[]; upToDate: boolean; lastSeenAt: string | null; last30Days: { blocked: number; warned: number; detected: number } }[]
    >('GET', `/orgs/${orgId}/prompt-guard/members`);
  }
  promptGuardSummary(orgId: string) {
    return this.request<NonNullable<PromptGuardView['summary']>>('GET', `/orgs/${orgId}/prompt-guard/summary`);
  }

  // Organizations
  createOrg(name: string) {
    return this.request<CloudOrg>('POST', '/orgs', { name });
  }
  members(orgId: string) {
    return this.request<{ role: CloudOrg['role']; joinedAt: string; user: CloudUser }[]>('GET', `/orgs/${orgId}/members`);
  }
  changeRole(orgId: string, userId: string, role: string) {
    return this.request<void>('PATCH', `/orgs/${orgId}/members/${userId}`, { role });
  }
  removeMember(orgId: string, userId: string) {
    return this.request<void>('DELETE', `/orgs/${orgId}/members/${userId}`);
  }
  invitations(orgId: string) {
    return this.request<{ id: string; email: string; role: string; expiresAt: string; acceptedAt: string | null }[]>('GET', `/orgs/${orgId}/invitations`);
  }
  invite(orgId: string, email: string, role: string) {
    return this.request<{ id: string; emailed: boolean }>('POST', `/orgs/${orgId}/invitations`, { email, role });
  }
  revokeInvitation(orgId: string, id: string) {
    return this.request<void>('DELETE', `/orgs/${orgId}/invitations/${id}`);
  }
  aiKeys(orgId: string) {
    return this.request<{ defaultProvider: string | null; defaultModel: string | null; providers: { provider: string; label: string; defaultModel: string; configured: boolean; last4: string | null }[] }>(
      'GET',
      `/orgs/${orgId}/ai-keys`
    );
  }
  setAiKey(orgId: string, provider: string, apiKey: string) {
    return this.request<{ last4: string }>('PUT', `/orgs/${orgId}/ai-keys/${provider}`, { apiKey, validate: true }, 45_000);
  }
  removeAiKey(orgId: string, provider: string) {
    return this.request<void>('DELETE', `/orgs/${orgId}/ai-keys/${provider}`);
  }
  setAiSettings(orgId: string, provider: string | null, model: string | null) {
    return this.request<CloudOrg>('PUT', `/orgs/${orgId}/ai-settings`, { provider, model });
  }
  usage(orgId: string) {
    return this.request<CloudUsage>('GET', `/orgs/${orgId}/usage`);
  }

  // Organization resources (org from the X-ProjectLens-Org header)
  apiKeys() {
    return this.request<CloudApiKey[]>('GET', '/keys');
  }
  createApiKey(name: string, scopes: string[]) {
    return this.request<CloudApiKey & { key: string }>('POST', '/keys', { name, scopes });
  }
  revokeApiKey(id: string) {
    return this.request<void>('DELETE', `/keys/${id}`);
  }
  projects() {
    return this.request<CloudProject[]>('GET', '/projects');
  }
  createProject(body: { name: string; provider: string; repository?: string; baseUrl?: string; accessToken?: string; externalId?: string }) {
    return this.request<CloudProject>('POST', '/projects', body);
  }
  updateProject(id: string, body: Json) {
    return this.request<CloudProject>('PATCH', `/projects/${id}`, body);
  }
  triggerScan(projectId: string, mode: 'quick' | 'full') {
    return this.request<CloudScan>('POST', `/projects/${projectId}/scans`, { mode });
  }
  scan(id: string) {
    return this.request<CloudScan>('GET', `/scans/${id}`);
  }
  upload(projectId: string, payload: { result: unknown; commitSha?: string; branch?: string }) {
    return this.request<CloudScan>('POST', `/projects/${projectId}/uploads`, payload, 90_000);
  }
}

export interface CloudScores {
  quality: { score: number | null };
  security: { score: number | null };
  implementation: { score: number | null };
  readiness: { score: number | null };
}

export interface CloudScan {
  id: string;
  projectId: string;
  source: 'cloud' | 'upload';
  status: 'queued' | 'running' | 'completed' | 'failed';
  mode: string;
  commitSha: string | null;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  overview: { scores: CloudScores; findings: { bySeverity: Record<string, number> } } | null;
}

export interface CloudProject {
  id: string;
  name: string;
  provider: 'github' | 'gitlab' | 'none' | 'local';
  repository: string;
  baseUrl: string | null;
  externalId: string | null;
  hasAccessToken: boolean;
  latestScan: CloudScan | null;
}

export interface CloudApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface CloudUsage {
  limits: { projects: number; cloudScansPerDay: number; uploadsPerDay: number; aiInsightsPerDay: number };
  last24h: { cloudScans: number; uploads: number; aiInsights: number };
  thisMonth: { cloudScans: number; uploads: number; aiInsights: number };
  projects: number;
}
