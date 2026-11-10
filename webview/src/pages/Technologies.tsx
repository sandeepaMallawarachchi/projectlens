import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Package } from 'lucide-react';
import type { ScanResult, Technology, TechnologyCategory } from '../../../src/models/types';
import { ConfidenceBadge, EmptyState, FileLink, KeyValue, Section, Tag } from '../components/ui';

const CATEGORY_LABELS: Record<TechnologyCategory, string> = {
  language: 'Languages',
  fullstack: 'Full-stack frameworks',
  frontend: 'Frontend frameworks',
  backend: 'Backend frameworks & APIs',
  database: 'Databases',
  orm: 'ORMs & query builders',
  auth: 'Authentication',
  ui: 'UI & styling',
  state: 'State & data fetching',
  validation: 'Validation',
  testing: 'Testing',
  tooling: 'Build & tooling',
  infrastructure: 'Deployment & infrastructure',
  cloud: 'Cloud & services',
  ai: 'AI'
};

const ORDER: TechnologyCategory[] = ['fullstack', 'frontend', 'backend', 'database', 'orm', 'auth', 'ui', 'state', 'validation', 'testing', 'tooling', 'infrastructure', 'cloud', 'ai'];

const LANG_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'];

function UsageTag({ t }: { t: Technology }) {
  if (t.usage === 'used') {
    return <Tag tone="good" title={`${t.importCount} import(s) found`}>used · {t.importCount} import{t.importCount === 1 ? '' : 's'}</Tag>;
  }
  if (t.usage === 'configured') {
    return <Tag tone="accent" title="Configuration or script evidence">configured</Tag>;
  }
  return <Tag tone="warn" title="Listed in package.json but no import or configuration was found">declared only</Tag>;
}

export function Technologies({ result }: { result: ScanResult }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [depQuery, setDepQuery] = useState('');
  const [showDeps, setShowDeps] = useState(false);
  const tech = result.technology;
  const grouped = useMemo(() => {
    const map = new Map<TechnologyCategory, Technology[]>();
    for (const t of tech.technologies) {
      map.set(t.category, [...(map.get(t.category) ?? []), t]);
    }
    return ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const);
  }, [tech.technologies]);
  const langs = tech.languages.filter((l) => l.lines > 0);
  const totalLines = langs.reduce((s, l) => s + l.lines, 0);
  const deps = tech.dependencies.filter((d) => !depQuery || d.name.toLowerCase().includes(depQuery.toLowerCase()));

  return (
    <div className="page">
      <Section title="Project stack">
        <KeyValue
          items={[
            ['Primary framework', tech.primaryFramework ?? 'Not detected'],
            ['Package manager', tech.packageManager ?? 'Not detected'],
            ['Manifests', tech.manifests.length ? tech.manifests.join(', ') : 'None found'],
            ['Dependencies', `${tech.dependencies.filter((d) => !d.dev).length} runtime · ${tech.dependencies.filter((d) => d.dev).length} dev`]
          ]}
        />
      </Section>

      <Section title="Languages" subtitle="By lines of analyzed text files.">
        {langs.length === 0 ? (
          <p className="muted">No source files analyzed.</p>
        ) : (
          <>
            <div className="lang-bar" role="img" aria-label="Language distribution">
              {langs.slice(0, 6).map((l, i) => (
                <div key={l.language} style={{ width: `${(l.lines / totalLines) * 100}%`, background: LANG_COLORS[i] }} title={`${l.language}: ${l.lines} lines`} />
              ))}
            </div>
            <ul className="legend">
              {langs.slice(0, 10).map((l, i) => (
                <li key={l.language}>
                  <i style={{ background: LANG_COLORS[i] ?? 'var(--border)' }} />
                  {l.language} <span className="muted small">{((l.lines / totalLines) * 100).toFixed(1)}% · {l.files} files</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {grouped.length === 0 ? (
        <EmptyState icon={<Package size={28} />} title="No technologies detected">No recognized manifests, imports or configuration files were found.</EmptyState>
      ) : (
        <Section title="Detected technologies" subtitle="Usage reflects evidence: imports in code, configuration files and scripts. Dependencies without any usage are marked “declared only”.">
          <table className="table tech">
            <thead>
              <tr>
                <th>Technology</th>
                <th>Version</th>
                <th>Usage</th>
                <th>Confidence</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {grouped.map(([cat, list]) => (
                <Fragment key={cat}>
                  <tr className="group-row">
                    <td colSpan={5}>{CATEGORY_LABELS[cat]}</td>
                  </tr>
                  {list.map((t) => (
                    <Fragment key={t.id}>
                      <tr className="clickable" onClick={() => setExpanded(expanded === t.id ? null : t.id)} aria-expanded={expanded === t.id}>
                        <td>
                          <span className="row-toggle">{expanded === t.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</span>
                          {t.name}
                        </td>
                        <td className="mono small">
                          {t.resolvedVersion ?? t.version ?? '—'}
                          {t.resolvedVersion && t.version && t.resolvedVersion !== t.version && <span className="muted"> (range {t.version})</span>}
                        </td>
                        <td>
                          <UsageTag t={t} />
                        </td>
                        <td>
                          <ConfidenceBadge confidence={t.confidence} />
                        </td>
                        <td className="muted small">{t.evidence.length} evidence</td>
                      </tr>
                      {expanded === t.id && (
                        <tr className="expand-row">
                          <td colSpan={5}>
                            <ul className="evidence-list">
                              {t.evidence.map((e, i) => (
                                <li key={i}>
                                  <Tag>{e.kind}</Tag> <span className="small">{e.detail}</span>{' '}
                                  {e.uri ? <FileLink file={e.file ?? ''} uri={e.uri} line={e.line} compact /> : e.file && <span className="muted small mono">{e.file}</span>}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section
        title={`Dependencies (${tech.dependencies.length})`}
        actions={
          <button className="link" onClick={() => setShowDeps(!showDeps)}>
            {showDeps ? 'Hide' : 'Show'}
          </button>
        }
      >
        {showDeps && (
          <>
            <input className="input" placeholder="Filter dependencies" value={depQuery} onChange={(e) => setDepQuery(e.target.value)} aria-label="Filter dependencies" />
            <table className="table">
              <thead>
                <tr>
                  <th>Package</th>
                  <th>Declared</th>
                  <th>Resolved</th>
                  <th>Type</th>
                  <th>Manifest</th>
                </tr>
              </thead>
              <tbody>
                {deps.slice(0, 400).map((d) => (
                  <tr key={`${d.manifest}:${d.name}:${d.dev}`}>
                    <td className="mono small">{d.name}</td>
                    <td className="mono small">{d.range}</td>
                    <td className="mono small">{d.resolved ?? '—'}</td>
                    <td className="small">{d.dev ? 'dev' : 'runtime'}</td>
                    <td className="small muted">{d.manifest}</td>
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
