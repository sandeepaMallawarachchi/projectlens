import { Building2, Cloud as CloudIcon, CloudUpload, KeyRound, Link2, LogOut, Mail, Plus, RefreshCw, Play, Trash2, Unlink, Users, BrainCircuit, Gauge, Lock, Settings } from 'lucide-react';
import type { AppState } from '../../../src/models/messages';
import type { AIProviderId } from '../../../src/models/ai';
import type { CloudProjectView, CloudRole } from '../../../src/models/cloud';
import { Button, Callout, EmptyState, Meter, Section, Tag } from '../components/ui';
import { post } from '../vscode';
import { relativeTime } from '../format';

/** GitHub mark (lucide no longer ships brand icons). */
function GitHubMark({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function Scores({ s }: { s: CloudProjectView['latestScan'] }) {
  if (!s?.scores) {
    return <span className="muted small">{s ? s.status : 'No scans yet'}</span>;
  }
  const items: [string, number | null][] = [
    ['Security', s.scores.security],
    ['Quality', s.scores.quality],
    ['Progress', s.scores.implementation],
    ['Ready', s.scores.readiness]
  ];
  return (
    <div className="cloud-scores">
      {items.map(([label, v]) => (
        <div key={label} className="cloud-score">
          <span className="small muted">{label}</span>
          <span className="num">{v ?? '—'}</span>
          <Meter value={v} />
        </div>
      ))}
    </div>
  );
}

function memberName(m: { name: string | null; githubLogin: string | null; email: string | null }) {
  return m.name ?? m.githubLogin ?? m.email ?? 'Unknown';
}

export function CloudPage({ state }: { state: AppState }) {
  const c = state.cloud;
  const busy = !!c.busy;

  if (!c.signedIn) {
    return (
      <div className="page">
        <Section title="ProjectLens Cloud" subtitle={`Connected to ${c.apiUrl}`}>
          <div className="cloud-hero">
            <CloudIcon size={28} aria-hidden />
            <div>
              <p>
                Share project health with your team and connect project-management tools. Upload scans from VS Code or let the cloud scan your GitHub/GitLab repositories, manage
                teammates and API keys, and run AI insights with your organization's own AI key.
              </p>
              <p className="small muted">Free for now. Local analysis in the extension always works without an account.</p>
            </div>
          </div>
          {c.error && <Callout tone="error">{c.error}</Callout>}
          <div className="row-left">
            <Button variant="primary" icon={<GitHubMark />} loading={busy} onClick={() => post({ type: 'cloudSignIn', method: 'github' })}>
              Sign in with GitHub
            </Button>
            {c.methods?.email !== false && (
              <Button icon={<Mail size={14} />} disabled={busy} onClick={() => post({ type: 'cloudSignIn', method: 'email' })}>
                Sign in with email
              </Button>
            )}
            <Button variant="ghost" icon={<Settings size={13} />} onClick={() => post({ type: 'cloudOpenSettings' })}>
              Settings
            </Button>
          </div>
        </Section>
      </div>
    );
  }

  const org = c.organizations.find((o) => o.id === c.currentOrgId);
  const admin = org?.role === 'owner' || org?.role === 'admin';
  const owner = org?.role === 'owner';
  const linked = c.projects.find((p) => p.id === c.linkedProjectId) ?? null;
  const hasLocal = !!state.result;

  return (
    <div className="page">
      <div className="cloud-bar">
        <div className="cloud-account">
          <CloudIcon size={15} aria-hidden />
          <span>
            {c.user?.githubLogin ? `@${c.user.githubLogin}` : c.user?.email}
            {c.user?.githubLogin && c.user.email && <span className="muted small"> · {c.user.email}</span>}
          </span>
        </div>
        <div className="cloud-bar-actions">
          <Building2 size={14} aria-hidden />
          <select value={c.currentOrgId ?? ''} onChange={(e) => post({ type: 'cloudSelectOrg', orgId: e.target.value })} aria-label="Organization" disabled={busy}>
            {c.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name} ({o.role})
              </option>
            ))}
          </select>
          <Button variant="ghost" icon={<Plus size={13} />} disabled={busy} onClick={() => post({ type: 'cloudCreateOrg' })} title="Create organization" />
          <Button variant="ghost" icon={<RefreshCw size={13} />} loading={busy} onClick={() => post({ type: 'cloudRefresh' })} title="Refresh" />
          <Button variant="ghost" icon={<LogOut size={13} />} onClick={() => post({ type: 'cloudSignOut' })}>
            Sign out
          </Button>
        </div>
      </div>
      {c.busy && <p className="small muted">{c.busy}…</p>}
      {c.error && <Callout tone="error">{c.error}</Callout>}

      <Section
        title="This workspace"
        subtitle={linked ? `Linked to “${linked.name}”${linked.repository ? ` · ${linked.provider}: ${linked.repository}` : ' · uploads only'}` : 'Not linked to a cloud project yet.'}
        actions={
          linked ? (
            <Button variant="ghost" icon={<Unlink size={13} />} onClick={() => post({ type: 'cloudUnlink' })}>
              Unlink
            </Button>
          ) : null
        }
      >
        {linked ? (
          <>
            <Scores s={linked.latestScan} />
            {linked.latestScan && (
              <p className="small muted">
                Last {linked.latestScan.source === 'upload' ? 'upload' : 'cloud scan'} {relativeTime(linked.latestScan.finishedAt ?? undefined)}
                {linked.latestScan.commitSha && ` · ${linked.latestScan.commitSha.slice(0, 7)}`}
                {(linked.latestScan.critical > 0 || linked.latestScan.high > 0) && ` · ${linked.latestScan.critical} critical, ${linked.latestScan.high} high`}
              </p>
            )}
            <div className="row-left">
              <Button variant="primary" icon={<CloudUpload size={14} />} disabled={busy || !hasLocal} title={hasLocal ? 'Upload the latest local scan' : 'Run a local scan first'} onClick={() => post({ type: 'cloudUpload' })}>
                Upload latest scan
              </Button>
              <Button icon={<Play size={14} />} disabled={busy || linked.provider === 'none'} title={linked.provider === 'none' ? 'This project has no repository access' : 'The server downloads and scans the repository'} onClick={() => post({ type: 'cloudScan' })}>
                Run cloud scan
              </Button>
              {linked.provider !== 'none' && (
                <Button variant="ghost" icon={<Lock size={13} />} disabled={busy} onClick={() => post({ type: 'cloudSetToken' })}>
                  {linked.hasAccessToken ? 'Replace repo token' : 'Add repo token'}
                </Button>
              )}
              <label className="checkbox small">
                <input type="checkbox" checked={c.autoUpload} onChange={(e) => post({ type: 'cloudToggleAutoUpload', enabled: e.target.checked })} /> Upload automatically after each scan
              </label>
            </div>
            {linked.provider !== 'none' && !linked.hasAccessToken && (
              <p className="small muted">Cloud scans of private repositories need a read-only repository token. Uploads work without one.</p>
            )}
          </>
        ) : (
          <div className="row-left">
            <Button variant="primary" icon={<Link2 size={14} />} disabled={busy || !org} onClick={() => post({ type: 'cloudLink' })}>
              Link to cloud project
            </Button>
            <span className="small muted">Creates a project from this workspace's Git remote, or links an existing one.</span>
          </div>
        )}
      </Section>

      <Section title={`Projects (${c.projects.length})`} subtitle="All projects in this organization — the same data your PM tool reads through the API.">
        {c.projects.length === 0 ? (
          <EmptyState icon={<CloudIcon size={24} />} title="No cloud projects yet">
            Link this workspace to create the first one.
          </EmptyState>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Latest</th>
                <th>Scores</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {c.projects.map((p) => (
                <tr key={p.id}>
                  <td>
                    {p.name} {p.id === c.linkedProjectId && <Tag tone="accent">this workspace</Tag>}
                    <div className="small muted">{p.repository ? `${p.provider}: ${p.repository}` : 'uploads only'}{p.externalId ? ` · ext:${p.externalId}` : ''}</div>
                  </td>
                  <td className="small">{p.latestScan ? `${p.latestScan.source === 'upload' ? 'Upload' : 'Cloud scan'} · ${relativeTime(p.latestScan.finishedAt ?? undefined)}` : '—'}</td>
                  <td>
                    <Scores s={p.latestScan} />
                  </td>
                  <td>
                    {p.provider !== 'none' && (
                      <Button variant="ghost" icon={<Play size={13} />} disabled={busy} onClick={() => post({ type: 'cloudScan', projectId: p.id })} title="Run cloud scan" />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <div className="two-col">
        <Section
          title={
            <span className="inline-title">
              <Users size={14} /> Team
            </span>
          }
          actions={
            admin && (
              <Button icon={<Plus size={13} />} disabled={busy} onClick={() => post({ type: 'cloudInvite' })}>
                Invite
              </Button>
            )
          }
        >
          <ul className="cloud-list">
            {c.members.map((m) => (
              <li key={m.userId}>
                <span>
                  {memberName(m)}
                  {m.email && m.name && <span className="small muted"> · {m.email}</span>}
                </span>
                <div className="spacer" />
                {admin && (owner || m.role === 'member') ? (
                  <select value={m.role} onChange={(e) => post({ type: 'cloudChangeRole', userId: m.userId, role: e.target.value as CloudRole })} aria-label={`Role of ${memberName(m)}`} disabled={busy}>
                    {owner && <option value="owner">owner</option>}
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                  </select>
                ) : (
                  <Tag>{m.role}</Tag>
                )}
                <button className="icon-btn" title="Remove / leave" aria-label={`Remove ${memberName(m)}`} onClick={() => post({ type: 'cloudRemoveMember', userId: m.userId })}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
            {c.invitations.map((i) => (
              <li key={i.id}>
                <span className="muted">
                  {i.email} <Tag tone="warn">invited · {i.role}</Tag>
                </span>
                <div className="spacer" />
                <button className="icon-btn" title="Revoke invitation" aria-label={`Revoke invitation for ${i.email}`} onClick={() => post({ type: 'cloudRevokeInvite', invitationId: i.id })}>
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
          {admin && <p className="small muted">Invitees join automatically when they sign in to ProjectLens Cloud with the invited email.</p>}
        </Section>

        <Section
          title={
            <span className="inline-title">
              <KeyRound size={14} /> API keys
            </span>
          }
          subtitle="For your PM tool and other integrations."
          actions={
            admin && (
              <Button icon={<Plus size={13} />} disabled={busy} onClick={() => post({ type: 'cloudCreateKey' })}>
                Create key
              </Button>
            )
          }
        >
          {!admin ? (
            <p className="small muted">Only organization admins can manage API keys.</p>
          ) : c.apiKeys.length === 0 ? (
            <p className="small muted">No API keys. Create one and add it to your PM tool's server environment.</p>
          ) : (
            <ul className="cloud-list">
              {c.apiKeys.map((k) => (
                <li key={k.id}>
                  <span>
                    {k.name} <span className="mono small muted">{k.prefix}…</span>
                    <div className="small muted">
                      {k.scopes.join(', ')} · {k.lastUsedAt ? `used ${relativeTime(k.lastUsedAt)}` : 'never used'}
                    </div>
                  </span>
                  <div className="spacer" />
                  <button className="icon-btn" title="Revoke" aria-label={`Revoke ${k.name}`} onClick={() => post({ type: 'cloudRevokeKey', keyId: k.id })}>
                    <Trash2 size={13} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="small muted">
            Base URL: <span className="mono">{c.apiUrl}</span>
          </p>
        </Section>
      </div>

      <div className="two-col">
        <Section
          title={
            <span className="inline-title">
              <BrainCircuit size={14} /> Cloud AI keys
            </span>
          }
          subtitle="Used for AI insights requested through the cloud API (e.g. by your PM tool). Encrypted on the server. Separate from your local AI keys."
        >
          <ul className="cloud-list">
            {c.aiKeys.map((k) => (
              <li key={k.provider}>
                <span>
                  {k.label} {c.aiDefaultProvider === k.provider && <Tag tone="accent">default</Tag>}
                  <div className="small muted">{k.configured ? `•••• ${k.last4}` : 'not set'}</div>
                </span>
                <div className="spacer" />
                {admin && k.configured && c.aiDefaultProvider !== k.provider && (
                  <Button variant="ghost" disabled={busy} onClick={() => post({ type: 'cloudSetAiDefault', provider: k.provider as AIProviderId })}>
                    Make default
                  </Button>
                )}
                {admin && (
                  <Button disabled={busy} onClick={() => post({ type: 'cloudSetAiKey', provider: k.provider as AIProviderId })}>
                    {k.configured ? 'Replace' : 'Set key'}
                  </Button>
                )}
                {admin && k.configured && (
                  <button className="icon-btn" title="Remove key" aria-label={`Remove ${k.label} key`} onClick={() => post({ type: 'cloudRemoveAiKey', provider: k.provider as AIProviderId })}>
                    <Trash2 size={13} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Section>

        <Section
          title={
            <span className="inline-title">
              <Gauge size={14} /> Usage
            </span>
          }
          subtitle={`Plan: ${org?.plan ?? 'free'}`}
        >
          {c.usage ? (
            <div className="usage-rows">
              {(
                [
                  ['Projects', c.usage.projects, c.usage.limits.projects],
                  ['Cloud scans (24 h)', c.usage.last24h.cloudScans, c.usage.limits.cloudScansPerDay],
                  ['Uploads (24 h)', c.usage.last24h.uploads, c.usage.limits.uploadsPerDay],
                  ['AI insights (24 h)', c.usage.last24h.aiInsights, c.usage.limits.aiInsightsPerDay]
                ] as [string, number, number][]
              ).map(([label, used, limit]) => (
                <div key={label} className="usage-row">
                  <span className="small">{label}</span>
                  <span className="num small">
                    {used} / {limit}
                  </span>
                  <Meter value={(used / limit) * 100} tone={used / limit > 0.9 ? 'poor' : used / limit > 0.7 ? 'fair' : 'good'} />
                </div>
              ))}
            </div>
          ) : (
            <p className="small muted">—</p>
          )}
          {c.lastSync && <p className="small muted">Synced {relativeTime(c.lastSync)}</p>}
        </Section>
      </div>
    </div>
  );
}
