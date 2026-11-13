import * as vscode from 'vscode';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  AI_TOOL_LABELS,
  BUILTIN_DETECTORS,
  EMPTY_PROMPT_GUARD,
  TOOL_CAN_BLOCK,
  defaultPromptPolicy,
  type AiTool,
  type LocalPromptPolicy,
  type PromptEvent,
  type PromptGuardView,
  type PromptPolicy
} from '../models/promptGuard';
import { CloudError, type CloudClient } from '../cloud/cloudClient';
import { allToolStatus, defaultHookDir, installHook, refreshInstalledHooks, uninstallHook, writeRuntime, type HookPaths } from './installers';
import { checkPrompt, describeMatches } from './detector';

const SYNC_MS = 10 * 60_000;
const HEARTBEAT_MS = 60 * 60_000;
const UPLOAD_BATCH = 200;

export interface PromptGuardOrgContext {
  client: CloudClient;
  orgId: string;
  orgName: string;
  isAdmin: boolean;
}

export interface PromptGuardDeps {
  context: vscode.ExtensionContext;
  broadcast: () => void;
  log: (message: string) => void;
  /** Current organization, or null when signed out. */
  org: () => PromptGuardOrgContext | null;
  openDashboard: () => void;
  /** Reloads organization data (after consent unblocks it). */
  refreshCloud: () => Promise<void>;
}

/**
 * Prompt Guard on this machine: syncs the organization's policy to ~/.projectlens/prompt-guard,
 * asks for consent with the organization's notice, installs hooks into AI coding tools, and
 * uploads metadata-only events. Prompt text never leaves the machine.
 */
export class PromptGuardController implements vscode.Disposable {
  readonly state: PromptGuardView = EMPTY_PROMPT_GUARD();
  private readonly paths: HookPaths;
  private readonly status: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private timer: NodeJS.Timeout | undefined;
  private lastHeartbeat = 0;
  private lastHeartbeatKey = '';
  /** consentVersion already prompted this session (per org), to avoid nagging. */
  private readonly prompted = new Map<string, number>();
  private uploading = false;

  constructor(private readonly deps: PromptGuardDeps) {
    const home = homedir();
    this.paths = { home, dir: process.env.PROJECTLENS_PROMPT_GUARD_DIR || defaultHookDir(home), windows: process.platform === 'win32' };
    this.status = vscode.window.createStatusBarItem('projectlens.promptGuard', vscode.StatusBarAlignment.Right, 90);
    this.status.name = 'ProjectLens Prompt Guard';
    this.status.command = 'projectlens.promptGuard.menu';
  }

  private get version(): string {
    return String((this.deps.context.extension?.packageJSON as { version?: string } | undefined)?.version ?? '0.0.0');
  }

  init(): void {
    this.refreshTools();
    // Keep installed hooks running the script shipped with this extension version.
    if (this.state.tools.some((t) => t.installed)) {
      this.safe(() => {
        this.writeRuntime();
        // Also migrate hook entries written by older versions (e.g. Claude Code on Windows).
        refreshInstalledHooks(this.paths);
      });
      this.refreshTools();
    }
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(this.paths.dir), 'events.jsonl'));
    const onEvents = () => void this.processEvents();
    this.disposables.push(watcher, watcher.onDidCreate(onEvents), watcher.onDidChange(onEvents), this.status);
    this.timer = setInterval(() => void this.sync(true), SYNC_MS);
    this.renderStatus();
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    vscode.Disposable.from(...this.disposables).dispose();
  }

  // ───────────────────────────── Sync ─────────────────────────────

  /**
   * Fetches the policy, writes it for the hooks, uploads pending events and (for admins) loads
   * reports. When the policy needs the member's consent, asks once per policy version.
   */
  async sync(quiet = false): Promise<void> {
    const org = this.deps.org();
    if (!org) {
      Object.assign(this.state, EMPTY_PROMPT_GUARD(), { tools: this.state.tools, pendingUploads: this.state.pendingUploads, hasSanitizedCopy: this.hasSanitized() });
      this.writePolicy(null, null);
      this.render();
      return;
    }
    try {
      const res = await org.client.promptGuardPolicy(org.orgId);
      Object.assign(this.state, {
        available: true,
        orgName: res.organization.name,
        isAdmin: org.isAdmin,
        policy: res.policy,
        consent: res.me.consent,
        error: null
      });
      this.refreshTools();
      this.writePolicy(res.policy, res.organization.name);
      await this.uploadEvents(org);
      await this.loadReports(org);
      await this.heartbeat(org);
      this.render();
      if (res.policy.mode !== 'off' && res.me.consent === 'pending' && this.prompted.get(org.orgId) !== res.policy.consentVersion) {
        this.prompted.set(org.orgId, res.policy.consentVersion);
        // Not awaited: the caller (organization loading) must not wait on a dialog.
        void this.review(res.policy.mode === 'required' ? 'required' : 'offer');
      }
    } catch (err) {
      this.state.error = err instanceof Error ? err.message : String(err);
      this.deps.log(`Prompt Guard: sync failed: ${this.state.error}`);
      if (!quiet) {
        void vscode.window.showErrorMessage(`Prompt Guard: ${this.state.error}`);
      }
      this.render();
    }
  }

  private async loadReports(org: PromptGuardOrgContext): Promise<void> {
    const [events, members, summary] = await Promise.all([
      org.client.promptGuardEvents(org.orgId, 50).catch(() => []),
      org.isAdmin ? org.client.promptGuardMembers(org.orgId).catch(() => []) : Promise.resolve([]),
      org.isAdmin ? org.client.promptGuardSummary(org.orgId).catch(() => null) : Promise.resolve(null)
    ]);
    this.state.members = members.map((m) => ({
      userId: m.user.id,
      name: m.user.name || m.user.githubLogin || m.user.email || m.user.id,
      role: m.role,
      consent: m.consent,
      enabled: m.enabled,
      tools: m.tools,
      upToDate: m.upToDate,
      lastSeenAt: m.lastSeenAt,
      last30Days: m.last30Days
    }));
    const names = new Map(this.state.members.map((m) => [m.userId, m.name]));
    this.state.events = events.map((e) => ({ ...e, member: org.isAdmin ? names.get(e.userId) ?? null : null }));
    this.state.summary = summary;
  }

  private async heartbeat(org: PromptGuardOrgContext): Promise<void> {
    const tools = this.state.tools.filter((t) => t.installed).map((t) => t.tool);
    const body = { enabled: this.state.active, tools, policyVersion: this.state.active ? this.state.policy?.version ?? null : null, clientVersion: this.version };
    const key = JSON.stringify(body);
    if (key === this.lastHeartbeatKey && Date.now() - this.lastHeartbeat < HEARTBEAT_MS) {
      return;
    }
    if (this.state.policy?.mode === 'off' && !tools.length && !this.lastHeartbeatKey) {
      return; // nothing to report
    }
    await org.client.promptGuardHeartbeat(org.orgId, body).catch((err) => this.deps.log(`Prompt Guard: heartbeat failed: ${err instanceof Error ? err.message : err}`));
    this.lastHeartbeat = Date.now();
    this.lastHeartbeatKey = key;
  }

  /** Writes the policy the hooks enforce. Enforcement requires an active policy and the member's consent. */
  private writePolicy(policy: PromptPolicy | null, orgName: string | null): void {
    const enabled = !!policy && policy.mode !== 'off' && this.state.consent === 'accepted';
    this.state.active = enabled && this.state.tools.some((t) => t.installed);
    const local: LocalPromptPolicy = { enabled, orgName: orgName ?? 'organization', policy: policy ?? defaultPromptPolicy() };
    this.safe(() => {
      mkdirSync(this.paths.dir, { recursive: true, mode: 0o700 });
      const file = join(this.paths.dir, 'policy.json');
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify(local), { mode: 0o600 });
      renameSync(tmp, file);
    });
  }

  // ───────────────────────────── Consent ─────────────────────────────

  /** Shows the organization's notice and policy, and records the member's decision. */
  async review(reason: 'required' | 'offer' | 'manual' = 'manual'): Promise<void> {
    const org = this.deps.org();
    const policy = this.state.policy;
    if (!org || !policy) {
      void vscode.window.showInformationMessage('Prompt Guard: sign in to ProjectLens Cloud and select an organization first.');
      return;
    }
    if (policy.mode === 'off') {
      void vscode.window.showInformationMessage(`Prompt Guard is turned off for ${this.state.orgName}.`);
      return;
    }
    const detail = [
      policy.notice,
      '',
      'What is checked on this computer:',
      ...BUILTIN_DETECTORS.filter((d) => policy.builtin[d.id] && policy.builtin[d.id] !== 'off').map((d) => `• ${d.label}: ${actionWord(policy.builtin[d.id])}`),
      ...policy.customRules.map((r) => `• ${r.name}: ${actionWord(r.action)}`),
      '',
      'What the organization sees: the rule that matched, the AI tool, the project folder name and the time. Never your prompt text.',
      policy.mode === 'required' ? `\n${this.state.orgName} requires Prompt Guard. Organization projects and scans stay unavailable until you accept.` : `\nThis is optional. You can turn it off any time.`
    ].join('\n');
    const accept = policy.mode === 'required' ? 'Accept and turn on' : 'Turn on';
    const choices = policy.mode === 'required' ? [accept] : [accept, 'Decline'];
    const pick = await vscode.window.showInformationMessage(`${this.state.orgName}: Prompt Guard for AI coding tools`, { modal: true, detail }, ...choices);
    if (!pick) {
      if (reason === 'required') {
        void vscode.window.showWarningMessage(`Prompt Guard is required by ${this.state.orgName}. Organization data is unavailable until you accept.`, 'Review policy').then((p) => p && this.review('manual'));
      }
      return;
    }
    await this.busy(pick === accept ? 'Turning on Prompt Guard' : 'Saving', async () => {
      const res = await org.client.promptGuardConsent(org.orgId, policy.consentVersion, pick === accept);
      this.state.consent = res.consent;
    });
    this.writePolicy(policy, this.state.orgName);
    if (pick === accept && this.state.consent === 'accepted') {
      await this.chooseAndInstall();
    }
    this.render();
    // Reload organization data that may have been blocked by the consent requirement.
    await this.deps.refreshCloud();
  }

  // ───────────────────────────── Hooks ─────────────────────────────

  private refreshTools(): void {
    this.state.tools = allToolStatus(this.paths).map((s) => ({ ...s, label: AI_TOOL_LABELS[s.tool], canBlock: TOOL_CAN_BLOCK[s.tool] }));
    this.state.hasSanitizedCopy = this.hasSanitized();
  }

  private writeRuntime(): void {
    writeRuntime(this.paths, this.deps.context.asAbsolutePath(join('dist', 'prompt-guard.js')), process.execPath);
  }

  async chooseAndInstall(): Promise<void> {
    this.refreshTools();
    const items = this.state.tools.map((t) => ({
      label: t.label,
      description: t.installed ? 'installed' : t.detected ? 'detected' : 'not found on this computer',
      detail: t.canBlock ? 'Blocks sensitive prompts before they are sent' : 'Can only alert after sending (Copilot hooks cannot block)',
      picked: t.installed || t.detected,
      tool: t.tool
    }));
    const picks = await vscode.window.showQuickPick(items, { canPickMany: true, title: 'Prompt Guard: protect these AI tools', placeHolder: 'Hooks are added to each tool\'s user settings (a backup is kept)' });
    if (!picks) {
      return;
    }
    const chosen = new Set(picks.map((p) => p.tool));
    const remove = this.state.tools.filter((t) => t.installed && !chosen.has(t.tool)).map((t) => t.tool);
    if (chosen.size) {
      await this.install([...chosen]);
    }
    if (remove.length) {
      await this.uninstall(remove);
    }
  }

  async install(tools: AiTool[]): Promise<void> {
    await this.busy('Installing hooks', async () => {
      this.writeRuntime();
      const notes: string[] = [];
      for (const tool of tools) {
        try {
          const s = installHook(this.paths, tool);
          if (s.note) {
            notes.push(s.note);
          }
          this.deps.log(`Prompt Guard: installed hook for ${AI_TOOL_LABELS[tool]} (${s.configPath})`);
        } catch (err) {
          void vscode.window.showErrorMessage(`Prompt Guard: could not set up ${AI_TOOL_LABELS[tool]}: ${err instanceof Error ? err.message : err}`);
        }
      }
      this.refreshTools();
      this.writePolicy(this.state.policy, this.state.orgName);
      for (const note of notes) {
        void vscode.window.showInformationMessage(`Prompt Guard: ${note}`);
      }
    });
    await this.afterHookChange();
  }

  async uninstall(tools: AiTool[]): Promise<void> {
    if (this.state.policy?.mode === 'required' && this.state.consent === 'accepted') {
      const ok = await vscode.window.showWarningMessage(
        `${this.state.orgName} requires Prompt Guard. Removing hooks is visible to your organization administrators.`,
        { modal: true },
        'Remove anyway'
      );
      if (!ok) {
        return;
      }
    }
    await this.busy('Removing hooks', async () => {
      for (const tool of tools) {
        try {
          uninstallHook(this.paths, tool);
        } catch (err) {
          void vscode.window.showErrorMessage(`Prompt Guard: could not update ${AI_TOOL_LABELS[tool]}: ${err instanceof Error ? err.message : err}`);
        }
      }
      this.refreshTools();
      this.writePolicy(this.state.policy, this.state.orgName);
    });
    await this.afterHookChange();
  }

  private async afterHookChange(): Promise<void> {
    const org = this.deps.org();
    if (org) {
      this.lastHeartbeatKey = '';
      await this.heartbeat(org);
    }
    this.render();
  }

  // ───────────────────────────── Events ─────────────────────────────

  private eventsFile(): string {
    return join(this.paths.dir, 'events.jsonl');
  }

  private readPending(): PromptEvent[] {
    const file = this.eventsFile();
    if (!existsSync(file)) {
      return [];
    }
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as PromptEvent];
        } catch {
          return [];
        }
      });
  }

  /** New events from the hooks: alert about Copilot prompts (already sent), then upload. */
  private async processEvents(): Promise<void> {
    const pending = this.readPending();
    const seen = new Set(this.deps.context.globalState.get<string[]>('projectlens.promptGuard.alerted') ?? []);
    const fresh = pending.filter((e) => e.action === 'detected' && !seen.has(e.id));
    if (fresh.length) {
      await this.deps.context.globalState.update('projectlens.promptGuard.alerted', [...seen, ...fresh.map((e) => e.id)].slice(-200));
      const e = fresh[fresh.length - 1];
      const rules = e.ruleIds.map(ruleLabel).join(', ');
      void vscode.window
        .showWarningMessage(
          `Prompt Guard: a prompt sent to ${AI_TOOL_LABELS[e.tool]} contained ${rules}. ${AI_TOOL_LABELS[e.tool]} cannot block prompts, so it was already sent. If it was a real secret, rotate it now.`,
          'Copy Sanitized Prompt'
        )
        .then((p) => p && this.copySanitized());
    }
    const org = this.deps.org();
    if (org) {
      await this.uploadEvents(org);
      await this.loadReports(org).catch(() => undefined);
    }
    this.render();
  }

  private async uploadEvents(org: PromptGuardOrgContext): Promise<void> {
    if (this.uploading) {
      return;
    }
    const file = this.eventsFile();
    if (!existsSync(file) || statSync(file).size === 0) {
      this.state.pendingUploads = 0;
      return;
    }
    this.uploading = true;
    const sending = `${file}.sending`;
    try {
      if (!existsSync(sending)) {
        renameSync(file, sending); // hooks start a fresh file while we upload
      }
      const lines = readFileSync(sending, 'utf8').split('\n').filter(Boolean);
      const events = lines.flatMap((l) => {
        try {
          return [JSON.parse(l) as PromptEvent];
        } catch {
          return [];
        }
      });
      for (let i = 0; i < events.length; i += UPLOAD_BATCH) {
        await org.client.uploadPromptEvents(org.orgId, events.slice(i, i + UPLOAD_BATCH));
      }
      rmSync(sending, { force: true });
      this.state.pendingUploads = this.readPending().length;
    } catch (err) {
      // Keep events for the next attempt (put them back in front of anything new).
      if (existsSync(sending)) {
        const rest = existsSync(file) ? readFileSync(file, 'utf8') : '';
        writeFileSync(file, readFileSync(sending, 'utf8') + rest, { mode: 0o600 });
        rmSync(sending, { force: true });
      }
      this.state.pendingUploads = this.readPending().length;
      if (!(err instanceof CloudError && err.status === 0)) {
        this.deps.log(`Prompt Guard: event upload failed: ${err instanceof Error ? err.message : err}`);
      }
    } finally {
      this.uploading = false;
    }
  }

  // ───────────────────────────── Sanitize ─────────────────────────────

  private hasSanitized(): boolean {
    return existsSync(join(this.paths.dir, 'last-sanitized.txt'));
  }

  /** Copies the sanitized version of the last stopped prompt and deletes the local copy. */
  async copySanitized(): Promise<void> {
    const file = join(this.paths.dir, 'last-sanitized.txt');
    if (!existsSync(file)) {
      void vscode.window.showInformationMessage('Prompt Guard: no stopped prompt to copy.');
      return;
    }
    await vscode.env.clipboard.writeText(readFileSync(file, 'utf8'));
    rmSync(file, { force: true });
    this.state.hasSanitizedCopy = false;
    this.render();
    void vscode.window.showInformationMessage('Prompt Guard: sanitized prompt copied. Paste it into your AI tool.');
  }

  /** Checks the editor selection (or clipboard) against the policy and copies a sanitized version. */
  async sanitizeText(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const selection = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection) : '';
    const text = selection || (await vscode.env.clipboard.readText());
    if (!text.trim()) {
      void vscode.window.showInformationMessage('Prompt Guard: select text or copy it to the clipboard first.');
      return;
    }
    const policy = this.state.policy && this.state.policy.mode !== 'off' ? this.state.policy : defaultPromptPolicy();
    const check = checkPrompt(text, policy);
    if (check.action === 'none') {
      void vscode.window.showInformationMessage('Prompt Guard: nothing sensitive found. The text was not changed.');
      return;
    }
    await vscode.env.clipboard.writeText(check.sanitized);
    void vscode.window.showInformationMessage(`Prompt Guard: removed ${describeMatches(check.matches)}. The sanitized text is on your clipboard.`);
  }

  // ───────────────────────────── Admin ─────────────────────────────

  async savePolicy(patch: Record<string, unknown>): Promise<void> {
    const org = this.deps.org();
    if (!org?.isAdmin) {
      return;
    }
    if (patch.mode === 'required' && this.state.policy?.mode !== 'required') {
      const ok = await vscode.window.showWarningMessage(
        'Require Prompt Guard for everyone?',
        { modal: true, detail: 'Members must accept the notice before they can use organization projects and scans. Each member is shown the notice and the rules, and decides which AI tools to protect.' },
        'Require'
      );
      if (!ok) {
        this.render();
        return;
      }
    }
    const saved = await this.busy('Saving policy', () => org.client.savePromptGuardPolicy(org.orgId, patch));
    if (saved) {
      void vscode.window.showInformationMessage(`Prompt Guard policy saved (version ${saved.version}).`);
      await this.sync();
    }
  }

  // ───────────────────────────── Menu & UI ─────────────────────────────

  async menu(): Promise<void> {
    const items: (vscode.QuickPickItem & { run: () => unknown })[] = [
      { label: '$(dashboard) Open Prompt Guard', run: () => this.deps.openDashboard() },
      { label: '$(law) Review organization policy', run: () => this.review('manual') },
      { label: '$(plug) Choose protected AI tools…', run: () => this.chooseAndInstall() },
      { label: '$(shield) Sanitize selection or clipboard', run: () => this.sanitizeText() },
      ...(this.hasSanitized() ? [{ label: '$(clippy) Copy sanitized version of the last stopped prompt', run: () => this.copySanitized() }] : []),
      { label: '$(sync) Sync policy now', run: () => this.sync() }
    ];
    const pick = await vscode.window.showQuickPick(items, { title: 'ProjectLens Prompt Guard' });
    await pick?.run();
  }

  private renderStatus(): void {
    const s = this.state;
    const installed = s.tools.filter((t) => t.installed);
    if (!s.available || !s.policy || s.policy.mode === 'off') {
      if (installed.length) {
        this.status.text = '$(shield) Prompt Guard: off';
        this.status.tooltip = 'Hooks are installed but no organization policy is active. Prompts pass through unchanged.';
        this.status.show();
      } else {
        this.status.hide();
      }
      return;
    }
    if (s.consent === 'pending') {
      this.status.text = '$(warning) Prompt Guard: review';
      this.status.tooltip = `${s.orgName} asks you to review its Prompt Guard policy.`;
      this.status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (s.consent === 'declined') {
      this.status.text = '$(shield) Prompt Guard: declined';
      this.status.tooltip = 'You declined the optional policy. Click to review.';
      this.status.backgroundColor = undefined;
    } else if (!installed.length) {
      this.status.text = '$(warning) Prompt Guard: no tools';
      this.status.tooltip = 'Accepted, but no AI tool hooks are installed. Click to choose tools.';
      this.status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else {
      this.status.text = `$(shield) Prompt Guard: on`;
      this.status.tooltip = `Checking prompts in ${installed.map((t) => t.label).join(', ')} with ${s.orgName}'s policy (v${s.policy.version}). Prompts stay on this computer.`;
      this.status.backgroundColor = undefined;
    }
    this.status.show();
  }

  private render(): void {
    this.state.hasSanitizedCopy = this.hasSanitized();
    this.renderStatus();
    this.deps.broadcast();
  }

  private async busy<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    this.state.busy = label;
    this.state.error = null;
    this.deps.broadcast();
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.state.error = message;
      this.deps.log(`Prompt Guard: ${label} failed: ${message}`);
      void vscode.window.showErrorMessage(`Prompt Guard: ${message}`);
      return undefined;
    } finally {
      this.state.busy = null;
      this.render();
    }
  }

  private safe(fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.deps.log(`Prompt Guard: ${err instanceof Error ? err.message : err}`);
    }
  }
}

function actionWord(a: string): string {
  return a === 'block' ? 'blocked' : a === 'redact' ? 'blocked with a sanitized copy' : a === 'warn' ? 'warning only' : 'off';
}

export function ruleLabel(id: string): string {
  if (id.startsWith('custom.')) {
    return 'a custom rule match';
  }
  return (BUILTIN_DETECTORS.find((d) => d.id === id)?.label ?? id).split(',')[0].toLowerCase();
}
