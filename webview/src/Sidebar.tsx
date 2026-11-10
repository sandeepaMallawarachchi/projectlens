import { Activity, LayoutDashboard, Play, Settings, ShieldAlert, Sparkles, Square, Zap, Code2, Boxes, ShieldOff } from 'lucide-react';
import { useHostState } from './hooks/useHostState';
import { post } from './vscode';
import { Button, Meter, Skeleton } from './components/ui';
import { relativeTime } from './format';

export function Sidebar() {
  const { state } = useHostState();
  if (!state) {
    return (
      <div className="sidebar">
        <Skeleton lines={5} />
      </div>
    );
  }
  const r = state.result;
  const scan = state.scan;
  const real = r?.findings.filter((f) => !f.tags?.includes('test-or-fixture')) ?? [];
  const security = real.filter((f) => f.category === 'security' || f.category === 'dependency');
  const quality = real.filter((f) => f.category === 'quality' || f.category === 'configuration');
  const critical = security.filter((f) => f.severity === 'critical').length;
  const progress = r ? r.progress.requirements?.weightedCompletion ?? r.progress.implementationEvidence : null;
  const scores = r ? [r.scores.security, r.scores.quality, r.scores.implementation, r.scores.readiness] : [];
  const tabFor: Record<string, string> = { security: 'security', quality: 'quality', implementation: 'progress', readiness: 'overview' };

  if (!state.workspace) {
    return (
      <div className="sidebar">
        <p className="muted">Open a folder to analyze it with ProjectLens.</p>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <header className="sb-header">
        <div className="sb-title">{r?.projectName ?? state.workspace.name}</div>
        <div className="sb-sub small muted">{r?.technology.primaryFramework ?? (r ? 'Framework not detected' : 'Not scanned yet')}</div>
      </header>

      {!state.workspace.trusted && (
        <div className="sb-note small">
          <ShieldOff size={12} aria-hidden /> Restricted mode: external scanners disabled.
        </div>
      )}

      <div className="sb-status small">
        {scan ? (
          <>
            <span className="pulse" aria-hidden /> {scan.phase}
            {scan.total > 0 && ` · ${scan.processed}/${scan.total}`}
          </>
        ) : r ? (
          <>
            <Activity size={12} aria-hidden /> Last {r.mode} scan {relativeTime(r.finishedAt)}
          </>
        ) : (
          <>Idle</>
        )}
      </div>
      {scan && scan.total > 0 && (
        <div className="progress-line">
          <div style={{ width: `${(scan.processed / scan.total) * 100}%` }} />
        </div>
      )}

      <div className="sb-actions">
        {scan ? (
          <Button icon={<Square size={12} />} onClick={() => post({ type: 'cancelScan' })}>
            Cancel scan
          </Button>
        ) : (
          <>
            <Button icon={<Zap size={13} />} onClick={() => post({ type: 'scan', mode: 'quick' })}>
              Quick Scan
            </Button>
            <Button variant="primary" icon={<Play size={13} />} onClick={() => post({ type: 'scan', mode: 'full' })}>
              Full Scan
            </Button>
          </>
        )}
        <Button icon={<Sparkles size={13} />} loading={!!state.ai.running} disabled={!!state.ai.running} onClick={() => post({ type: 'aiRun', task: 'projectAssessment' })} title={state.ai.hasApiKey ? `AI assessment (${state.ai.providers.find((p) => p.id === state.ai.provider)?.label ?? state.ai.provider})` : 'Requires an API key for the selected AI provider'}>
          AI Deep Review
        </Button>
      </div>

      {state.lastError && <div className="sb-note small">{state.lastError}</div>}

      {r && (
        <>
          <div className="sb-section-title small">Health</div>
          <div className="sb-scores">
            {scores.map((s) => (
              <button key={s.id} className="sb-score" onClick={() => post({ type: 'openDashboard', tab: tabFor[s.id] })} title={s.verdict}>
                <span className="sb-score-label">{s.label}</span>
                <span className="sb-score-value num">{s.score ?? '—'}</span>
                <Meter value={s.score} />
              </button>
            ))}
          </div>
          <div className="sb-counts">
            <button onClick={() => post({ type: 'openDashboard', tab: 'security' })} className={critical ? 'bad' : ''}>
              <ShieldAlert size={13} aria-hidden />
              <span className="num">{security.length}</span> security{critical ? ` · ${critical} critical` : ''}
            </button>
            <button onClick={() => post({ type: 'openDashboard', tab: 'quality' })}>
              <Code2 size={13} aria-hidden />
              <span className="num">{quality.length}</span> quality
            </button>
            <button onClick={() => post({ type: 'openDashboard', tab: 'progress' })}>
              <Boxes size={13} aria-hidden />
              <span className="num">{progress === null ? '—' : `${progress}%`}</span> {r.progress.requirements ? 'requirements' : 'implementation evidence'}
            </button>
          </div>
        </>
      )}

      <div className="sb-footer">
        <Button variant="primary" icon={<LayoutDashboard size={13} />} onClick={() => post({ type: 'openDashboard' })}>
          Open Dashboard
        </Button>
        <Button variant="ghost" icon={<Settings size={13} />} onClick={() => post({ type: 'openSettings' })}>
          Settings
        </Button>
      </div>
    </div>
  );
}
