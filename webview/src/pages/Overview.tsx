import { useState } from 'react';
import { AlertOctagon, ChevronDown, ChevronRight, Info, ListChecks, ShieldAlert } from 'lucide-react';
import type { ScanResult, ScoreAssessment } from '../../../src/models/types';
import { Callout, KeyValue, Meter, Section, Tag } from '../components/ui';
import { ScoreBreakdown } from '../components/ScoreBreakdown';
import { dateTime, duration, plural, scoreTone } from '../format';
import type { FindingFocus } from '../components/FindingsView';

function ScoreCard({ a, active, onToggle }: { a: ScoreAssessment; active: boolean; onToggle: () => void }) {
  const tone = scoreTone(a.score);
  return (
    <button className={`score-card tone-${tone} ${active ? 'active' : ''}`} onClick={onToggle} aria-expanded={active}>
      <div className="score-card-label">{a.label}</div>
      <div className="score-card-value">
        {a.score === null ? <span className="na">Not assessed</span> : <><span className="big">{a.score}</span><span className="muted">/100</span></>}
        {a.score !== null && <span className={`grade grade-${tone}`}>{a.grade}</span>}
      </div>
      <Meter value={a.score} />
      <div className="score-card-verdict small">{a.verdict}</div>
      {a.caps.length > 0 && (
        <div className="score-card-cap small">
          <AlertOctagon size={12} aria-hidden /> capped
        </div>
      )}
      <span className="score-card-why small muted">
        {active ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Why this score?
      </span>
    </button>
  );
}

function projectSummary(r: ScanResult): string {
  const langs = r.technology.languages.filter((l) => l.lines > 0).slice(0, 3).map((l) => l.language);
  const used = r.technology.technologies.filter((t) => t.usage !== 'declared');
  const db = used.filter((t) => t.category === 'database' || t.category === 'orm').map((t) => t.name);
  const auth = used.filter((t) => t.category === 'auth').map((t) => t.name);
  const parts = [
    `${r.technology.primaryFramework ? `${r.technology.primaryFramework} project` : 'Project'} written mainly in ${langs.join(', ') || 'unknown languages'}`,
    `${plural(r.coverage.filesAnalyzed, 'file')} and ${r.coverage.linesAnalyzed.toLocaleString()} lines analyzed`
  ];
  if (db.length) {
    parts.push(`data layer: ${db.join(', ')}`);
  }
  if (auth.length) {
    parts.push(`auth: ${auth.join(', ')}`);
  }
  parts.push(`${r.progress.modules.length} functional module(s), ${r.progress.apiEndpointCount} API endpoint(s), ${r.progress.testFileCount} test file(s) detected`);
  return parts.join(' · ') + '.';
}

export function Overview({ result, onFocus }: { result: ScanResult; onFocus: (tab: 'security' | 'quality', focus: FindingFocus) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const scores = [result.scores.quality, result.scores.security, result.scores.implementation, result.scores.readiness];
  const real = result.findings.filter((f) => !f.tags?.includes('test-or-fixture'));
  const critical = real.filter((f) => f.severity === 'critical');
  const high = real.filter((f) => f.severity === 'high');
  const securityCount = real.filter((f) => f.category === 'security' || f.category === 'dependency').length;
  const qualityCount = real.filter((f) => f.category === 'quality' || f.category === 'configuration').length;
  const progress = result.progress.requirements?.weightedCompletion ?? result.progress.implementationEvidence;
  const cov = result.coverage;
  const openScore = scores.find((s) => s.id === open);

  return (
    <div className="page">
      <Section title="Summary" subtitle={`${result.mode === 'full' ? 'Full' : 'Quick'} scan · ${dateTime(result.finishedAt)} · ${duration(cov.durationMs)}`}>
        <p className="lead">{projectSummary(result)}</p>
        {result.mode === 'quick' && (
          <Callout icon={<Info size={14} />}>Quick Scan covers manifests, technologies, secrets and environment checks. Run a Full Scan for code-quality, AST security rules, TODOs and progress evidence.</Callout>
        )}
      </Section>

      <div className="score-grid">
        {scores.map((a) => (
          <ScoreCard key={a.id} a={a} active={open === a.id} onToggle={() => setOpen(open === a.id ? null : a.id)} />
        ))}
      </div>
      {openScore && (
        <Section title={`${openScore.label} — calculation`}>
          <ScoreBreakdown assessment={openScore} />
        </Section>
      )}

      <div className="stat-row">
        <button className={`stat ${critical.length ? 'stat-bad' : ''}`} onClick={() => critical.length && onFocus('security', { ids: critical.map((f) => f.id), label: 'critical issues' })}>
          <span className="stat-value">{critical.length}</span>
          <span className="stat-label">Critical</span>
        </button>
        <button className={`stat ${high.length ? 'stat-warn' : ''}`} onClick={() => high.length && onFocus('security', { ids: high.map((f) => f.id), label: 'high-severity issues' })}>
          <span className="stat-value">{high.length}</span>
          <span className="stat-label">High</span>
        </button>
        <div className="stat">
          <span className="stat-value">{securityCount}</span>
          <span className="stat-label">Security findings</span>
        </div>
        <div className="stat">
          <span className="stat-value">{qualityCount}</span>
          <span className="stat-label">Quality findings</span>
        </div>
        <div className="stat">
          <span className="stat-value">{progress === null ? '—' : `${progress}%`}</span>
          <span className="stat-label">{result.progress.requirements ? 'Requirements done' : 'Implementation evidence'}</span>
        </div>
      </div>

      <div className="two-col">
        <Section title="Recommended actions" subtitle="Derived deterministically from findings and failed readiness checks.">
          {result.recommendedActions.length === 0 ? (
            <p className="muted">No high-priority actions were derived from the enabled checks. This does not guarantee the project is free of issues.</p>
          ) : (
            <ol className="actions">
              {result.recommendedActions.map((a, i) => (
                <li key={i}>
                  <div className="action-head">
                    <Tag tone={a.priority === 'high' ? 'bad' : a.priority === 'medium' ? 'warn' : 'neutral'}>{a.priority}</Tag>
                    <strong>{a.title}</strong>
                  </div>
                  <p className="small muted">{a.detail}</p>
                  {a.findingIds.length > 0 && (
                    <button
                      className="link small"
                      onClick={() => {
                        const first = result.findings.find((f) => f.id === a.findingIds[0]);
                        onFocus(first && (first.category === 'quality' || first.category === 'configuration') ? 'quality' : 'security', { ids: a.findingIds, label: a.title });
                      }}
                    >
                      View {a.findingIds.length} finding(s) →
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="Scan coverage & limitations">
          <KeyValue
            items={[
              ['Scope', result.roots.map((r) => r.name).join(', ')],
              ['Files', `${cov.filesAnalyzed} analyzed of ${cov.filesDiscovered} discovered${cov.cacheHits ? ` (${cov.cacheHits} from cache)` : ''}`],
              ['JS/TS parsed', `${cov.sourceFilesParsed} files`],
              ['Analyzers', cov.analyzersRun.join(', ')],
              ...(cov.analyzersUnavailable.length ? ([['Unavailable', cov.analyzersUnavailable.map((a) => `${a.analyzer}: ${a.reason}`).join('; ')]] as [string, string][]) : []),
              ...(cov.skipped.length ? ([['Skipped', cov.skipped.map((s) => `${s.count} ${s.reason}`).join(', ')]] as [string, string][]) : [])
            ]}
          />
          {result.warnings.length > 0 && (
            <ul className="warnings small">
              {result.warnings.map((w) => (
                <li key={w}>
                  <ShieldAlert size={12} aria-hidden /> {w}
                </li>
              ))}
            </ul>
          )}
          <p className="small muted disclaimer">
            <ListChecks size={12} aria-hidden /> All results are advisory static analysis with stated confidence. No findings does not mean the application is secure or complete.
          </p>
        </Section>
      </div>
    </div>
  );
}
