import * as vscode from 'vscode';
import type { ScanResult } from '../models/types';
import { AI_PROVIDERS, type AIProviderId } from '../models/ai';
import { EMPTY_CLOUD_STATE, type CloudProjectView, type CloudRole, type CloudState } from '../models/cloud';
import { CloudClient, CloudError, validateApiUrl, type CloudProject, type CloudScan } from './cloudClient';
import { parseRemote, readGitInfo } from './gitInfo';
import { trimForUpload } from './upload';

const SESSION_SECRET = 'projectlens.cloud.session';
const ORG_STATE = 'projectlens.cloud.org';
const LINK_STATE = 'projectlens.cloud.link';
export const DEFAULT_CLOUD_URL = 'https://projectlensai.vercel.app/api/v1';
const SCAN_POLL_MS = 3000;
const SCAN_POLL_MAX = 100;

export interface CloudDeps {
  context: vscode.ExtensionContext;
  broadcast: () => void;
  log: (message: string) => void;
  latestResult: () => ScanResult | null;
  workspaceRoot: () => string | null;
}

interface LinkInfo {
  orgId: string;
  projectId: string;
}

/**
 * ProjectLens Cloud integration: sign-in, organizations, team, API keys, organization AI keys,
 * linking the workspace to a cloud project, cloud scans and uploads of local results.
 * Tokens and keys stay in SecretStorage or are sent directly to the API; the webview only sees CloudState.
 */
export class CloudController {
  readonly state: CloudState;
  private token: string | null = null;

  constructor(private readonly deps: CloudDeps) {
    this.state = EMPTY_CLOUD_STATE(this.apiUrl());
    this.state.autoUpload = this.config().get<boolean>('autoUpload', false);
  }

  private config() {
    return vscode.workspace.getConfiguration('projectlens.cloud');
  }

  private apiUrl(): string {
    return this.config().get<string>('apiUrl', DEFAULT_CLOUD_URL) || DEFAULT_CLOUD_URL;
  }

  private client(withOrg = true): CloudClient {
    return new CloudClient(validateApiUrl(this.apiUrl()), this.token, withOrg ? this.state.currentOrgId : null);
  }

  private get role(): CloudRole | null {
    return this.state.organizations.find((o) => o.id === this.state.currentOrgId)?.role ?? null;
  }

  private get isAdmin(): boolean {
    return this.role === 'owner' || this.role === 'admin';
  }

  private link(): LinkInfo | null {
    return this.deps.context.workspaceState.get<LinkInfo>(LINK_STATE) ?? null;
  }

  // ───────────────────────────── Lifecycle ─────────────────────────────

  async init(): Promise<void> {
    this.token = (await this.deps.context.secrets.get(SESSION_SECRET)) ?? null;
    this.deps.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('projectlens.cloud')) {
          this.state.apiUrl = this.apiUrl();
          this.state.autoUpload = this.config().get<boolean>('autoUpload', false);
          this.deps.broadcast();
        }
      })
    );
    if (this.token) {
      await this.refresh(true);
    } else {
      void this.loadMethods();
    }
  }

  private async loadMethods(): Promise<void> {
    try {
      this.state.methods = await this.client(false).authConfig();
    } catch {
      this.state.methods = { github: true, email: false };
    }
    this.deps.broadcast();
  }

  /** Runs an action with a busy label and user-friendly error handling. */
  private async run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    this.state.busy = label;
    this.state.error = null;
    this.deps.broadcast();
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof CloudError ? err.message : err instanceof Error ? err.message : String(err);
      this.deps.log(`Cloud: ${label} failed: ${message}`);
      if (err instanceof CloudError && err.status === 401 && this.token) {
        await this.clearSession();
        this.state.error = 'Your ProjectLens Cloud session expired. Sign in again.';
      } else {
        this.state.error = message;
        void vscode.window.showErrorMessage(`ProjectLens Cloud: ${message}`);
      }
      return undefined;
    } finally {
      this.state.busy = null;
      this.deps.broadcast();
    }
  }

  async refresh(quiet = false): Promise<void> {
    if (!this.token) {
      await this.loadMethods();
      return;
    }
    await this.run(quiet ? 'Syncing' : 'Refreshing', async () => {
      const me = await this.client(false).me();
      this.state.signedIn = true;
      this.state.user = { name: me.user.name, email: me.user.email, githubLogin: me.user.githubLogin };
      this.state.organizations = me.organizations.map((o) => ({ id: o.id, name: o.name, role: o.role, plan: o.plan }));
      const saved = this.deps.context.globalState.get<string>(ORG_STATE);
      const link = this.link();
      const preferred = [link?.orgId, saved].find((id) => id && me.organizations.some((o) => o.id === id));
      this.state.currentOrgId = preferred ?? me.organizations[0]?.id ?? null;
      await this.loadOrg();
      this.state.lastSync = new Date().toISOString();
    });
  }

  private async loadOrg(): Promise<void> {
    const orgId = this.state.currentOrgId;
    if (!orgId) {
      return;
    }
    const c = this.client();
    const admin = this.isAdmin;
    const [members, invitations, apiKeys, aiKeys, projects, usage] = await Promise.all([
      c.members(orgId),
      admin ? c.invitations(orgId) : Promise.resolve([]),
      admin ? c.apiKeys() : Promise.resolve([]),
      c.aiKeys(orgId),
      c.projects(),
      c.usage(orgId)
    ]);
    this.state.members = members.map((m) => ({ userId: m.user.id, name: m.user.name, email: m.user.email, githubLogin: m.user.githubLogin, role: m.role, joinedAt: m.joinedAt }));
    this.state.invitations = invitations.filter((i) => !i.acceptedAt);
    this.state.apiKeys = apiKeys.filter((k) => !k.revokedAt);
    this.state.aiKeys = aiKeys.providers.map((p) => ({ provider: p.provider, label: p.label, configured: p.configured, last4: p.last4, defaultModel: p.defaultModel }));
    this.state.aiDefaultProvider = aiKeys.defaultProvider;
    this.state.projects = projects.map(projectView);
    this.state.usage = { limits: usage.limits, last24h: usage.last24h, projects: usage.projects };
    const link = this.link();
    this.state.linkedProjectId = link && link.orgId === orgId && projects.some((p) => p.id === link.projectId) ? link.projectId : null;
  }

  // ───────────────────────────── Sign-in ─────────────────────────────

  async signIn(method: 'github' | 'email'): Promise<void> {
    const label = `VS Code on ${vscode.env.machineId.slice(0, 8)}`;
    const session = await this.run('Signing in', async () => {
      if (method === 'github') {
        // VS Code's built-in GitHub authentication; the token is verified by the server and not stored there.
        const gh = await vscode.authentication.getSession('github', ['read:user', 'user:email'], { createIfNone: true });
        return this.client(false).signInWithGitHub(gh.accessToken, label);
      }
      const email = await vscode.window.showInputBox({
        title: 'ProjectLens Cloud: sign in with email',
        prompt: 'We will email you a 6-digit sign-in code.',
        placeHolder: 'you@company.com',
        ignoreFocusOut: true,
        validateInput: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? undefined : 'Enter a valid email address')
      });
      if (!email) {
        return undefined;
      }
      await this.client(false).startEmail(email.trim());
      const code = await vscode.window.showInputBox({
        title: 'ProjectLens Cloud: enter sign-in code',
        prompt: `Enter the 6-digit code sent to ${email.trim()}. It expires in 10 minutes.`,
        ignoreFocusOut: true,
        validateInput: (v) => (/^\d{6}$/.test(v.trim()) ? undefined : 'The code has 6 digits')
      });
      if (!code) {
        return undefined;
      }
      return this.client(false).verifyEmail(email.trim(), code.trim(), label);
    });
    if (!session) {
      return;
    }
    this.token = session.token;
    await this.deps.context.secrets.store(SESSION_SECRET, session.token);
    this.deps.log(`Cloud: signed in as ${session.user.githubLogin ?? session.user.email}`);
    await this.refresh();
    void vscode.window.showInformationMessage(`Signed in to ProjectLens Cloud as ${session.user.githubLogin ?? session.user.email}.`);
  }

  async signOut(): Promise<void> {
    if (this.token) {
      await this.client(false).logout().catch(() => undefined);
    }
    await this.clearSession();
    this.deps.broadcast();
  }

  private async clearSession(): Promise<void> {
    this.token = null;
    await this.deps.context.secrets.delete(SESSION_SECRET);
    Object.assign(this.state, EMPTY_CLOUD_STATE(this.apiUrl()), { autoUpload: this.state.autoUpload, methods: this.state.methods });
  }

  // ───────────────────────────── Organizations & team ─────────────────────────────

  async selectOrg(orgId: string): Promise<void> {
    if (!this.state.organizations.some((o) => o.id === orgId)) {
      return;
    }
    this.state.currentOrgId = orgId;
    await this.deps.context.globalState.update(ORG_STATE, orgId);
    await this.run('Loading organization', () => this.loadOrg());
  }

  async createOrg(): Promise<void> {
    const name = await vscode.window.showInputBox({ title: 'New organization', prompt: 'Organization (team) name', ignoreFocusOut: true, validateInput: (v) => (v.trim() ? undefined : 'Enter a name') });
    if (!name) {
      return;
    }
    const org = await this.run('Creating organization', () => this.client(false).createOrg(name.trim()));
    if (org) {
      await this.deps.context.globalState.update(ORG_STATE, org.id);
      await this.refresh();
    }
  }

  async invite(): Promise<void> {
    if (!this.state.currentOrgId) {
      return;
    }
    const email = await vscode.window.showInputBox({
      title: 'Invite a teammate',
      prompt: 'They join automatically when they sign in to ProjectLens Cloud with this email (GitHub or email code).',
      placeHolder: 'teammate@company.com',
      ignoreFocusOut: true,
      validateInput: (v) => (/^\S+@\S+\.\S+$/.test(v.trim()) ? undefined : 'Enter a valid email address')
    });
    if (!email) {
      return;
    }
    const roles = [
      { label: 'Member', description: 'View projects, run scans, upload results, request AI insights', role: 'member' },
      { label: 'Admin', description: 'Also manage members, API keys and AI keys', role: 'admin' },
      ...(this.role === 'owner' ? [{ label: 'Owner', description: 'Full control, including owners', role: 'owner' }] : [])
    ];
    const role = await vscode.window.showQuickPick(roles, { title: 'Role' });
    if (!role) {
      return;
    }
    const res = await this.run('Inviting', () => this.client().invite(this.state.currentOrgId!, email.trim(), role.role));
    if (res) {
      void vscode.window.showInformationMessage(res.emailed ? `Invitation emailed to ${email.trim()}.` : `${email.trim()} was invited. Ask them to sign in to ProjectLens Cloud with that email.`);
      await this.run('Refreshing', () => this.loadOrg());
    }
  }

  async changeRole(userId: string, role: CloudRole): Promise<void> {
    await this.run('Updating role', async () => {
      await this.client().changeRole(this.state.currentOrgId!, userId, role);
      await this.loadOrg();
    });
  }

  async removeMember(userId: string): Promise<void> {
    const member = this.state.members.find((m) => m.userId === userId);
    const self = this.state.user && member && (member.email === this.state.user.email || member.githubLogin === this.state.user.githubLogin);
    const who = member?.name ?? member?.githubLogin ?? member?.email ?? 'this member';
    const ok = await vscode.window.showWarningMessage(self ? 'Leave this organization?' : `Remove ${who} from the organization?`, { modal: true }, self ? 'Leave' : 'Remove');
    if (!ok) {
      return;
    }
    await this.run('Removing member', async () => {
      await this.client().removeMember(this.state.currentOrgId!, userId);
    });
    await this.refresh();
  }

  async revokeInvite(invitationId: string): Promise<void> {
    await this.run('Revoking invitation', async () => {
      await this.client().revokeInvitation(this.state.currentOrgId!, invitationId);
      await this.loadOrg();
    });
  }

  // ───────────────────────────── API keys ─────────────────────────────

  async createApiKey(): Promise<void> {
    const name = await vscode.window.showInputBox({ title: 'New API key', prompt: 'Name, e.g. the system that will use it', placeHolder: 'pm-tool', ignoreFocusOut: true, validateInput: (v) => (v.trim() ? undefined : 'Enter a name') });
    if (!name) {
      return;
    }
    const scopes = await vscode.window.showQuickPick(
      [
        { label: 'read', description: 'View projects, scans, findings, reports and insights', picked: true },
        { label: 'scan', description: 'Register projects, trigger scans, upload results', picked: true },
        { label: 'ai', description: 'Request AI insights (uses the organization AI key)', picked: true },
        { label: 'admin', description: 'Manage API keys — avoid for integrations' }
      ],
      { title: 'Permissions', canPickMany: true }
    );
    if (!scopes?.length) {
      return;
    }
    const created = await this.run('Creating API key', () => this.client().createApiKey(name.trim(), scopes.map((s) => s.label)));
    if (!created) {
      return;
    }
    await this.run('Refreshing', () => this.loadOrg());
    // The key is shown once, in a VS Code dialog — never sent to the webview.
    const copy = await vscode.window.showInformationMessage(
      `API key "${created.name}" created. Copy it now; it will not be shown again.`,
      { modal: true, detail: `${created.key}\n\nUse it as: Authorization: Bearer <key>\nBase URL: ${this.apiUrl()}` },
      'Copy key'
    );
    if (copy) {
      await vscode.env.clipboard.writeText(created.key);
      void vscode.window.showInformationMessage('API key copied to the clipboard.');
    }
  }

  async revokeApiKey(keyId: string): Promise<void> {
    const key = this.state.apiKeys.find((k) => k.id === keyId);
    const ok = await vscode.window.showWarningMessage(`Revoke API key "${key?.name ?? keyId}"? Systems using it will stop working immediately.`, { modal: true }, 'Revoke');
    if (!ok) {
      return;
    }
    await this.run('Revoking API key', async () => {
      await this.client().revokeApiKey(keyId);
      await this.loadOrg();
    });
  }

  // ───────────────────────────── Organization AI keys ─────────────────────────────

  async setAiKey(provider: AIProviderId): Promise<void> {
    const info = AI_PROVIDERS[provider];
    const key = await vscode.window.showInputBox({
      title: `${info.label} key for cloud AI insights`,
      prompt: `Used by ProjectLens Cloud for this organization's AI insights (encrypted on the server). Get a key at ${info.keyUrl}`,
      password: true,
      ignoreFocusOut: true,
      placeHolder: `${info.keyPrefix}…`,
      validateInput: (v) => (v.trim().length >= 8 ? undefined : 'Enter the API key')
    });
    if (!key) {
      return;
    }
    const res = await this.run(`Verifying ${info.label} key`, () => this.client().setAiKey(this.state.currentOrgId!, provider, key.trim()));
    if (res) {
      void vscode.window.showInformationMessage(`${info.label} key saved for the organization (••••${res.last4}).`);
      await this.run('Refreshing', () => this.loadOrg());
    }
  }

  async removeAiKey(provider: AIProviderId): Promise<void> {
    const ok = await vscode.window.showWarningMessage(`Remove the organization's ${AI_PROVIDERS[provider].label} key?`, { modal: true }, 'Remove');
    if (!ok) {
      return;
    }
    await this.run('Removing AI key', async () => {
      await this.client().removeAiKey(this.state.currentOrgId!, provider);
      await this.loadOrg();
    });
  }

  async setAiDefault(provider: AIProviderId): Promise<void> {
    await this.run('Updating AI settings', async () => {
      await this.client().setAiSettings(this.state.currentOrgId!, provider, null);
      await this.loadOrg();
    });
  }

  // ───────────────────────────── Workspace link, scans & uploads ─────────────────────────────

  async linkWorkspace(): Promise<void> {
    if (!this.state.currentOrgId) {
      return;
    }
    const root = this.deps.workspaceRoot();
    const git = root ? await readGitInfo(root) : null;
    const remote = git?.remoteUrl ? parseRemote(git.remoteUrl) : null;
    const items: (vscode.QuickPickItem & { id?: string })[] = [
      { label: '$(add) Create a new cloud project', description: remote ? `${remote.provider}: ${remote.repository}` : 'from this workspace' },
      ...this.state.projects.map((p) => ({ label: p.name, description: p.repository || 'uploads only', detail: p.externalId ? `External ID: ${p.externalId}` : undefined, id: p.id }))
    ];
    const pick = await vscode.window.showQuickPick(items, { title: 'Link this workspace to a ProjectLens Cloud project' });
    if (!pick) {
      return;
    }
    let projectId = pick.id;
    if (!projectId) {
      const created = await this.createProjectFromWorkspace(remote);
      projectId = created?.id;
    }
    if (!projectId) {
      return;
    }
    await this.deps.context.workspaceState.update(LINK_STATE, { orgId: this.state.currentOrgId, projectId } satisfies LinkInfo);
    await this.run('Refreshing', () => this.loadOrg());
    void vscode.window.showInformationMessage('Workspace linked to ProjectLens Cloud. Upload a scan or run a cloud scan from the Cloud page.');
  }

  private async createProjectFromWorkspace(remote: ReturnType<typeof parseRemote>): Promise<CloudProject | undefined> {
    const name = await vscode.window.showInputBox({ title: 'Cloud project name', value: vscode.workspace.name ?? 'My project', ignoreFocusOut: true, validateInput: (v) => (v.trim() ? undefined : 'Enter a name') });
    if (!name) {
      return undefined;
    }
    let provider: 'github' | 'gitlab' | 'none' = remote?.provider ?? 'none';
    if (!remote) {
      const choice = await vscode.window.showQuickPick(
        [
          { label: 'Uploads only', description: 'No repository access; upload scans from VS Code', value: 'none' as const },
          { label: 'GitHub repository', value: 'github' as const },
          { label: 'GitLab repository', value: 'gitlab' as const }
        ],
        { title: 'No Git remote detected. How should the cloud access this project?' }
      );
      if (!choice) {
        return undefined;
      }
      provider = choice.value;
    }
    let repository: string | undefined = remote?.repository;
    let baseUrl: string | undefined = remote?.baseUrl ?? undefined;
    if (provider !== 'none' && !repository) {
      const url = await vscode.window.showInputBox({ title: 'Repository URL', placeHolder: 'https://github.com/owner/repo', ignoreFocusOut: true });
      if (!url) {
        return undefined;
      }
      const parsed = parseRemote(url.trim());
      repository = parsed?.repository ?? url.trim();
      baseUrl = parsed?.baseUrl ?? undefined;
    }
    const token =
      provider === 'none'
        ? undefined
        : await vscode.window.showInputBox({
            title: 'Repository access token (optional)',
            prompt:
              provider === 'github'
                ? 'Needed for cloud scans of private repos: GitHub fine-grained token with Contents: Read-only. Leave empty to only upload scans from VS Code.'
                : 'Needed for cloud scans of private repos: GitLab token with read_repository. Leave empty to only upload scans from VS Code.',
            password: true,
            ignoreFocusOut: true
          });
    if (token === undefined && provider !== 'none') {
      return undefined;
    }
    const externalId = await vscode.window.showInputBox({
      title: 'External ID (optional)',
      prompt: "Your PM tool's project ID, so it can find this project via /projects/ext:<id>. Leave empty to skip.",
      ignoreFocusOut: true
    });
    if (externalId === undefined) {
      return undefined;
    }
    return this.run('Creating cloud project', () =>
      this.client().createProject({
        name: name.trim(),
        provider,
        repository: provider === 'none' ? undefined : repository,
        baseUrl,
        accessToken: token?.trim() || undefined,
        externalId: externalId.trim() || undefined
      })
    );
  }

  async unlink(): Promise<void> {
    await this.deps.context.workspaceState.update(LINK_STATE, undefined);
    this.state.linkedProjectId = null;
    this.deps.broadcast();
  }

  /** Sets or replaces the repository token of the linked project. */
  async setRepositoryToken(): Promise<void> {
    const projectId = this.state.linkedProjectId;
    const project = this.state.projects.find((p) => p.id === projectId);
    if (!project || project.provider === 'none') {
      return;
    }
    const token = await vscode.window.showInputBox({
      title: `Repository access token for ${project.name}`,
      prompt: project.provider === 'github' ? 'GitHub fine-grained token with Contents: Read-only. Leave empty to remove the stored token.' : 'GitLab token with read_repository. Leave empty to remove the stored token.',
      password: true,
      ignoreFocusOut: true
    });
    if (token === undefined) {
      return;
    }
    await this.run('Saving token', async () => {
      await this.client().updateProject(project.id, { accessToken: token.trim() || null });
      await this.loadOrg();
    });
  }

  async cloudScan(projectId?: string): Promise<void> {
    const id = projectId ?? this.state.linkedProjectId;
    if (!id) {
      void vscode.window.showInformationMessage('Link this workspace to a cloud project first.');
      return;
    }
    const started = await this.run('Starting cloud scan', () => this.client().triggerScan(id, 'full'));
    if (!started) {
      return;
    }
    let scan: CloudScan = started;
    await this.run('Cloud scan running', async () => {
      for (let i = 0; i < SCAN_POLL_MAX && (scan.status === 'queued' || scan.status === 'running'); i++) {
        await new Promise((r) => setTimeout(r, SCAN_POLL_MS));
        scan = await this.client().scan(scan.id);
      }
      await this.loadOrg();
    });
    if (scan.status === 'completed') {
      const s = scan.overview?.scores;
      void vscode.window.showInformationMessage(`Cloud scan completed${s ? `: security ${s.security.score ?? '—'}, quality ${s.quality.score ?? '—'}, readiness ${s.readiness.score ?? '—'}` : ''}.`);
    } else if (scan.status === 'failed') {
      void vscode.window.showErrorMessage(`Cloud scan failed: ${scan.error ?? 'unknown error'}`);
    }
  }

  /** Uploads the latest local scan to the linked project. `silent` is used by auto-upload (the setting is the consent). */
  async upload(silent = false): Promise<void> {
    const result = this.deps.latestResult();
    const projectId = this.state.linkedProjectId;
    if (!this.state.signedIn || !projectId) {
      if (!silent) {
        void vscode.window.showInformationMessage('Sign in and link this workspace to a cloud project first.');
      }
      return;
    }
    if (!result) {
      if (!silent) {
        void vscode.window.showInformationMessage('Run a scan first, then upload it.');
      }
      return;
    }
    const project = this.state.projects.find((p) => p.id === projectId);
    const org = this.state.organizations.find((o) => o.id === this.state.currentOrgId);
    if (!silent) {
      const ok = await vscode.window.showWarningMessage(
        `Upload this ${result.mode} scan to "${project?.name ?? 'project'}" (${org?.name ?? 'organization'})?`,
        {
          modal: true,
          detail:
            'Uploaded: scores, technologies, progress, and findings with file paths, line numbers and redacted evidence. Not uploaded: source code, secrets, local folder paths. Members of the organization and its API keys can read the results.'
        },
        'Upload'
      );
      if (!ok) {
        return;
      }
    }
    const root = this.deps.workspaceRoot();
    const git = root ? await readGitInfo(root) : null;
    const scan = await this.run('Uploading scan', async () => {
      const uploaded = await this.client().upload(projectId, { result: trimForUpload(result), commitSha: git?.commitSha ?? undefined, branch: git?.branch ?? undefined });
      await this.loadOrg();
      return uploaded;
    });
    if (scan && !silent) {
      void vscode.window.showInformationMessage('Scan uploaded to ProjectLens Cloud.');
    }
    if (scan) {
      this.deps.log(`Cloud: uploaded scan ${scan.id}${silent ? ' (auto)' : ''}`);
    }
  }

  /** Called after every local scan. */
  async onScanCompleted(): Promise<void> {
    if (this.state.autoUpload && this.state.signedIn && this.state.linkedProjectId) {
      await this.upload(true);
    }
  }

  async setAutoUpload(enabled: boolean): Promise<void> {
    await this.config().update('autoUpload', enabled, vscode.ConfigurationTarget.Workspace);
    this.state.autoUpload = enabled;
    this.deps.broadcast();
  }
}

function projectView(p: CloudProject): CloudProjectView {
  const s = p.latestScan;
  return {
    id: p.id,
    name: p.name,
    provider: p.provider,
    repository: p.repository,
    externalId: p.externalId,
    hasAccessToken: p.hasAccessToken,
    latestScan: s
      ? {
          id: s.id,
          status: s.status,
          source: s.source,
          finishedAt: s.finishedAt,
          commitSha: s.commitSha,
          scores: s.overview
            ? { quality: s.overview.scores.quality.score, security: s.overview.scores.security.score, implementation: s.overview.scores.implementation.score, readiness: s.overview.scores.readiness.score }
            : null,
          critical: s.overview?.findings.bySeverity.critical ?? 0,
          high: s.overview?.findings.bySeverity.high ?? 0
        }
      : null
  };
}
