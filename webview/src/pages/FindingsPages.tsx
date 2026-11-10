import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert, Sparkles } from 'lucide-react';
import type { ScanResult } from '../../../src/models/types';
import { FindingsView, type FindingFocus } from '../components/FindingsView';
import { ScoreBreakdown } from '../components/ScoreBreakdown';
import { Button, Callout, Meter, Section } from '../components/ui';
import { post } from '../vscode';

interface Props {
  result: ScanResult;
  focus: FindingFocus | null;
  onClearFocus: () => void;
  aiEnabled: boolean;
  aiBusy: boolean;
}

function ScoreHeader({ a }: { a: ScanResult['scores']['quality'] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="score-header">
      <div className="score-header-main">
        <div className="score-header-value">{a.score === null ? '—' : a.score}</div>
        <div className="score-header-text">
          <strong>{a.label}</strong>
          <span className="muted small">{a.verdict}</span>
          <Meter value={a.score} />
        </div>
        <button className="link small" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />} How is this calculated?
        </button>
      </div>
      {open && <ScoreBreakdown assessment={a} />}
    </div>
  );
}

function RuleSummary({ findings }: { findings: ScanResult['findings'] }) {
  const rows = useMemo(() => {
    const map = new Map<string, { title: string; count: number; kind: string }>();
    for (const f of findings) {
      if (f.tags?.includes('test-or-fixture')) {
        continue;
      }
      const r = map.get(f.ruleId) ?? { title: f.title, count: 0, kind: f.kind };
      r.count++;
      map.set(f.ruleId, r);
    }
    return [...map.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12);
  }, [findings]);
  if (!rows.length) {
    return null;
  }
  const max = rows[0][1].count;
  return (
    <div className="rule-summary">
      {rows.map(([id, r]) => (
        <div key={id} className="rule-bar">
          <span className="small rule-name" title={id}>
            {r.title} {r.kind === 'recommendation' && <span className="muted">(advice)</span>}
          </span>
          <span className="rule-track">
            <span style={{ width: `${(r.count / max) * 100}%` }} />
          </span>
          <span className="num small">{r.count}</span>
        </div>
      ))}
    </div>
  );
}

export function QualityPage({ result, focus, onClearFocus, aiEnabled, aiBusy }: Props) {
  const findings = useMemo(() => result.findings.filter((f) => f.category === 'quality' || f.category === 'configuration' || (f.category === 'progress' && f.analyzer === 'markers')), [result.findings]);
  const refactor = findings.filter((f) => /complex-function|long-function|deep-nesting|duplicate-block|large-file/.test(f.ruleId) && !f.tags?.includes('test-or-fixture')).slice(0, 8);
  return (
    <div className="page">
      <ScoreHeader a={result.scores.quality} />
      {result.mode === 'quick' && <Callout>Quick Scan does not run quality analyzers. Run a Full Scan to populate this view.</Callout>}
      <div className="two-col">
        <Section title="Most frequent rules" subtitle="Rule-based violations vs. (advice) recommendations.">
          <RuleSummary findings={findings} />
        </Section>
        <Section title="Refactoring candidates">
          {refactor.length === 0 ? (
            <p className="muted small">No complexity, size or duplication hot spots above thresholds.</p>
          ) : (
            <ul className="refactor-list small">
              {refactor.map((f) => (
                <li key={f.id}>
                  <strong>{f.title}</strong> — {f.description}{' '}
                  <button className="link" onClick={() => post({ type: 'openFile', uri: f.location.uri, line: f.location.line })}>
                    {f.location.file}:{f.location.line}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
      <Section title="Code-quality findings">
        <FindingsView findings={findings} focus={focus} onClearFocus={onClearFocus} aiEnabled={aiEnabled} aiBusy={aiBusy} emptyTitle="No code-quality findings" emptyText={result.mode === 'quick' ? 'Run a Full Scan to analyze code quality.' : 'The enabled rules found no issues.'} />
      </Section>
    </div>
  );
}

export function SecurityPage({ result, focus, onClearFocus, aiEnabled, aiBusy }: Props) {
  const findings = useMemo(() => result.findings.filter((f) => f.category === 'security' || f.category === 'dependency'), [result.findings]);
  const review = findings.filter((f) => f.status === 'needs-review' && !f.tags?.includes('test-or-fixture')).length;
  return (
    <div className="page">
      <ScoreHeader a={result.scores.security} />
      <Callout icon={<ShieldAlert size={14} />}>
        Secret values are never displayed — evidence is redacted. {review > 0 && <><strong>{review}</strong> item(s) are marked “Needs review” because confirming them requires application-wide context. </>}
        A clean result does not prove the application is secure.
      </Callout>
      <Section
        title="Security findings"
        actions={
          <Button icon={<Sparkles size={13} />} variant="ghost" disabled={!aiEnabled || aiBusy} onClick={() => post({ type: 'aiRun', task: 'securityConcerns' })}>
            Explain security concerns with AI
          </Button>
        }
      >
        <FindingsView findings={findings} focus={focus} onClearFocus={onClearFocus} aiEnabled={aiEnabled} aiBusy={aiBusy} emptyTitle="No security findings" emptyText="The enabled rules found no security issues. Static analysis cannot rule out vulnerabilities." />
      </Section>
    </div>
  );
}
