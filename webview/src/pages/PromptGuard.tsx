import { useEffect, useState } from 'react';
import { ClipboardCheck, Eraser, MessageSquareLock, Plus, RefreshCw, Save, ShieldCheck, Trash2, UserCheck } from 'lucide-react';
import type { AppState } from '../../../src/models/messages';
import {
  BUILTIN_DETECTORS,
  type ConsentStatus,
  type CustomPromptRule,
  type PromptAction,
  type PromptGuardMode,
  type PromptGuardView,
  type PromptPolicy
} from '../../../src/models/promptGuard';
import { Button, Callout, EmptyState, Section, Tag } from '../components/ui';
import { post } from '../vscode';
import { dateTime, relativeTime } from '../format';

const MODE_LABEL: Record<PromptGuardMode, string> = { off: 'Off', optional: 'Optional (members opt in)', required: 'Required for all members' };
const ACTION_LABEL: Record<PromptAction, string> = { off: 'Off', warn: 'Warn', redact: 'Block + sanitized copy', block: 'Block' };
const CONSENT: Record<ConsentStatus, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  not_needed: { label: 'Not needed', tone: 'neutral' },
  accepted: { label: 'Accepted', tone: 'good' },
  declined: { label: 'Declined', tone: 'neutral' },
  pending: { label: 'Waiting for review', tone: 'warn' }
};
const EVENT_TONE = { blocked: 'bad', warned: 'warn', detected: 'warn' } as const;

function ruleName(id: string, policy: PromptPolicy | null): string {
  if (id.startsWith('custom.')) {
    return policy?.customRules.find((r) => `custom.${r.id}` === id)?.name ?? 'Custom rule';
  }
  return (BUILTIN_DETECTORS.find((d) => d.id === id)?.label ?? id).split(',')[0];
}

function Status({ pg }: { pg: PromptGuardView }) {
  const p = pg.policy!;
  const installed = pg.tools.filter((t) => t.installed);
  return (
    <Section
      title={`Prompt Guard · ${pg.orgName}`}
      subtitle="Checks prompts you send to AI coding tools for secrets and sensitive data, on this computer, before they are sent."
      actions={
        <Button variant="ghost" icon={<RefreshCw size={13} />} loading={pg.busy === 'Syncing'} onClick={() => post({ type: 'pgRefresh' })}>
          Sync
        </Button>
      }
    >
      <div className="pg-status">
        <div>
          <span className="small muted">Policy</span>
          <Tag tone={p.mode === 'off' ? 'neutral' : 'accent'}>{MODE_LABEL[p.mode]}</Tag>
          <span className="small muted">v{p.version}</span>
        </div>
        <div>
          <span className="small muted">Your consent</span>
          <Tag tone={CONSENT[pg.consent].tone}>{CONSENT[pg.consent].label}</Tag>
        </div>
        <div>
          <span className="small muted">This computer</span>
          {pg.active ? <Tag tone="good">Protecting {installed.length} tool(s)</Tag> : <Tag tone="neutral">Not active</Tag>}
        </div>
      </div>
      {p.mode === 'off' && <Callout>{pg.isAdmin ? 'Prompt Guard is off for this organization. Turn it on in the policy editor below.' : 'Your organization has not turned on Prompt Guard.'}</Callout>}
      {p.mode !== 'off' && pg.consent === 'pending' && (
        <Callout tone="warn">
          {p.mode === 'required'
            ? `${pg.orgName} requires Prompt Guard. Review the policy to continue using organization projects and scans.`
            : `${pg.orgName} offers Prompt Guard. Review the policy to decide.`}{' '}
          <Button variant="primary" icon={<UserCheck size={13} />} onClick={() => post({ type: 'pgReview' })}>
            Review policy
          </Button>
        </Callout>
      )}
      {p.mode !== 'off' && pg.consent === 'declined' && (
        <Callout>
          You declined this optional policy.{' '}
          <button className="link" onClick={() => post({ type: 'pgReview' })}>
            Review again
          </button>
        </Callout>
      )}
      {pg.consent === 'accepted' && p.mode !== 'off' && !installed.length && <Callout tone="warn">You accepted the policy, but no AI tool is protected yet. Install a hook below.</Callout>}
      {pg.error && <Callout tone="error">{pg.error}</Callout>}
      {pg.pendingUploads > 0 && <p className="small muted">{pg.pendingUploads} event(s) waiting to upload.</p>}
    </Section>
  );
}

function Tools({ pg }: { pg: PromptGuardView }) {
  const canInstall = pg.consent === 'accepted' && pg.policy?.mode !== 'off';
  return (
    <Section title="AI tools on this computer" subtitle="ProjectLens adds a hook to each tool's user settings and keeps a backup of the original file. The hook runs offline and lets prompts through if it ever fails.">
      <table className="table">
        <thead>
          <tr>
            <th>Tool</th>
            <th>Status</th>
            <th>Protection</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {pg.tools.map((t) => (
            <tr key={t.tool}>
              <td>
                <strong>{t.label}</strong>
                {t.note && <div className="small muted">{t.note}</div>}
                {t.error && <div className="small error-text">{t.error}</div>}
              </td>
              <td>{t.installed ? <Tag tone="good">Installed</Tag> : t.detected ? <Tag>Detected</Tag> : <span className="small muted">Not found</span>}</td>
              <td className="small">{t.canBlock ? 'Blocks before sending' : 'Alerts after sending'}</td>
              <td className="num">
                {t.installed ? (
                  <Button variant="ghost" icon={<Trash2 size={13} />} disabled={!!pg.busy} onClick={() => post({ type: 'pgUninstall', tools: [t.tool] })}>
                    Remove
                  </Button>
                ) : (
                  <Button icon={<Plus size={13} />} disabled={!canInstall || !!pg.busy} onClick={() => post({ type: 'pgInstall', tools: [t.tool] })}>
                    Install
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!canInstall && pg.policy?.mode !== 'off' && <p className="small muted">Accept the policy to install hooks.</p>}
    </Section>
  );
}

function SanitizeTools({ pg }: { pg: PromptGuardView }) {
  return (
    <Section title="Sanitize text" subtitle="Remove secrets and sensitive details before pasting text into any AI tool, including ones without hooks.">
      <div className="row-left">
        <Button icon={<Eraser size={13} />} onClick={() => post({ type: 'pgSanitizeText' })}>
          Sanitize selection or clipboard
        </Button>
        {pg.hasSanitizedCopy && (
          <Button variant="primary" icon={<ClipboardCheck size={13} />} onClick={() => post({ type: 'pgCopySanitized' })}>
            Copy sanitized version of the last stopped prompt
          </Button>
        )}
      </div>
    </Section>
  );
}

function Rules({ policy }: { policy: PromptPolicy }) {
  return (
    <Section title="What is checked" subtitle="Your prompts are never uploaded. Your organization sees only the rule that matched, the tool, the project folder name and the time.">
      <p className="small pg-notice">{policy.notice}</p>
      <ul className="pg-rules">
        {BUILTIN_DETECTORS.map((d) => (
          <li key={d.id}>
            <span>{d.label}</span>
            <Tag tone={policy.builtin[d.id] === 'block' || policy.builtin[d.id] === 'redact' ? 'bad' : policy.builtin[d.id] === 'warn' ? 'warn' : 'neutral'}>{ACTION_LABEL[policy.builtin[d.id] ?? 'off']}</Tag>
          </li>
        ))}
        {policy.customRules.map((r) => (
          <li key={r.id}>
            <span>
              {r.name} <span className="small muted">({r.type})</span>
            </span>
            <Tag tone={r.action === 'warn' ? 'warn' : 'bad'}>{ACTION_LABEL[r.action]}</Tag>
          </li>
        ))}
      </ul>
      {policy.allowlist.length > 0 && <p className="small muted">{policy.allowlist.length} allowed value(s) are never flagged.</p>}
    </Section>
  );
}

function Events({ pg }: { pg: PromptGuardView }) {
  return (
    <Section title={pg.isAdmin ? 'Flagged prompts (team)' : 'Your flagged prompts'} subtitle="Metadata only. Prompt text is never collected.">
      {pg.events.length === 0 ? (
        <EmptyState icon={<ShieldCheck size={24} />} title="Nothing flagged">Prompts that match a rule appear here.</EmptyState>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              {pg.isAdmin && <th>Member</th>}
              <th>Tool</th>
              <th>Result</th>
              <th>Matched</th>
              <th>Project</th>
            </tr>
          </thead>
          <tbody>
            {pg.events.map((e) => (
              <tr key={e.id}>
                <td className="small" title={dateTime(e.occurredAt)}>
                  {relativeTime(e.occurredAt)}
                </td>
                {pg.isAdmin && <td className="small">{e.member ?? '—'}</td>}
                <td className="small">{pg.tools.find((t) => t.tool === e.tool)?.label ?? e.tool}</td>
                <td>
                  <Tag tone={EVENT_TONE[e.action]}>{e.action === 'detected' ? 'sent (alerted)' : e.action}</Tag>
                </td>
                <td className="small">{e.ruleIds.map((r) => ruleName(r, pg.policy)).join(', ')}</td>
                <td className="small">{e.project ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function Members({ pg }: { pg: PromptGuardView }) {
  const s = pg.summary;
  return (
    <Section title="Team coverage" subtitle="Who accepted the policy and which tools are protected. Last 30 days.">
      {s && (
        <div className="stat-row">
          <div className="stat">
            <span className="stat-value">
              {s.members.accepted}/{s.members.total}
            </span>
            <span className="stat-label">Accepted</span>
          </div>
          <div className="stat">
            <span className="stat-value">{s.members.protected}</span>
            <span className="stat-label">Protected</span>
          </div>
          <div className={`stat ${s.totals.blocked ? 'stat-warn' : ''}`}>
            <span className="stat-value">{s.totals.blocked}</span>
            <span className="stat-label">Blocked</span>
          </div>
          <div className={`stat ${s.totals.detected ? 'stat-bad' : ''}`}>
            <span className="stat-value">{s.totals.detected}</span>
            <span className="stat-label">Sent (Copilot)</span>
          </div>
          <div className="stat">
            <span className="stat-value">{s.totals.warned}</span>
            <span className="stat-label">Warnings</span>
          </div>
        </div>
      )}
      <table className="table">
        <thead>
          <tr>
            <th>Member</th>
            <th>Consent</th>
            <th>Protected tools</th>
            <th>Last seen</th>
            <th className="num">Blocked</th>
            <th className="num">Sent</th>
          </tr>
        </thead>
        <tbody>
          {pg.members.map((m) => (
            <tr key={m.userId}>
              <td>
                {m.name} <span className="small muted">{m.role}</span>
              </td>
              <td>
                <Tag tone={CONSENT[m.consent].tone}>{CONSENT[m.consent].label}</Tag>
              </td>
              <td className="small">
                {m.enabled && m.tools.length ? m.tools.map((t) => pg.tools.find((x) => x.tool === t)?.label ?? t).join(', ') : <span className="muted">None</span>}
                {m.enabled && !m.upToDate && <span className="muted"> (older policy)</span>}
              </td>
              <td className="small">{m.lastSeenAt ? relativeTime(m.lastSeenAt) : '—'}</td>
              <td className="num">{m.last30Days.blocked}</td>
              <td className="num">{m.last30Days.detected}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

type Draft = Pick<PromptPolicy, 'mode' | 'notice' | 'builtin' | 'customRules'> & { allowlist: string; webhookUrl: string };

const toDraft = (p: PromptPolicy): Draft => ({
  mode: p.mode,
  notice: p.notice,
  builtin: { ...p.builtin },
  customRules: p.customRules.map((r) => ({ ...r })),
  allowlist: p.allowlist.join('\n'),
  webhookUrl: p.webhookUrl ?? ''
});

function PolicyEditor({ pg }: { pg: PromptGuardView }) {
  const policy = pg.policy!;
  const [draft, setDraft] = useState<Draft>(() => toDraft(policy));
  useEffect(() => setDraft(toDraft(policy)), [policy.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const setRule = (i: number, patch: Partial<CustomPromptRule>) => set('customRules', draft.customRules.map((r, j) => (i === j ? { ...r, ...patch } : r)));

  const save = () =>
    post({
      type: 'pgSavePolicy',
      patch: {
        mode: draft.mode,
        notice: draft.notice.trim(),
        builtin: draft.builtin,
        customRules: draft.customRules
          .filter((r) => r.name.trim() && r.pattern)
          .map((r) => ({ ...(r.id ? { id: r.id } : {}), name: r.name.trim(), type: r.type, pattern: r.pattern, action: r.action })),
        allowlist: draft.allowlist
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        webhookUrl: draft.webhookUrl.trim() || null
      }
    });

  return (
    <Section
      title="Policy (admin)"
      subtitle={`Applies to every member's machine within ~10 minutes. Also editable through the API: PUT /prompt-guard/policy.${policy.updatedBy ? ` Last change by ${policy.updatedBy}${policy.updatedAt ? `, ${relativeTime(policy.updatedAt)}` : ''}.` : ''}`}
      actions={
        <Button variant="primary" icon={<Save size={13} />} loading={pg.busy === 'Saving policy'} onClick={save}>
          Save policy
        </Button>
      }
    >
      <div className="pg-form">
        <label>
          <span>Mode</span>
          <select value={draft.mode} onChange={(e) => set('mode', e.target.value as PromptGuardMode)}>
            {(Object.keys(MODE_LABEL) as PromptGuardMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABEL[m]}
              </option>
            ))}
          </select>
          <span className="small muted">Optional: each member decides. Required: members must accept before using organization projects. Changing the mode or notice asks members to accept again.</span>
        </label>
        <label>
          <span>Notice shown to members</span>
          <textarea className="input" rows={4} value={draft.notice} maxLength={2000} onChange={(e) => set('notice', e.target.value)} />
        </label>
        <fieldset>
          <legend>Built-in detectors</legend>
          {BUILTIN_DETECTORS.map((d) => (
            <div key={d.id} className="pg-row">
              <span>{d.label}</span>
              <select value={draft.builtin[d.id] ?? 'off'} onChange={(e) => set('builtin', { ...draft.builtin, [d.id]: e.target.value as PromptAction })} aria-label={d.label}>
                {(Object.keys(ACTION_LABEL) as PromptAction[]).map((a) => (
                  <option key={a} value={a}>
                    {ACTION_LABEL[a]}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </fieldset>
        <fieldset>
          <legend>Custom rules</legend>
          <p className="small muted">Client names, internal project codenames, hostnames. A term matches whole words, ignoring case. A regex uses JavaScript syntax.</p>
          {draft.customRules.map((r, i) => (
            <div key={r.id || i} className="pg-row pg-rule">
              <input className="input" placeholder="Name" value={r.name} onChange={(e) => setRule(i, { name: e.target.value })} aria-label="Rule name" />
              <select value={r.type} onChange={(e) => setRule(i, { type: e.target.value as 'term' | 'regex' })} aria-label="Rule type">
                <option value="term">Term</option>
                <option value="regex">Regex</option>
              </select>
              <input className="input" placeholder={r.type === 'term' ? 'Project Falcon' : 'acme-[0-9]{4}'} value={r.pattern} onChange={(e) => setRule(i, { pattern: e.target.value })} aria-label="Pattern" />
              <select value={r.action} onChange={(e) => setRule(i, { action: e.target.value as CustomPromptRule['action'] })} aria-label="Action">
                <option value="warn">Warn</option>
                <option value="redact">Block + sanitized copy</option>
                <option value="block">Block</option>
              </select>
              <Button variant="ghost" icon={<Trash2 size={13} />} onClick={() => set('customRules', draft.customRules.filter((_, j) => j !== i))} aria-label="Remove rule" />
            </div>
          ))}
          <Button icon={<Plus size={13} />} onClick={() => set('customRules', [...draft.customRules, { id: '', name: '', type: 'term', pattern: '', action: 'block' }])}>
            Add rule
          </Button>
        </fieldset>
        <label>
          <span>Allowlist (one value per line)</span>
          <textarea className="input" rows={3} value={draft.allowlist} onChange={(e) => set('allowlist', e.target.value)} placeholder="Example keys from documentation, test card numbers…" />
        </label>
        <label>
          <span>Webhook URL (optional)</span>
          <input className="input" value={draft.webhookUrl} onChange={(e) => set('webhookUrl', e.target.value)} placeholder="https://hooks.example.com/projectlens" />
          <span className="small muted">Receives signed `prompt.flagged` events (metadata only) for blocked prompts and Copilot alerts.</span>
        </label>
      </div>
    </Section>
  );
}

export function PromptGuardPage({ state }: { state: AppState }) {
  const pg = state.promptGuard;
  if (!pg.available || !pg.policy) {
    return (
      <div className="page">
        <Section title="Prompt Guard" subtitle="Stops secrets and sensitive data from being sent to AI coding tools: Claude Code, Codex, Cursor, GitHub Copilot and Antigravity.">
          <EmptyState
            icon={<MessageSquareLock size={28} />}
            title={state.cloud.signedIn ? 'Select an organization' : 'Sign in to ProjectLens Cloud'}
            action={
              <Button variant="primary" onClick={() => post({ type: 'openDashboard', tab: 'cloud' })}>
                Open Cloud
              </Button>
            }
          >
            Your organization's owner or admin sets the policy. Prompts are checked on your computer and never uploaded.
          </EmptyState>
          {pg.error && <Callout tone="error">{pg.error}</Callout>}
        </Section>
        <SanitizeTools pg={pg} />
      </div>
    );
  }
  return (
    <div className="page">
      <Status pg={pg} />
      {pg.policy.mode !== 'off' && <Tools pg={pg} />}
      {pg.policy.mode !== 'off' && <Rules policy={pg.policy} />}
      <SanitizeTools pg={pg} />
      {(pg.policy.mode !== 'off' || pg.events.length > 0) && <Events pg={pg} />}
      {pg.isAdmin && pg.policy.mode !== 'off' && <Members pg={pg} />}
      {pg.isAdmin && <PolicyEditor pg={pg} />}
    </div>
  );
}
