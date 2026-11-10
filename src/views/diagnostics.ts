import * as vscode from 'vscode';
import type { Finding, Severity } from '../models/types';
import { SEVERITY_RANK } from '../models/types';

const MAX_DIAGNOSTICS = 1500;

/**
 * Publishes deterministic findings to the Problems panel. Recommendations, low-confidence
 * items and anything below the configured severity are left to the dashboard. AI output is never published.
 */
export class DiagnosticsPublisher implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('projectlens');

  publish(findings: Finding[], options: { enabled: boolean; minimumSeverity: Severity }): void {
    this.collection.clear();
    if (!options.enabled) {
      return;
    }
    const byFile = new Map<string, vscode.Diagnostic[]>();
    let total = 0;
    for (const f of findings) {
      if (total >= MAX_DIAGNOSTICS) {
        break;
      }
      if (SEVERITY_RANK[f.severity] < SEVERITY_RANK[options.minimumSeverity] || f.kind === 'recommendation' || f.confidence === 'low') {
        continue;
      }
      const line = Math.max(0, f.location.line - 1);
      const col = Math.max(0, f.location.column - 1);
      const endLine = f.location.endLine ? f.location.endLine - 1 : line;
      const endCol = f.location.endColumn ? f.location.endColumn - 1 : col + 200;
      const range = new vscode.Range(line, col, endLine, endCol);
      const message = `${f.title}${f.status === 'needs-review' ? ' (needs review)' : ''}: ${f.description}`;
      const d = new vscode.Diagnostic(range, message, toSeverity(f.severity));
      d.source = 'ProjectLens';
      d.code = f.ruleId;
      const list = byFile.get(f.location.uri) ?? [];
      list.push(d);
      byFile.set(f.location.uri, list);
      total++;
    }
    for (const [uri, list] of byFile) {
      this.collection.set(vscode.Uri.parse(uri), list);
    }
  }

  clear(): void {
    this.collection.clear();
  }

  dispose(): void {
    this.collection.dispose();
  }
}

function toSeverity(s: Severity): vscode.DiagnosticSeverity {
  switch (s) {
    case 'critical':
    case 'high':
      return vscode.DiagnosticSeverity.Error;
    case 'medium':
      return vscode.DiagnosticSeverity.Warning;
    case 'low':
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}
