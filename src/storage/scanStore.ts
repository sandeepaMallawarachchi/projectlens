import * as vscode from 'vscode';
import type { ScanHistoryEntry, ScanResult } from '../models/types';
import type { AIInsight } from '../models/ai';
import { countBySeverity } from '../core/scanner';
import { AnalysisCache } from '../core/cache';

const HISTORY_KEY = 'projectlens.history';
const INSIGHTS_KEY = 'projectlens.aiInsights';
const MAX_INSIGHTS = 30;

/**
 * Local persistence:
 * - latest scan result and the per-file analysis cache → workspace storage folder (JSON files)
 * - scan history summaries and AI insights → workspaceState
 * No raw source code is stored; findings contain redacted single-line evidence only.
 */
export class ScanStore {
  readonly cache = new AnalysisCache();
  private readonly dir: vscode.Uri;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.dir = context.storageUri ?? context.globalStorageUri;
  }

  private file(name: string): vscode.Uri {
    return vscode.Uri.joinPath(this.dir, name);
  }

  async init(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.dir);
    await this.cache.load(this.file('analysis-cache.json').fsPath);
  }

  async loadLatest(): Promise<ScanResult | null> {
    try {
      const bytes = await vscode.workspace.fs.readFile(this.file('latest-scan.json'));
      const parsed = JSON.parse(Buffer.from(bytes).toString('utf8')) as ScanResult;
      return parsed?.version === 1 ? parsed : null;
    } catch {
      return null;
    }
  }

  async saveLatest(result: ScanResult, maxHistory: number): Promise<ScanHistoryEntry[]> {
    await vscode.workspace.fs.writeFile(this.file('latest-scan.json'), Buffer.from(JSON.stringify(result), 'utf8'));
    await this.cache.save(this.file('analysis-cache.json').fsPath);
    const entry: ScanHistoryEntry = {
      id: result.id,
      mode: result.mode,
      finishedAt: result.finishedAt,
      durationMs: result.coverage.durationMs,
      filesAnalyzed: result.coverage.filesAnalyzed,
      findingCounts: countBySeverity(result.findings),
      securityCount: result.findings.filter((f) => f.category === 'security' || f.category === 'dependency').length,
      qualityCount: result.findings.filter((f) => f.category === 'quality' || f.category === 'configuration').length,
      scores: {
        quality: result.scores.quality.score,
        security: result.scores.security.score,
        implementation: result.scores.implementation.score,
        readiness: result.scores.readiness.score
      }
    };
    const history = [entry, ...this.history().filter((h) => h.id !== entry.id)].slice(0, maxHistory);
    await this.context.workspaceState.update(HISTORY_KEY, history);
    return history;
  }

  history(): ScanHistoryEntry[] {
    return this.context.workspaceState.get<ScanHistoryEntry[]>(HISTORY_KEY, []);
  }

  insights(): AIInsight[] {
    return this.context.workspaceState.get<AIInsight[]>(INSIGHTS_KEY, []);
  }

  async addInsight(insight: AIInsight): Promise<AIInsight[]> {
    const list = [insight, ...this.insights()].slice(0, MAX_INSIGHTS);
    await this.context.workspaceState.update(INSIGHTS_KEY, list);
    return list;
  }

  async deleteInsight(id: string): Promise<AIInsight[]> {
    const list = this.insights().filter((i) => i.id !== id);
    await this.context.workspaceState.update(INSIGHTS_KEY, list);
    return list;
  }

  async clearAll(): Promise<void> {
    await this.context.workspaceState.update(HISTORY_KEY, []);
    await this.context.workspaceState.update(INSIGHTS_KEY, []);
    this.cache.clear();
    for (const name of ['latest-scan.json', 'analysis-cache.json']) {
      try {
        await vscode.workspace.fs.delete(this.file(name));
      } catch {
        // already absent
      }
    }
  }
}
