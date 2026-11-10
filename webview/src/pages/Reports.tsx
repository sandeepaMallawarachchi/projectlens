import { FileJson, FileText, Trash2, History } from 'lucide-react';
import type { ScanHistoryEntry, ScanResult } from '../../../src/models/types';
import { Button, EmptyState, KeyValue, Section } from '../components/ui';
import { post } from '../vscode';
import { dateTime, duration } from '../format';

function Sparkline({ values, label }: { values: (number | null)[]; label: string }) {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null);
  if (pts.length < 2) {
    return <span className="muted small">—</span>;
  }
  const w = 90;
  const h = 22;
  const max = Math.max(1, values.length - 1);
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${((i / max) * w).toFixed(1)},${(h - (v / 100) * h).toFixed(1)}`).join(' ');
  return (
    <svg width={w} height={h} className="sparkline" role="img" aria-label={`${label} trend`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function Reports({ result, history }: { result: ScanResult | null; history: ScanHistoryEntry[] }) {
  const chronological = [...history].reverse();
  return (
    <div className="page">
      <Section title="Export" subtitle="Reports contain redacted evidence only, plus scan timestamp, scope, coverage and warnings.">
        <div className="export-row">
          <Button variant="primary" icon={<FileText size={14} />} disabled={!result} onClick={() => post({ type: 'export', format: 'markdown' })}>
            Export Markdown
          </Button>
          <Button icon={<FileJson size={14} />} disabled={!result} onClick={() => post({ type: 'export', format: 'json' })}>
            Export JSON
          </Button>
        </div>
        {result && (
          <KeyValue
            items={[
              ['Scan', `${result.mode === 'full' ? 'Full' : 'Quick'} · ${dateTime(result.finishedAt)} · ${duration(result.coverage.durationMs)}`],
              ['Scope', result.roots.map((r) => r.name).join(', ')],
              ['Coverage', `${result.coverage.filesAnalyzed}/${result.coverage.filesDiscovered} files · ${result.coverage.linesAnalyzed.toLocaleString()} lines`],
              ['Findings', `${result.findings.length}${result.findingsTruncated ? ' (truncated)' : ''}`],
              ['Warnings', result.warnings.length ? result.warnings.join(' · ') : 'None']
            ]}
          />
        )}
      </Section>

      <Section
        title="Scan history"
        subtitle="Summaries are stored locally in this workspace."
        actions={
          history.length > 0 && (
            <Button variant="ghost" icon={<Trash2 size={13} />} onClick={() => post({ type: 'clearHistory' })}>
              Clear history
            </Button>
          )
        }
      >
        {history.length === 0 ? (
          <EmptyState icon={<History size={28} />} title="No scan history">Completed scans appear here.</EmptyState>
        ) : (
          <>
            <div className="trend-row">
              {(['security', 'quality', 'implementation', 'readiness'] as const).map((k) => (
                <div key={k} className="trend">
                  <span className="small muted">{k}</span>
                  <Sparkline values={chronological.map((h) => h.scores[k])} label={k} />
                </div>
              ))}
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Finished</th>
                  <th>Mode</th>
                  <th className="num">Files</th>
                  <th className="num">Crit</th>
                  <th className="num">High</th>
                  <th className="num">Med</th>
                  <th className="num">Security</th>
                  <th className="num">Quality</th>
                  <th className="num">Impl.</th>
                  <th className="num">Ready</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="small">{dateTime(h.finishedAt)}</td>
                    <td className="small">{h.mode}</td>
                    <td className="num">{h.filesAnalyzed}</td>
                    <td className="num">{h.findingCounts.critical}</td>
                    <td className="num">{h.findingCounts.high}</td>
                    <td className="num">{h.findingCounts.medium}</td>
                    <td className="num">{h.scores.security ?? '—'}</td>
                    <td className="num">{h.scores.quality ?? '—'}</td>
                    <td className="num">{h.scores.implementation ?? '—'}</td>
                    <td className="num">{h.scores.readiness ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>
    </div>
  );
}
