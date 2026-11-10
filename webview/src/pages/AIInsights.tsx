import { useState } from 'react';
import { Bot, CheckCircle2, CircleAlert, KeyRound, Lock, RefreshCw, Sparkles, Trash2, Wifi, Square, BrainCircuit } from 'lucide-react';
import type { AIInsight, AIProviderId, AITask } from '../../../src/models/ai';
import { AI_TASK_LABELS } from '../../../src/models/ai';
import type { AppState } from '../../../src/models/messages';
import { Button, Callout, ConfidenceBadge, EmptyState, FileLink, Section, SeverityBadge, Skeleton, Tag } from '../components/ui';
import { post } from '../vscode';
import { relativeTime } from '../format';

const PROJECT_TASKS: { task: AITask; description: string }[] = [
  { task: 'projectAssessment', description: 'Readable overall assessment and plan toward production.' },
  { task: 'architectureSummary', description: 'Layers, modules, data flow and architectural risks.' },
  { task: 'improvements', description: 'Prioritized improvement plan backed by evidence.' },
  { task: 'securityConcerns', description: 'Which security findings matter most and how to mitigate.' },
  { task: 'incompletePatterns', description: 'Unfinished flows, placeholders and how to complete them.' }
];

function InsightCard({ insight }: { insight: AIInsight }) {
  const [open, setOpen] = useState(true);
  const a = insight.analysis;
  const refs = (list: { path: string; line: number }[]) =>
    list.length ? (
      <div className="refs">
        {list.map((r, i) => (insight.fileUris[r.path] ? <FileLink key={i} file={r.path} uri={insight.fileUris[r.path]} line={r.line || undefined} compact /> : <span key={i} className="mono small muted">{r.path}</span>))}
      </div>
    ) : null;
  return (
    <article className="insight">
      <header className="insight-header">
        <button className="insight-title" onClick={() => setOpen(!open)} aria-expanded={open}>
          <BrainCircuit size={14} aria-hidden />
          <strong>{insight.title}</strong>
        </button>
        <div className="insight-meta small muted">
          <SeverityBadge severity={a.overallSeverity} /> <ConfidenceBadge confidence={a.overallConfidence} /> {insight.provider ?? 'groq'} · {insight.model} · {relativeTime(insight.createdAt)} · {insight.usage?.totalTokens ?? '?'} tokens
          <button className="icon-btn" title="Delete insight" aria-label="Delete insight" onClick={() => post({ type: 'aiDeleteInsight', id: insight.id })}>
            <Trash2 size={13} />
          </button>
        </div>
      </header>
      {open && (
        <div className="insight-body">
          <p className="insight-summary">{a.summary}</p>
          {a.observations.length > 0 && (
            <>
              <h4>Observations</h4>
              <ul className="ai-list">
                {a.observations.map((o, i) => (
                  <li key={i}>
                    <div className="ai-item-head">
                      <SeverityBadge severity={o.severity} />
                      <strong>{o.title}</strong>
                      <ConfidenceBadge confidence={o.confidence} />
                      {o.category && <Tag>{o.category}</Tag>}
                    </div>
                    <p className="small">{o.detail}</p>
                    {refs(o.fileReferences)}
                  </li>
                ))}
              </ul>
            </>
          )}
          {a.recommendations.length > 0 && (
            <>
              <h4>Recommendations</h4>
              <ol className="ai-list">
                {a.recommendations.map((r, i) => (
                  <li key={i}>
                    <div className="ai-item-head">
                      <Tag tone={r.priority === 'high' ? 'bad' : r.priority === 'medium' ? 'warn' : 'neutral'}>{r.priority} priority</Tag>
                      <strong>{r.title}</strong>
                      <Tag>{r.effort} effort</Tag>
                      <ConfidenceBadge confidence={r.confidence} />
                    </div>
                    <p className="small">{r.detail}</p>
                    {refs(r.fileReferences)}
                  </li>
                ))}
              </ol>
            </>
          )}
          <footer className="small muted insight-footer">
            Context sent: {insight.contextFiles.length ? insight.contextFiles.join(', ') : 'local analysis summary only'} · output mode: {insight.outputMode} · AI output is advisory and was validated but not verified.
          </footer>
        </div>
      )}
    </article>
  );
}

export function AIInsights({ state, hasResult }: { state: AppState; hasResult: boolean }) {
  const ai = state.ai;
  const busy = !!ai.running;
  const modelOptions = ai.availableModels.includes(ai.model) ? ai.availableModels : [ai.model, ...ai.availableModels];
  const activeLabel = ai.providers.find((p) => p.id === ai.provider)?.label ?? ai.provider;
  return (
    <div className="page">
      <div className="two-col">
        <Section title="AI provider" subtitle="AI is optional. All local analysis works without a key or internet connection.">
          <div className="config-rows">
            <div className="config-row">
              <Bot size={14} aria-hidden />
              <span>Active provider</span>
              <div className="spacer" />
              <select value={ai.provider} onChange={(e) => post({ type: 'setProvider', provider: e.target.value as AIProviderId })} aria-label="AI provider">
                {ai.providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                    {p.hasApiKey ? '' : ' (no key)'}
                  </option>
                ))}
              </select>
            </div>
            <div className="config-row">
              <BrainCircuit size={14} aria-hidden />
              <span>Model</span>
              <div className="spacer" />
              <select value={ai.model} onChange={(e) => post({ type: 'setModel', model: e.target.value })} aria-label={`${activeLabel} model`}>
                {modelOptions.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <Button variant="ghost" icon={<RefreshCw size={13} />} disabled={!ai.hasApiKey} onClick={() => post({ type: 'listModels' })} title="Load available models">
                Load
              </Button>
            </div>
            <div className="config-row">
              <Wifi size={14} aria-hidden />
              <span>Connection</span>
              {ai.connection.status === 'ok' ? (
                <Tag tone="good"><CheckCircle2 size={11} /> OK</Tag>
              ) : ai.connection.status === 'error' ? (
                <Tag tone="bad"><CircleAlert size={11} /> error</Tag>
              ) : (
                <Tag>unknown</Tag>
              )}
              <div className="spacer" />
              <Button disabled={!ai.hasApiKey} onClick={() => post({ type: 'testConnection' })}>
                Test connection
              </Button>
            </div>
            <p className="small muted config-message">{ai.connection.message}</p>
          </div>
          <h4>API keys</h4>
          <div className="config-rows">
            {ai.providers.map((p) => (
              <div key={p.id} className="config-row provider-row">
                <KeyRound size={14} aria-hidden />
                <span>{p.label}</span>
                {p.id === ai.provider && <Tag tone="accent">active</Tag>}
                {p.hasApiKey ? <Tag tone="good"><Lock size={11} /> stored</Tag> : <Tag>no key</Tag>}
                <div className="spacer" />
                {p.hasApiKey && p.id !== ai.provider && (
                  <Button variant="ghost" onClick={() => post({ type: 'setProvider', provider: p.id })}>
                    Use
                  </Button>
                )}
                <Button onClick={() => post({ type: 'setApiKey', provider: p.id })}>{p.hasApiKey ? 'Replace' : 'Set key'}</Button>
                {p.hasApiKey && (
                  <Button variant="ghost" onClick={() => post({ type: 'removeApiKey', provider: p.id })}>
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Section>
        <Section title="Usage this session">
          <div className="usage">
            <div>
              <span className="stat-value">{ai.sessionUsage.requests}</span>
              <span className="stat-label">requests</span>
            </div>
            <div>
              <span className="stat-value">{ai.sessionUsage.totalTokens.toLocaleString()}</span>
              <span className="stat-label">tokens</span>
            </div>
            <div>
              <span className="stat-value">{ai.rateLimit?.remainingRequests ?? '—'}</span>
              <span className="stat-label">requests left (rate limit)</span>
            </div>
          </div>
          <p className="small muted">
            Only redacted excerpts you approve are sent, from the extension host directly to {activeLabel}. API keys are stored in SecretStorage and never exposed to this view.
          </p>
        </Section>
      </div>

      {ai.lastError && (
        <Callout tone="error" icon={<CircleAlert size={14} />}>
          {ai.lastError}
        </Callout>
      )}

      <Section title="Run analysis" subtitle="Each run shows exactly what will be sent and asks for consent first.">
        <div className="task-grid">
          {PROJECT_TASKS.map((t) => (
            <button key={t.task} className="task" disabled={!ai.hasApiKey || busy || !hasResult} onClick={() => post({ type: 'aiRun', task: t.task })}>
              <Sparkles size={14} aria-hidden />
              <strong>{AI_TASK_LABELS[t.task]}</strong>
              <span className="small muted">{t.description}</span>
            </button>
          ))}
        </div>
        {!hasResult && <p className="small muted">Run a scan first — AI analysis builds on the local results.</p>}
        <p className="small muted">File reviews, module reviews and finding explanations are available from the Quality, Security and Progress tabs, and via “ProjectLens: Review Current File with AI”.</p>
      </Section>

      {busy && (
        <Section
          title={`Running: ${ai.running!.title}`}
          actions={
            <Button icon={<Square size={12} />} onClick={() => post({ type: 'aiCancel' })}>
              Cancel
            </Button>
          }
        >
          <Skeleton lines={4} />
        </Section>
      )}

      <Section title={`Insights (${ai.insights.length})`}>
        {ai.insights.length === 0 ? (
          <EmptyState icon={<BrainCircuit size={28} />} title="No AI insights yet">
            {ai.hasApiKey ? 'Run an analysis above.' : `Set a ${activeLabel} API key (or choose another provider) to enable AI-assisted review.`}
          </EmptyState>
        ) : (
          ai.insights.map((i) => <InsightCard key={i.id} insight={i} />)
        )}
      </Section>
    </div>
  );
}
