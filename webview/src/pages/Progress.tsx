import type { ReactNode } from 'react';
import { Fragment, useMemo, useState } from 'react';
import { Boxes, ChevronDown, ChevronRight, Database, FileCheck2, FilePlus2, Layout, Server, Sparkles, Info } from 'lucide-react';
import type { FunctionalModule, ModuleStatus, PlaceholderLocation, ScanResult } from '../../../src/models/types';
import { Button, Callout, EmptyState, FileLink, Meter, Section, Tag } from '../components/ui';
import { post } from '../vscode';

const STATUS_TONE: Record<ModuleStatus, 'good' | 'warn' | 'bad'> = { implemented: 'good', partial: 'warn', 'not-detected': 'bad' };
const STATUS_LABEL: Record<ModuleStatus, string> = { implemented: 'Implemented', partial: 'Partial', 'not-detected': 'Not detected' };

function Layers({ m }: { m: FunctionalModule }) {
  const items: [boolean, string, ReactNode][] = [
    [m.layers.ui, 'UI', <Layout size={13} key="ui" />],
    [m.layers.api, 'API', <Server size={13} key="api" />],
    [m.layers.data, 'Data', <Database size={13} key="data" />],
    [m.layers.tests, 'Tests', <FileCheck2 size={13} key="tests" />]
  ];
  return (
    <span className="layers">
      {items.map(([on, label, icon]) => (
        <span key={label} className={`layer ${on ? 'on' : 'off'}`} title={`${label}: ${on ? 'detected' : 'not detected'}`}>
          {icon}
          <span className="layer-label">{label}</span>
        </span>
      ))}
    </span>
  );
}

const PLACEHOLDER_LABEL: Record<PlaceholderLocation['kind'], string> = {
  'not-implemented': 'Not implemented',
  'empty-function': 'Empty function',
  'mock-data': 'Mock data',
  'status-501': 'HTTP 501',
  todo: 'TODO',
  fixme: 'FIXME',
  'placeholder-text': 'Placeholder text'
};

export function Progress({ result, aiEnabled, aiBusy }: { result: ScanResult; aiEnabled: boolean; aiBusy: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [kind, setKind] = useState<PlaceholderLocation['kind'] | 'all'>('all');
  const p = result.progress;
  const req = p.requirements;
  const placeholders = useMemo(() => p.placeholders.filter((x) => kind === 'all' || x.kind === kind), [p.placeholders, kind]);
  const kindCounts = useMemo(() => {
    const c = new Map<string, number>();
    for (const x of p.placeholders) {
      c.set(x.kind, (c.get(x.kind) ?? 0) + 1);
    }
    return c;
  }, [p.placeholders]);
  const estimate = req?.weightedCompletion ?? p.implementationEvidence;

  return (
    <div className="page">
      <Section title={req ? 'Requirements completion' : 'Implementation evidence'} subtitle={req ? `Weighted by ${req.file}: Σ(weight × completion) / Σ(weight)` : 'Estimated from code evidence — not from your project requirements.'}>
        <div className="estimate">
          <div className="estimate-value">{estimate === null ? '—' : `${estimate}%`}</div>
          <div className="estimate-body">
            <Meter value={estimate} />
            <div className="small muted">
              {p.modules.length} modules · {p.routeCount} pages · {p.apiEndpointCount} API endpoints · {p.componentCount} components · {p.testFileCount} test files
            </div>
          </div>
        </div>
        {!req && (
          <Callout icon={<Info size={14} />}>
            ProjectLens can’t know your original requirements. Define features and weights in <code>.projectlens.json</code> for a requirements-based estimate.{' '}
            <button className="link" onClick={() => post({ type: 'createRequirements' })}>
              Create .projectlens.json
            </button>
          </Callout>
        )}
        {req?.errors.length ? <Callout tone="warn">Requirements file issues: {req.errors.join('; ')}</Callout> : null}
        <details className="limitations">
          <summary className="small">Limitations of this estimate</summary>
          <ul className="small muted">
            {p.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </details>
      </Section>

      {req && (
        <Section title="Features">
          <table className="table">
            <thead>
              <tr>
                <th>Feature</th>
                <th className="num">Weight</th>
                <th>Status</th>
                <th>Completion</th>
                <th>Matched modules</th>
              </tr>
            </thead>
            <tbody>
              {req.results.map((r) => (
                <tr key={r.feature.id}>
                  <td>
                    {r.feature.name}
                    {r.feature.description && <div className="small muted">{r.feature.description}</div>}
                  </td>
                  <td className="num">{r.feature.weight}</td>
                  <td>
                    <Tag tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Tag>
                  </td>
                  <td className="bar-cell">
                    <Meter value={r.completion} />
                    <span className="num small">{r.completion}%</span>
                  </td>
                  <td className="small muted">{r.matchedModules.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section title="Functional modules" subtitle="Candidate modules inferred from routes, API handlers, models and services.">
        {p.modules.length === 0 ? (
          <EmptyState icon={<Boxes size={28} />} title="No modules detected">
            {result.mode === 'quick' ? 'Run a Full Scan to detect API handlers, models and placeholders.' : 'No routes, API handlers, models or service folders were found.'}
          </EmptyState>
        ) : (
          <table className="table modules">
            <thead>
              <tr>
                <th>Module</th>
                <th>Status</th>
                <th>Estimated completion</th>
                <th>Layers</th>
                <th className="num">Files</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {p.modules.map((m) => (
                <Fragment key={m.id}>
                  <tr className="clickable" onClick={() => setExpanded(expanded === m.id ? null : m.id)} aria-expanded={expanded === m.id}>
                    <td>
                      <span className="row-toggle">{expanded === m.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                      {m.name}
                    </td>
                    <td>
                      <Tag tone={STATUS_TONE[m.status]}>{STATUS_LABEL[m.status]}</Tag>
                    </td>
                    <td className="bar-cell">
                      <Meter value={m.completion} />
                      <span className="num small">{m.completion}%</span>
                    </td>
                    <td>
                      <Layers m={m} />
                    </td>
                    <td className="num">{m.fileCount}</td>
                    <td>
                      <Button
                        variant="ghost"
                        icon={<Sparkles size={13} />}
                        disabled={!aiEnabled || aiBusy}
                        title={aiEnabled ? 'Review this module with Groq' : 'Configure Groq on the AI Insights tab'}
                        onClick={(e) => {
                          e.stopPropagation();
                          post({ type: 'aiRun', task: 'reviewModule', moduleId: m.id });
                        }}
                      >
                        Review
                      </Button>
                    </td>
                  </tr>
                  {expanded === m.id && (
                    <tr className="expand-row">
                      <td colSpan={6}>
                        <div className="module-detail">
                          <div>
                            <h4>Assessment</h4>
                            <ul className="small">
                              {m.reasons.map((r) => (
                                <li key={r}>{r}</li>
                              ))}
                            </ul>
                          </div>
                          <div>
                            <h4>Evidence</h4>
                            <ul className="evidence-list">
                              {m.evidence.slice(0, 40).map((e, i) => (
                                <li key={i}>
                                  <Tag tone={e.kind === 'missing-endpoint' || e.kind === 'placeholder' || e.kind === 'mock-data' ? 'warn' : 'neutral'}>{e.kind}</Tag> <span className="small">{e.detail}</span> <FileLink file={e.file} uri={e.uri} line={e.line} compact />
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section
        title={`Unfinished work (${p.placeholders.length})`}
        subtitle="TODO/FIXME markers, placeholder functions, mock data and 501 responses."
        actions={
          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} aria-label="Filter unfinished work">
            <option value="all">All kinds</option>
            {[...kindCounts.entries()].map(([k, n]) => (
              <option key={k} value={k}>
                {PLACEHOLDER_LABEL[k as PlaceholderLocation['kind']]} ({n})
              </option>
            ))}
          </select>
        }
      >
        {placeholders.length === 0 ? (
          <p className="muted">{result.mode === 'quick' ? 'Run a Full Scan to collect TODOs and placeholders.' : 'No unfinished-work markers found.'}</p>
        ) : (
          <ul className="placeholder-list">
            {placeholders.slice(0, 300).map((x, i) => (
              <li key={i}>
                <Tag tone={x.kind === 'todo' ? 'neutral' : 'warn'}>{PLACEHOLDER_LABEL[x.kind]}</Tag>
                <span className="small placeholder-detail">{x.detail}</span>
                <FileLink file={x.file} uri={x.uri} line={x.line} compact />
              </li>
            ))}
          </ul>
        )}
        <div className="section-footer">
          <Button icon={<FilePlus2 size={13} />} variant="ghost" disabled={!aiEnabled || aiBusy} onClick={() => post({ type: 'aiRun', task: 'incompletePatterns' })}>
            Suggest how to complete with AI
          </Button>
        </div>
      </Section>
    </div>
  );
}
