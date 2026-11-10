import { useMemo, useState } from 'react';
import { ArrowUpRight, Filter, Search, Sparkles, X, FileSearch } from 'lucide-react';
import type { Confidence, Finding, Severity } from '../../../src/models/types';
import { SEVERITY_RANK, CONFIDENCE_RANK } from '../../../src/models/types';
import { Button, ConfidenceBadge, EmptyState, FileLink, SeverityBadge, StatusPill, Tag } from './ui';
import { post, openFile } from '../vscode';
import { SEVERITY_ORDER } from '../format';

type SortKey = 'severity' | 'file' | 'confidence' | 'rule';

export interface FindingFocus {
  ids: string[];
  label: string;
}

const PAGE = 150;

export function FindingsView({
  findings,
  focus,
  onClearFocus,
  aiEnabled,
  aiBusy,
  emptyTitle,
  emptyText
}: {
  findings: Finding[];
  focus?: FindingFocus | null;
  onClearFocus?: () => void;
  aiEnabled: boolean;
  aiBusy: boolean;
  emptyTitle: string;
  emptyText: string;
}) {
  const [severities, setSeverities] = useState<Set<Severity>>(new Set());
  const [confidence, setConfidence] = useState<Confidence | 'any'>('any');
  const [analyzer, setAnalyzer] = useState('any');
  const [category, setCategory] = useState('any');
  const [status, setStatus] = useState<'any' | 'confirmed' | 'needs-review'>('any');
  const [query, setQuery] = useState('');
  const [fileFilter, setFileFilter] = useState('');
  const [sort, setSort] = useState<SortKey>('severity');
  const [hideFixtures, setHideFixtures] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  const analyzers = useMemo(() => [...new Set(findings.map((f) => f.analyzer))].sort(), [findings]);
  const categories = useMemo(() => [...new Set(findings.map((f) => f.category))].sort(), [findings]);
  const fixtureCount = useMemo(() => findings.filter((f) => f.tags?.includes('test-or-fixture')).length, [findings]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const file = fileFilter.trim().toLowerCase();
    const focusIds = focus ? new Set(focus.ids) : null;
    const list = findings.filter(
      (f) =>
        (!focusIds || focusIds.has(f.id)) &&
        (severities.size === 0 || severities.has(f.severity)) &&
        (confidence === 'any' || CONFIDENCE_RANK[f.confidence] >= CONFIDENCE_RANK[confidence]) &&
        (analyzer === 'any' || f.analyzer === analyzer) &&
        (category === 'any' || f.category === category) &&
        (status === 'any' || f.status === status) &&
        (!hideFixtures || focusIds || !f.tags?.includes('test-or-fixture')) &&
        (!file || f.location.file.toLowerCase().includes(file)) &&
        (!q || `${f.title} ${f.ruleId} ${f.description} ${f.evidence}`.toLowerCase().includes(q))
    );
    const cmp: Record<SortKey, (a: Finding, b: Finding) => number> = {
      severity: (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || a.location.file.localeCompare(b.location.file),
      file: (a, b) => a.location.file.localeCompare(b.location.file) || a.location.line - b.location.line,
      confidence: (a, b) => CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
      rule: (a, b) => a.ruleId.localeCompare(b.ruleId) || a.location.file.localeCompare(b.location.file)
    };
    return [...list].sort(cmp[sort]);
  }, [findings, focus, severities, confidence, analyzer, category, status, hideFixtures, fileFilter, query, sort]);

  const counts = useMemo(() => {
    const c: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
    for (const f of findings) {
      if (!hideFixtures || !f.tags?.includes('test-or-fixture')) {
        c[f.severity]++;
      }
    }
    return c;
  }, [findings, hideFixtures]);

  const selected = filtered.find((f) => f.id === selectedId) ?? null;
  const toggleSeverity = (s: Severity) =>
    setSeverities((prev) => {
      const next = new Set(prev);
      if (next.has(s)) {
        next.delete(s);
      } else {
        next.add(s);
      }
      return next;
    });
  const resetFilters = () => {
    setSeverities(new Set());
    setConfidence('any');
    setAnalyzer('any');
    setCategory('any');
    setStatus('any');
    setQuery('');
    setFileFilter('');
  };

  if (!findings.length) {
    return <EmptyState icon={<FileSearch size={28} />} title={emptyTitle}>{emptyText}</EmptyState>;
  }

  return (
    <div className="findings">
      {focus && (
        <div className="focus-bar">
          <Filter size={13} aria-hidden /> Showing {focus.ids.length} finding(s) for <strong>{focus.label}</strong>
          <button className="link" onClick={onClearFocus}>
            Clear
          </button>
        </div>
      )}
      <div className="toolbar" role="toolbar" aria-label="Finding filters">
        <div className="chips">
          {SEVERITY_ORDER.map((s) => (
            <button key={s} className={`chip chip-${s} ${severities.has(s) ? 'active' : ''}`} onClick={() => toggleSeverity(s)} aria-pressed={severities.has(s)}>
              {s} <span className="chip-count">{counts[s]}</span>
            </button>
          ))}
        </div>
        <div className="filters">
          <label className="input-icon">
            <Search size={13} aria-hidden />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search findings" aria-label="Search findings" />
          </label>
          <input className="input" value={fileFilter} onChange={(e) => setFileFilter(e.target.value)} placeholder="Filter by file" aria-label="Filter by file" />
          <select value={confidence} onChange={(e) => setConfidence(e.target.value as Confidence | 'any')} aria-label="Minimum confidence">
            <option value="any">Any confidence</option>
            <option value="medium">≥ Medium</option>
            <option value="high">High only</option>
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="Detection status">
            <option value="any">Any status</option>
            <option value="confirmed">Confirmed</option>
            <option value="needs-review">Needs review</option>
          </select>
          {categories.length > 1 && (
            <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
              <option value="any">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <select value={analyzer} onChange={(e) => setAnalyzer(e.target.value)} aria-label="Analyzer">
            <option value="any">All analyzers</option>
            {analyzers.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="Sort">
            <option value="severity">Sort: severity</option>
            <option value="file">Sort: file</option>
            <option value="confidence">Sort: confidence</option>
            <option value="rule">Sort: rule</option>
          </select>
          {fixtureCount > 0 && (
            <label className="checkbox small">
              <input type="checkbox" checked={hideFixtures} onChange={(e) => setHideFixtures(e.target.checked)} /> Hide {fixtureCount} test/fixture
            </label>
          )}
        </div>
      </div>

      <div className={`findings-body ${selected ? 'has-detail' : ''}`}>
        <div className="findings-list" role="list">
          {filtered.length === 0 ? (
            <EmptyState title="No findings match the filters" action={<Button onClick={resetFilters}>Reset filters</Button>} />
          ) : (
            <>
              <div className="list-meta small muted">
                {filtered.length} of {findings.length} findings
              </div>
              {filtered.slice(0, limit).map((f) => (
                <div
                  key={f.id}
                  role="listitem"
                  tabIndex={0}
                  className={`finding-row ${selectedId === f.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(f.id)}
                  onDoubleClick={() => openFile(f.location.uri, f.location.line, f.location.column, f.location.endLine, f.location.endColumn)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      setSelectedId(f.id);
                    }
                  }}
                >
                  <SeverityBadge severity={f.severity} />
                  <div className="finding-main">
                    <div className="finding-title">
                      {f.title}
                      {f.kind === 'recommendation' && <Tag>advice</Tag>}
                    </div>
                    <div className="finding-meta">
                      <FileLink file={f.location.file} uri={f.location.uri} line={f.location.line} column={f.location.column} compact />
                      <span className="muted mono small">{f.ruleId}</span>
                    </div>
                  </div>
                  <div className="finding-side">
                    <ConfidenceBadge confidence={f.confidence} />
                    {f.status === 'needs-review' && <StatusPill status={f.status} />}
                  </div>
                </div>
              ))}
              {filtered.length > limit && (
                <div className="more">
                  <Button onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, filtered.length - limit)} more</Button>
                </div>
              )}
            </>
          )}
        </div>
        {selected && <FindingDetail finding={selected} onClose={() => setSelectedId(null)} aiEnabled={aiEnabled} aiBusy={aiBusy} />}
      </div>
    </div>
  );
}

export function FindingDetail({ finding: f, onClose, aiEnabled, aiBusy }: { finding: Finding; onClose: () => void; aiEnabled: boolean; aiBusy: boolean }) {
  return (
    <aside className="detail" aria-label="Finding details">
      <header className="detail-header">
        <div className="detail-badges">
          <SeverityBadge severity={f.severity} />
          <ConfidenceBadge confidence={f.confidence} />
          <StatusPill status={f.status} />
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close details">
          <X size={14} />
        </button>
      </header>
      <h3>{f.title}</h3>
      <FileLink file={f.location.file} uri={f.location.uri} line={f.location.line} column={f.location.column} endLine={f.location.endLine} endColumn={f.location.endColumn} />
      <pre className="evidence" aria-label="Evidence (redacted)">
        <span className="evidence-line mono">{f.location.line}</span>
        {f.evidence || '—'}
      </pre>
      <div className="detail-block">
        <h4>Why this was flagged</h4>
        <p>{f.description}</p>
      </div>
      {f.impact && (
        <div className="detail-block">
          <h4>Potential impact</h4>
          <p>{f.impact}</p>
        </div>
      )}
      <div className="detail-block">
        <h4>Recommendation</h4>
        <p>{f.recommendation}</p>
      </div>
      {f.status === 'needs-review' && (
        <p className="small muted">This pattern requires application context (e.g. middleware, input validation elsewhere). It is not a confirmed vulnerability.</p>
      )}
      <dl className="kv small">
        <div className="kv-row">
          <dt>Rule</dt>
          <dd className="mono">{f.ruleId}</dd>
        </div>
        <div className="kv-row">
          <dt>Analyzer</dt>
          <dd>{f.analyzer}</dd>
        </div>
        <div className="kv-row">
          <dt>Type</dt>
          <dd>{f.kind === 'rule' ? 'Rule-based violation' : 'Subjective recommendation'}</dd>
        </div>
        {f.tags?.length ? (
          <div className="kv-row">
            <dt>Tags</dt>
            <dd>{f.tags.join(', ')}</dd>
          </div>
        ) : null}
      </dl>
      <div className="detail-actions">
        <Button variant="primary" icon={<ArrowUpRight size={14} />} onClick={() => openFile(f.location.uri, f.location.line, f.location.column, f.location.endLine, f.location.endColumn)}>
          Open in editor
        </Button>
        <Button icon={<Sparkles size={14} />} disabled={!aiEnabled || aiBusy} title={aiEnabled ? 'Ask the AI provider to explain this finding' : 'Configure an AI provider key on the AI Insights tab'} onClick={() => post({ type: 'aiRun', task: 'explainFinding', findingId: f.id })}>
          Explain with AI
        </Button>
        <Button icon={<Sparkles size={14} />} disabled={!aiEnabled || aiBusy} onClick={() => post({ type: 'aiRun', task: 'reviewFile', fileUri: f.location.uri })}>
          Review file
        </Button>
      </div>
    </aside>
  );
}
