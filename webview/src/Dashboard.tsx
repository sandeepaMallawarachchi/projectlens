import { useCallback, useEffect, useState } from 'react';
import { Activity, BrainCircuit, Boxes, Cloud, Code2, FileBarChart, Layers, Play, ShieldCheck, Sparkles, Square, Zap, Settings, RefreshCw } from 'lucide-react';
import { useHostState } from './hooks/useHostState';
import { post, getPersisted, setPersisted } from './vscode';
import { Button, EmptyState, Skeleton, Callout } from './components/ui';
import type { FindingFocus } from './components/FindingsView';
import { Overview } from './pages/Overview';
import { Technologies } from './pages/Technologies';
import { Progress } from './pages/Progress';
import { QualityPage, SecurityPage } from './pages/FindingsPages';
import { AIInsights } from './pages/AIInsights';
import { Reports } from './pages/Reports';
import { CloudPage } from './pages/Cloud';
import { relativeTime } from './format';

const TABS = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'technologies', label: 'Technologies', icon: Layers },
  { id: 'progress', label: 'Progress', icon: Boxes },
  { id: 'quality', label: 'Code Quality', icon: Code2 },
  { id: 'security', label: 'Security', icon: ShieldCheck },
  { id: 'ai', label: 'AI Insights', icon: BrainCircuit },
  { id: 'cloud', label: 'Cloud', icon: Cloud },
  { id: 'reports', label: 'Reports', icon: FileBarChart }
] as const;
type TabId = (typeof TABS)[number]['id'];
const isTab = (t: string): t is TabId => TABS.some((x) => x.id === t);

export function Dashboard({ initialTab }: { initialTab: string }) {
  const persisted = getPersisted<{ tab: TabId }>();
  const [tab, setTab] = useState<TabId>(isTab(initialTab) && initialTab !== 'overview' ? initialTab : persisted.tab ?? 'overview');
  const [focus, setFocus] = useState<FindingFocus | null>(null);
  const navigate = useCallback((t: string) => {
    if (isTab(t)) {
      setTab(t);
    }
  }, []);
  const { state, toasts, dismiss } = useHostState(navigate);

  useEffect(() => {
    setPersisted({ tab });
  }, [tab]);

  if (!state) {
    return (
      <div className="dashboard loading">
        <Skeleton lines={6} height={14} />
      </div>
    );
  }
  const result = state.result;
  const scanning = state.scan;
  const aiEnabled = state.ai.hasApiKey;
  const aiBusy = !!state.ai.running;

  const content = () => {
    if (tab === 'ai') {
      return <AIInsights state={state} hasResult={!!result} />;
    }
    if (tab === 'cloud') {
      return <CloudPage state={state} />;
    }
    if (tab === 'reports') {
      return <Reports result={result} history={state.history} />;
    }
    if (!result) {
      return scanning ? (
        <div className="page">
          <Skeleton lines={8} height={14} />
        </div>
      ) : (
        <EmptyState
          icon={<Activity size={32} />}
          title={state.workspace ? 'No analysis yet' : 'No folder open'}
          action={
            state.workspace && (
              <div className="row">
                <Button variant="primary" icon={<Zap size={14} />} onClick={() => post({ type: 'scan', mode: 'quick' })}>
                  Quick Scan
                </Button>
                <Button icon={<Play size={14} />} onClick={() => post({ type: 'scan', mode: 'full' })}>
                  Full Scan
                </Button>
              </div>
            )
          }
        >
          {state.workspace ? 'Run a scan to analyze technologies, code quality, security and progress. Everything runs locally.' : 'Open a folder or workspace to analyze it.'}
        </EmptyState>
      );
    }
    switch (tab) {
      case 'overview':
        return (
          <Overview
            result={result}
            onFocus={(t, f) => {
              setFocus(f);
              setTab(t);
            }}
          />
        );
      case 'technologies':
        return <Technologies result={result} />;
      case 'progress':
        return <Progress result={result} aiEnabled={aiEnabled} aiBusy={aiBusy} />;
      case 'quality':
        return <QualityPage result={result} focus={focus} onClearFocus={() => setFocus(null)} aiEnabled={aiEnabled} aiBusy={aiBusy} />;
      case 'security':
        return <SecurityPage result={result} focus={focus} onClearFocus={() => setFocus(null)} aiEnabled={aiEnabled} aiBusy={aiBusy} />;
    }
  };

  const counts = result
    ? {
        security: result.findings.filter((f) => (f.category === 'security' || f.category === 'dependency') && !f.tags?.includes('test-or-fixture')).length,
        quality: result.findings.filter((f) => (f.category === 'quality' || f.category === 'configuration') && !f.tags?.includes('test-or-fixture')).length
      }
    : null;

  return (
    <div className="dashboard">
      <nav className="nav" aria-label="Dashboard sections">
        <div className="nav-brand">
          <Sparkles size={15} aria-hidden />
          <span>ProjectLens</span>
        </div>
        {TABS.map((t) => {
          const Icon = t.icon;
          const badge = t.id === 'security' ? counts?.security : t.id === 'quality' ? counts?.quality : t.id === 'ai' ? state.ai.insights.length || undefined : undefined;
          return (
            <button key={t.id} className={`nav-item ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined} title={t.label}>
              <Icon size={15} aria-hidden />
              <span className="nav-label">{t.label}</span>
              {badge ? <span className="nav-badge">{badge}</span> : null}
            </button>
          );
        })}
        <div className="nav-spacer" />
        <button className="nav-item" onClick={() => post({ type: 'openSettings' })} title="Settings">
          <Settings size={15} aria-hidden />
          <span className="nav-label">Settings</span>
        </button>
      </nav>
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{result?.projectName ?? state.workspace?.name ?? 'ProjectLens'}</h1>
            <span className="muted small">
              {result?.technology.primaryFramework ?? (result ? 'Framework not detected' : '')}
              {result && ` · last ${result.mode} scan ${relativeTime(result.finishedAt)}`}
              {state.workspace && !state.workspace.trusted && ' · restricted mode'}
            </span>
          </div>
          <div className="topbar-actions">
            {scanning ? (
              <>
                <span className="scan-status small">
                  <span className="pulse" aria-hidden />
                  {scanning.phase}
                  {scanning.total > 0 && ` ${scanning.processed}/${scanning.total}`}
                </span>
                <Button icon={<Square size={12} />} onClick={() => post({ type: 'cancelScan' })}>
                  Cancel
                </Button>
              </>
            ) : (
              <>
                <Button icon={<Zap size={14} />} disabled={!state.workspace} onClick={() => post({ type: 'scan', mode: 'quick' })}>
                  Quick Scan
                </Button>
                <Button variant="primary" icon={<Play size={14} />} disabled={!state.workspace} onClick={() => post({ type: 'scan', mode: 'full' })}>
                  Full Scan
                </Button>
              </>
            )}
            <Button icon={<Sparkles size={14} />} disabled={aiBusy || !state.workspace} loading={aiBusy} onClick={() => post({ type: 'aiRun', task: 'projectAssessment' })} title={aiEnabled ? `AI project assessment (${state.ai.providers.find((p) => p.id === state.ai.provider)?.label ?? state.ai.provider})` : 'Requires an API key for the selected AI provider'}>
              AI Deep Review
            </Button>
            <button className="icon-btn" onClick={() => post({ type: 'refresh' })} title="Refresh" aria-label="Refresh">
              <RefreshCw size={14} />
            </button>
          </div>
        </header>
        {scanning && scanning.total > 0 && (
          <div className="progress-line" role="progressbar" aria-valuenow={scanning.processed} aria-valuemax={scanning.total}>
            <div style={{ width: `${(scanning.processed / scanning.total) * 100}%` }} />
          </div>
        )}
        {state.lastError && <Callout tone={state.lastError.includes('cancelled') ? 'info' : 'error'}>{state.lastError}</Callout>}
        <div className="content">{content()}</div>
      </main>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.level}`} onClick={() => dismiss(t.id)}>
            {t.message}
          </div>
        ))}
      </div>
    </div>
  );
}
