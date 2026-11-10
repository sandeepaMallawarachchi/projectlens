import * as vscode from 'vscode';
import * as path from 'node:path';
import type { AppState, HostMessage, WebviewMessage } from './models/messages';
import { parseWebviewMessage } from './models/messages';
import type { ScanMode, ScanResult } from './models/types';
import type { AIInsight, AIProviderId, AITask } from './models/ai';
import { AI_PROVIDER_IDS, AI_PROVIDERS, AI_TASK_LABELS } from './models/ai';
import { scanWorkspace } from './core/scanner';
import { buildJsonReport, buildMarkdownReport } from './core/report';
import { CancelledError } from './utils/async';
import type { ScanStore } from './storage/scanStore';
import { ApiKeyStore } from './storage/secretStore';
import { createProvider } from './ai/providers';
import type { AIProvider } from './ai/AIProvider';
import { AIService, type ConsentPreview } from './ai/aiService';
import { AIError, describeAIError } from './ai/errors';
import { DiagnosticsPublisher } from './views/diagnostics';
import { resolveNavigationTarget } from './views/navigation';
import { REQUIREMENTS_FILE, REQUIREMENTS_TEMPLATE } from './analyzers/progress/requirements';
import { getConfig, modelFor, modelSettingKey } from './config';
import { isInside } from './utils/paths';

export interface WebviewSink {
  postMessage(message: HostMessage): Thenable<boolean>;
}

const MAX_AI_FILE_BYTES = 1024 * 1024;

export class ProjectLensController implements vscode.Disposable {
  private readonly sinks = new Set<WebviewSink>();
  private readonly diagnostics = new DiagnosticsPublisher();
  private readonly keyStore: ApiKeyStore;
  private readonly providers = new Map<AIProviderId, AIProvider>();
  private readonly ai: AIService;
  private scanAbort: AbortController | null = null;
  private aiAbort: AbortController | null = null;
  private broadcastTimer: NodeJS.Timeout | null = null;
  private sessionConsent = false;
  private readonly output = vscode.window.createOutputChannel('ProjectLens');
  private readonly state: AppState;
  private openDashboardHandler: ((tab?: string) => void) | null = null;

  constructor(
    private readonly context: vscode.ExtensionContext,
    readonly store: ScanStore
  ) {
    this.keyStore = new ApiKeyStore(context.secrets);
    this.ai = new AIService({
      provider: () => this.activeProvider(),
      settings: () => getConfig().ai,
      readFile: (uri) => this.readWorkspaceFile(uri),
      consent: (preview) => this.askConsent(preview),
      onUsage: (usage, rateLimit) => {
        const s = this.state.ai.sessionUsage;
        s.promptTokens += usage.promptTokens;
        s.completionTokens += usage.completionTokens;
        s.totalTokens += usage.totalTokens;
        this.state.ai.rateLimit = rateLimit;
      }
    });
    const cfg = getConfig();
    this.state = {
      workspace: this.workspaceInfo(),
      scan: null,
      lastError: null,
      result: null,
      history: store.history(),
      ai: {
        provider: cfg.ai.provider,
        providers: [],
        hasApiKey: false,
        model: cfg.ai.model,
        availableModels: [],
        running: null,
        lastError: null,
        connection: { status: 'unknown', message: 'Not tested' },
        insights: store.insights(),
        sessionUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requests: 0 }
      },
      settings: { gitleaksEnabled: cfg.gitleaks.enabled, diagnosticsEnabled: cfg.diagnostics.enabled }
    };
  }

  async init(): Promise<void> {
    await this.refreshAiState();
    this.state.result = await this.store.loadLatest();
    if (this.state.result) {
      this.publishDiagnostics(this.state.result);
    }
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('projectlens')) {
          const cfg = getConfig();
          void this.refreshAiState().then(() => this.broadcast());
          this.state.settings = { gitleaksEnabled: cfg.gitleaks.enabled, diagnosticsEnabled: cfg.diagnostics.enabled };
          if (this.state.result && e.affectsConfiguration('projectlens.diagnostics')) {
            this.publishDiagnostics(this.state.result);
          }
          this.broadcast();
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.state.workspace = this.workspaceInfo();
        this.broadcast();
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.state.workspace = this.workspaceInfo();
        this.broadcast();
      }),
      this.context.secrets.onDidChange(async (e) => {
        if (e.key.startsWith('projectlens.')) {
          await this.refreshAiState();
          this.broadcast();
        }
      })
    );
    this.broadcast();
  }

  setDashboardOpener(fn: (tab?: string) => void): void {
    this.openDashboardHandler = fn;
  }

  register(sink: WebviewSink): vscode.Disposable {
    this.sinks.add(sink);
    void sink.postMessage({ type: 'state', state: this.state });
    return new vscode.Disposable(() => this.sinks.delete(sink));
  }

  private workspaceInfo(): AppState['workspace'] {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) {
      return null;
    }
    return { name: vscode.workspace.name ?? folders[0].name, folders: folders.length, trusted: vscode.workspace.isTrusted };
  }

  private log(message: string): void {
    this.output.appendLine(`[${new Date().toISOString()}] ${message}`);
  }

  /** Throttled state broadcast to all webviews. */
  broadcast(immediate = false): void {
    if (immediate) {
      if (this.broadcastTimer) {
        clearTimeout(this.broadcastTimer);
        this.broadcastTimer = null;
      }
      for (const s of this.sinks) {
        void s.postMessage({ type: 'state', state: this.state });
      }
      return;
    }
    if (this.broadcastTimer) {
      return;
    }
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null;
      for (const s of this.sinks) {
        void s.postMessage({ type: 'state', state: this.state });
      }
    }, 120);
  }

  private toast(level: 'info' | 'error', message: string): void {
    for (const s of this.sinks) {
      void s.postMessage({ type: 'toast', level, message });
    }
  }

  // ───────────────────────────── Messages ─────────────────────────────

  async handleMessage(raw: unknown): Promise<void> {
    const msg = parseWebviewMessage(raw);
    if (!msg) {
      this.log(`Ignored invalid webview message: ${JSON.stringify(raw)?.slice(0, 200)}`);
      return;
    }
    try {
      await this.dispatch(msg);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log(`Message ${msg.type} failed: ${message}`);
      this.toast('error', message);
    }
  }

  private async dispatch(msg: WebviewMessage): Promise<void> {
    switch (msg.type) {
      case 'ready':
      case 'refresh':
        await this.refreshAiState();
        this.state.history = this.store.history();
        this.broadcast(true);
        return;
      case 'scan':
        void this.runScan(msg.mode);
        return;
      case 'cancelScan':
        this.cancelScan();
        return;
      case 'openDashboard':
        this.openDashboardHandler?.(msg.tab);
        return;
      case 'openSettings':
        await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:projectlens-dev.projectlens');
        return;
      case 'openFile':
        await this.openFile(msg);
        return;
      case 'aiRun':
        void this.runAI(msg.task, { findingId: msg.findingId, moduleId: msg.moduleId, fileUri: msg.fileUri });
        return;
      case 'aiCancel':
        this.aiAbort?.abort();
        return;
      case 'aiDeleteInsight':
        this.state.ai.insights = await this.store.deleteInsight(msg.id);
        this.broadcast();
        return;
      case 'setApiKey':
        await this.setApiKey(msg.provider);
        return;
      case 'removeApiKey':
        await this.removeApiKey(msg.provider);
        return;
      case 'setProvider':
        await this.selectProvider(msg.provider);
        return;
      case 'testConnection':
        await this.testConnection();
        return;
      case 'listModels':
        await this.listModels(false);
        return;
      case 'setModel':
        await this.setModel(msg.model);
        return;
      case 'export':
        await this.exportReport(msg.format);
        return;
      case 'clearHistory':
        await this.clearHistory();
        return;
      case 'createRequirements':
        await this.createRequirementsFile();
        return;
    }
  }

  // ───────────────────────────── Scanning ─────────────────────────────

  async runScan(mode: ScanMode): Promise<ScanResult | null> {
    const folders = vscode.workspace.workspaceFolders?.filter((f) => f.uri.scheme === 'file') ?? [];
    if (!folders.length) {
      void vscode.window.showWarningMessage('ProjectLens: open a local folder or workspace to scan.');
      return null;
    }
    if (this.scanAbort) {
      void vscode.window.showInformationMessage('ProjectLens: a scan is already running.');
      return null;
    }
    const cfg = getConfig();
    const abort = new AbortController();
    this.scanAbort = abort;
    this.state.lastError = null;
    this.state.scan = { mode, phase: 'Starting', processed: 0, total: 0, startedAt: new Date().toISOString() };
    this.broadcast(true);
    this.log(`${mode} scan started for ${folders.map((f) => f.name).join(', ')}`);

    try {
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: `ProjectLens ${mode === 'full' ? 'Full' : 'Quick'} Scan` },
        async (progress) =>
          scanWorkspace({
            roots: folders.map((f) => ({ name: f.name, path: f.uri.fsPath })),
            mode,
            respectGitignore: cfg.scan.respectGitignore,
            extraExcludes: cfg.scan.exclude,
            maxFileSizeBytes: cfg.scan.maxFileSizeBytes,
            maxFiles: cfg.scan.maxFiles,
            gitleaks: { enabled: cfg.gitleaks.enabled, trusted: vscode.workspace.isTrusted, path: cfg.gitleaks.path, timeoutMs: 120_000 },
            cache: this.store.cache,
            signal: abort.signal,
            onProgress: (p) => {
              this.state.scan = { ...this.state.scan!, phase: p.phase, processed: p.processed, total: p.total };
              progress.report({ message: p.total ? `${p.phase} ${p.processed}/${p.total}` : p.phase });
              this.broadcast();
            }
          })
      );
      this.state.result = result;
      this.state.history = await this.store.saveLatest(result, cfg.historyMax);
      this.publishDiagnostics(result);
      this.log(`Scan finished: ${result.findings.length} findings, ${result.coverage.filesAnalyzed} files, ${result.coverage.cacheHits} cache hits, ${result.coverage.durationMs} ms`);
      return result;
    } catch (err) {
      if (err instanceof CancelledError || abort.signal.aborted) {
        this.log('Scan cancelled');
        this.state.lastError = 'Scan cancelled.';
      } else {
        const message = err instanceof Error ? err.message : String(err);
        this.log(`Scan failed: ${err instanceof Error ? err.stack : message}`);
        this.state.lastError = `Scan failed: ${message}`;
        void vscode.window.showErrorMessage(`ProjectLens scan failed: ${message}`);
      }
      return null;
    } finally {
      this.scanAbort = null;
      this.state.scan = null;
      this.broadcast(true);
    }
  }

  cancelScan(): void {
    this.scanAbort?.abort();
  }

  private publishDiagnostics(result: ScanResult): void {
    const cfg = getConfig();
    this.diagnostics.publish(result.findings, cfg.diagnostics);
  }

  // ───────────────────────────── Navigation ─────────────────────────────

  private workspaceRoots(): string[] {
    return (vscode.workspace.workspaceFolders ?? []).filter((f) => f.uri.scheme === 'file').map((f) => f.uri.fsPath);
  }

  async openFile(msg: { uri: string; line?: number; column?: number; endLine?: number; endColumn?: number }): Promise<void> {
    const target = resolveNavigationTarget(msg, this.workspaceRoots());
    if (!target) {
      this.toast('error', 'Refused to open a file outside the workspace.');
      return;
    }
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(target.fsPath));
    const line = Math.min(target.line - 1, Math.max(0, doc.lineCount - 1));
    const start = new vscode.Position(line, Math.max(0, target.column - 1));
    const endLine = Math.min((target.endLine ?? target.line) - 1, doc.lineCount - 1);
    const end = target.endLine && target.endColumn ? new vscode.Position(endLine, target.endColumn - 1) : doc.lineAt(line).range.end;
    const editor = await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.One, selection: new vscode.Range(start, end) });
    editor.revealRange(new vscode.Range(start, end), vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }

  private async readWorkspaceFile(uri: string): Promise<string | null> {
    const target = resolveNavigationTarget({ uri }, this.workspaceRoots());
    if (!target) {
      return null;
    }
    try {
      const fileUri = vscode.Uri.file(target.fsPath);
      const stat = await vscode.workspace.fs.stat(fileUri);
      if (stat.size > MAX_AI_FILE_BYTES) {
        return null;
      }
      return Buffer.from(await vscode.workspace.fs.readFile(fileUri)).toString('utf8');
    } catch {
      return null;
    }
  }

  // ───────────────────────────── AI ─────────────────────────────

  private async askConsent(preview: ConsentPreview): Promise<boolean> {
    if (this.sessionConsent) {
      return true;
    }
    const excluded = preview.excluded.length ? ` Excluded: ${preview.excluded.slice(0, 6).map((e) => `${e.path} (${e.reason})`).join(', ')}${preview.excluded.length > 6 ? '…' : ''}.` : '';
    const detail =
      `${preview.requests} request(s) to ${preview.provider}, model ${preview.model}.\n` +
      `Context: local analysis summary + ${preview.files.length} file excerpt(s), ~${preview.estimatedTokens.toLocaleString('en-US')} tokens, ${preview.redactions} secret redaction(s).\n` +
      `Files: ${preview.files.slice(0, 8).map((f) => `${f.path}:${f.lines}`).join(', ') || 'none (summary only)'}${preview.files.length > 8 ? '…' : ''}.${excluded}\n\n` +
      `Nothing is uploaded until you choose Send. ${preview.provider} processes the data according to its own terms.`;
    for (;;) {
      const choice = await vscode.window.showWarningMessage(`Send redacted context to ${preview.provider} for "${preview.title}"?`, { modal: true, detail }, 'Send', 'Send (don’t ask again this session)', 'Preview Payload');
      if (choice === 'Send') {
        return true;
      }
      if (choice === 'Send (don’t ask again this session)') {
        this.sessionConsent = true;
        return true;
      }
      if (choice === 'Preview Payload') {
        const doc = await vscode.workspace.openTextDocument({ content: preview.payload, language: 'markdown' });
        await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
        continue;
      }
      return false;
    }
  }

  async runAI(task: AITask, target: { findingId?: string; moduleId?: string; fileUri?: string } = {}): Promise<AIInsight | null> {
    if (this.aiAbort) {
      void vscode.window.showInformationMessage('ProjectLens: an AI request is already running.');
      return null;
    }
    const providerId = getConfig().ai.provider;
    const label = this.providerLabel(providerId);
    if (!(await this.keyStore.has(providerId))) {
      const pick = await vscode.window.showInformationMessage(
        `ProjectLens AI features need an API key for the selected provider (${label}). Local analysis works without it.`,
        `Set ${label} API Key`,
        'Choose Another Provider'
      );
      if (pick === 'Choose Another Provider') {
        await this.selectProvider();
      } else if (pick) {
        await this.setApiKey(providerId);
      }
      if (!(await this.keyStore.has(getConfig().ai.provider))) {
        return null;
      }
    }
    let scan = this.state.result;
    if (!scan) {
      scan = await this.runScan(task === 'reviewFile' ? 'quick' : 'full');
      if (!scan) {
        return null;
      }
    }
    let filePath: string | undefined;
    if (target.fileUri) {
      const t = resolveNavigationTarget({ uri: target.fileUri }, this.workspaceRoots());
      if (!t) {
        this.toast('error', 'File is outside the workspace.');
        return null;
      }
      filePath = vscode.workspace.asRelativePath(vscode.Uri.file(t.fsPath), (vscode.workspace.workspaceFolders?.length ?? 0) > 1);
    }
    const abort = new AbortController();
    this.aiAbort = abort;
    this.state.ai.running = { task, title: AI_TASK_LABELS[task], startedAt: new Date().toISOString() };
    this.state.ai.lastError = null;
    this.broadcast(true);
    try {
      const insight = await this.ai.run({ task, scan, findingId: target.findingId, moduleId: target.moduleId, fileUri: target.fileUri, filePath }, abort.signal);
      this.state.ai.sessionUsage.requests = this.ai.sessionRequests;
      this.state.ai.insights = await this.store.addInsight(insight);
      this.state.ai.connection = { status: 'ok', message: `Last request succeeded (${this.providerLabel()} · ${insight.model})`, checkedAt: new Date().toISOString() };
      this.log(`AI ${task} completed (${insight.requests} request(s), ${insight.usage?.totalTokens ?? '?'} tokens, mode ${insight.outputMode})`);
      for (const s of this.sinks) {
        void s.postMessage({ type: 'navigate', tab: 'ai' });
      }
      return insight;
    } catch (err) {
      const message = describeAIError(err, this.providerLabel());
      this.state.ai.sessionUsage.requests = this.ai.sessionRequests;
      if (err instanceof AIError && (err.kind === 'consent-declined' || err.kind === 'cancelled')) {
        this.log(message);
      } else {
        this.state.ai.lastError = message;
        this.log(`AI ${task} failed: ${message}`);
        if (err instanceof AIError && (err.kind === 'auth' || err.kind === 'forbidden')) {
          this.state.ai.connection = { status: 'error', message, checkedAt: new Date().toISOString() };
        }
        const retry = err instanceof AIError && err.retryable ? 'Retry' : undefined;
        void vscode.window.showErrorMessage(`ProjectLens AI: ${message}`, ...(retry ? [retry] : [])).then((choice) => {
          if (choice === 'Retry') {
            void this.runAI(task, target);
          }
        });
      }
      return null;
    } finally {
      this.aiAbort = null;
      this.state.ai.running = null;
      this.broadcast(true);
    }
  }

  private providerLabel(id: AIProviderId = getConfig().ai.provider): string {
    return AI_PROVIDERS[id].label;
  }

  /** Provider implementations are cached per id; each reads its key from SecretStorage per request. */
  private providerFor(id: AIProviderId): AIProvider {
    let p = this.providers.get(id);
    if (!p) {
      p = createProvider(id, {
        getApiKey: () => this.keyStore.get(id),
        timeoutMs: () => getConfig().ai.requestTimeoutMs,
        maxRetries: () => getConfig().ai.maxRetries,
        onRetry: (attempt, delay, err) => this.log(`${AI_PROVIDERS[id].label} request retry ${attempt} in ${delay} ms (${err.kind}${err.status ? ` ${err.status}` : ''})`)
      });
      this.providers.set(id, p);
    }
    return p;
  }

  private activeProvider(): AIProvider {
    return this.providerFor(getConfig().ai.provider);
  }

  /** Recomputes provider/key/model state for the webviews (keys themselves never leave SecretStorage). */
  private async refreshAiState(): Promise<void> {
    const cfg = getConfig();
    const changedProvider = this.state.ai.provider !== cfg.ai.provider;
    const changedModel = this.state.ai.model !== cfg.ai.model;
    this.state.ai.provider = cfg.ai.provider;
    this.state.ai.model = cfg.ai.model;
    this.state.ai.providers = await Promise.all(
      AI_PROVIDER_IDS.map(async (id) => ({ id, label: AI_PROVIDERS[id].label, hasApiKey: await this.keyStore.has(id), model: modelFor(id) }))
    );
    this.state.ai.hasApiKey = this.state.ai.providers.find((p) => p.id === cfg.ai.provider)?.hasApiKey ?? false;
    if (changedProvider) {
      this.state.ai.availableModels = [];
      this.state.ai.rateLimit = undefined;
    }
    if (changedProvider || changedModel) {
      this.state.ai.connection = { status: 'unknown', message: this.state.ai.hasApiKey ? 'Not tested' : 'No key configured' };
    }
  }

  private async pickProvider(title: string, ids: readonly AIProviderId[] = AI_PROVIDER_IDS): Promise<AIProviderId | undefined> {
    const active = getConfig().ai.provider;
    const items = await Promise.all(
      [...ids]
        .sort((a, b) => (a === active ? -1 : b === active ? 1 : 0))
        .map(async (id) => ({
          label: AI_PROVIDERS[id].label,
          description: [id === active ? 'active' : '', (await this.keyStore.has(id)) ? 'key stored' : 'no key'].filter(Boolean).join(' · '),
          detail: `Default model: ${AI_PROVIDERS[id].defaultModel}`,
          id
        }))
    );
    return (await vscode.window.showQuickPick(items, { title, placeHolder: 'Choose an AI provider' }))?.id;
  }

  async selectProvider(id?: AIProviderId): Promise<void> {
    const provider = id ?? (await this.pickProvider('ProjectLens: Select AI Provider'));
    if (!provider) {
      return;
    }
    await vscode.workspace.getConfiguration('projectlens').update('ai.provider', provider, vscode.ConfigurationTarget.Global);
    await this.refreshAiState();
    this.broadcast(true);
    if (!(await this.keyStore.has(provider))) {
      const set = await vscode.window.showInformationMessage(`${AI_PROVIDERS[provider].label} selected. Add its API key to use AI features.`, 'Set API Key');
      if (set) {
        await this.setApiKey(provider);
      }
    }
  }

  async setApiKey(id?: AIProviderId): Promise<void> {
    const provider = id ?? (await this.pickProvider('ProjectLens: Set AI API Key'));
    if (!provider) {
      return;
    }
    const info = AI_PROVIDERS[provider];
    const value = await vscode.window.showInputBox({
      title: `ProjectLens: ${info.label} API Key`,
      prompt: `Stored securely in VS Code SecretStorage. Never written to settings or sent anywhere except ${info.label}'s API. Get a key at ${info.keyUrl}`,
      password: true,
      ignoreFocusOut: true,
      placeHolder: `${info.keyPrefix}…`,
      validateInput: (v) => (!v.trim() ? 'Enter a key' : /\s/.test(v.trim()) ? 'The key must not contain spaces' : undefined)
    });
    if (!value) {
      return;
    }
    if (!value.trim().startsWith(info.keyPrefix)) {
      const ok = await vscode.window.showWarningMessage(`${info.label} API keys usually start with "${info.keyPrefix}". Save anyway?`, { modal: true }, 'Save');
      if (ok !== 'Save') {
        return;
      }
    }
    await this.keyStore.set(provider, value);
    if (provider !== getConfig().ai.provider) {
      const use = await vscode.window.showInformationMessage(`${info.label} API key saved securely. Use ${info.label} for AI analysis now?`, `Use ${info.label}`, 'Keep current provider');
      if (use === `Use ${info.label}`) {
        await vscode.workspace.getConfiguration('projectlens').update('ai.provider', provider, vscode.ConfigurationTarget.Global);
      }
    }
    await this.refreshAiState();
    if (provider === getConfig().ai.provider) {
      this.state.ai.connection = { status: 'unknown', message: 'Key saved — not tested yet' };
    }
    this.broadcast(true);
    if (provider === getConfig().ai.provider) {
      const test = await vscode.window.showInformationMessage(`${info.label} API key saved securely.`, 'Test Connection');
      if (test) {
        await this.testConnection();
      }
    }
  }

  async removeApiKey(id?: AIProviderId): Promise<void> {
    let provider = id;
    if (!provider) {
      const withKeys: AIProviderId[] = [];
      for (const p of AI_PROVIDER_IDS) {
        if (await this.keyStore.has(p)) {
          withKeys.push(p);
        }
      }
      if (!withKeys.length) {
        void vscode.window.showInformationMessage('No AI API keys are stored.');
        return;
      }
      provider = withKeys.length === 1 ? withKeys[0] : await this.pickProvider('ProjectLens: Remove AI API Key', withKeys);
    }
    if (!provider) {
      return;
    }
    const label = AI_PROVIDERS[provider].label;
    const ok = await vscode.window.showWarningMessage(`Remove the stored ${label} API key?`, { modal: true }, 'Remove');
    if (ok !== 'Remove') {
      return;
    }
    await this.keyStore.remove(provider);
    await this.refreshAiState();
    if (provider === getConfig().ai.provider) {
      this.state.ai.availableModels = [];
      this.state.ai.connection = { status: 'unknown', message: 'No key configured' };
    }
    this.broadcast(true);
    void vscode.window.showInformationMessage(`${label} API key removed.`);
  }

  async testConnection(): Promise<void> {
    const { provider: id, model } = getConfig().ai;
    const label = this.providerLabel(id);
    if (!(await this.keyStore.has(id))) {
      void vscode.window.showWarningMessage(`No ${label} API key configured.`, 'Set API Key').then((c) => c && this.setApiKey(id));
      return;
    }
    this.state.ai.connection = { status: 'unknown', message: 'Testing…' };
    this.broadcast(true);
    const provider = this.providerFor(id);
    try {
      const res = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Testing ${label} connection…` }, () => provider.testConnection(model));
      this.state.ai.availableModels = await provider.listModels().catch(() => this.state.ai.availableModels);
      this.state.ai.connection = { status: res.modelAvailable ? 'ok' : 'error', message: res.message, checkedAt: new Date().toISOString() };
      if (res.modelAvailable) {
        void vscode.window.showInformationMessage(res.message);
      } else {
        void vscode.window.showWarningMessage(res.message, 'Select Model').then((c) => c && this.listModels(true));
      }
    } catch (err) {
      const message = describeAIError(err, label);
      this.state.ai.connection = { status: 'error', message, checkedAt: new Date().toISOString() };
      void vscode.window.showErrorMessage(`${label} connection failed: ${message}`);
    }
    this.broadcast(true);
  }

  async listModels(pick: boolean): Promise<void> {
    const id = getConfig().ai.provider;
    const label = this.providerLabel(id);
    if (!(await this.keyStore.has(id))) {
      void vscode.window.showWarningMessage(`Set a ${label} API key to list available models.`, 'Set API Key').then((c) => c && this.setApiKey(id));
      return;
    }
    try {
      const models = await this.providerFor(id).listModels();
      this.state.ai.availableModels = models;
      this.broadcast(true);
      if (pick) {
        const current = getConfig().ai.model;
        const choice = await vscode.window.showQuickPick(
          models.map((m) => ({ label: m, description: m === current ? 'current' : undefined })),
          { title: `Select ${label} model`, placeHolder: current }
        );
        if (choice) {
          await this.setModel(choice.label);
        }
      }
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not list ${label} models: ${describeAIError(err, label)}`);
    }
  }

  private async setModel(model: string): Promise<void> {
    const id = getConfig().ai.provider;
    await vscode.workspace.getConfiguration('projectlens').update(modelSettingKey(id), model, vscode.ConfigurationTarget.Global);
    await this.refreshAiState();
    this.broadcast(true);
  }

  // ───────────────────────────── Reports & storage ─────────────────────────────

  async exportReport(format: 'json' | 'markdown'): Promise<void> {
    const result = this.state.result;
    if (!result) {
      void vscode.window.showWarningMessage('Run a scan before exporting a report.');
      return;
    }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
    const date = result.finishedAt.slice(0, 10);
    const name = `projectlens-report-${date}.${format === 'json' ? 'json' : 'md'}`;
    const target = await vscode.window.showSaveDialog({
      defaultUri: folder ? vscode.Uri.joinPath(folder, name) : undefined,
      filters: format === 'json' ? { JSON: ['json'] } : { Markdown: ['md'] },
      saveLabel: 'Export Report'
    });
    if (!target) {
      return;
    }
    const content = format === 'json' ? buildJsonReport(result, this.state.ai.insights) : buildMarkdownReport(result, this.state.ai.insights);
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
    const open = await vscode.window.showInformationMessage(`Report exported to ${path.basename(target.fsPath)}.`, 'Open');
    if (open) {
      await vscode.window.showTextDocument(target);
    }
  }

  async clearHistory(): Promise<void> {
    const ok = await vscode.window.showWarningMessage('Clear ProjectLens scan history, cached analysis and AI insights for this workspace?', { modal: true }, 'Clear');
    if (ok !== 'Clear') {
      return;
    }
    await this.store.clearAll();
    this.state.history = [];
    this.state.result = null;
    this.state.ai.insights = [];
    this.diagnostics.clear();
    this.broadcast(true);
  }

  async createRequirementsFile(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      return;
    }
    const uri = vscode.Uri.joinPath(folder.uri, REQUIREMENTS_FILE);
    try {
      await vscode.workspace.fs.stat(uri);
    } catch {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(REQUIREMENTS_TEMPLATE, null, 2) + '\n', 'utf8'));
    }
    await vscode.window.showTextDocument(uri);
  }

  async reviewActiveFile(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.scheme !== 'file') {
      void vscode.window.showWarningMessage('Open a workspace file to review it with AI.');
      return;
    }
    if (!this.workspaceRoots().some((r) => isInside(r, editor.document.uri.fsPath))) {
      void vscode.window.showWarningMessage('Only files inside the workspace can be reviewed.');
      return;
    }
    await this.runAI('reviewFile', { fileUri: editor.document.uri.toString() });
  }

  get hasResult(): boolean {
    return !!this.state.result;
  }

  dispose(): void {
    this.scanAbort?.abort();
    this.aiAbort?.abort();
    this.diagnostics.dispose();
    this.output.dispose();
  }
}
