import type { ReactNode, ButtonHTMLAttributes } from 'react';
import { FileCode2, Loader2 } from 'lucide-react';
import type { Confidence, DetectionStatus, Severity } from '../../../src/models/types';
import { openFile } from '../vscode';
import { scoreTone } from '../format';

export function Button({
  variant = 'secondary',
  icon,
  loading,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; icon?: ReactNode; loading?: boolean }) {
  return (
    <button className={`btn btn-${variant} ${className}`} {...rest} disabled={rest.disabled || loading}>
      {loading ? <Loader2 size={14} className="spin" aria-hidden /> : icon}
      {children && <span>{children}</span>}
    </button>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`sev sev-${severity}`}>{severity}</span>;
}

export function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  return (
    <span className={`conf conf-${confidence}`} title={`${confidence} confidence`}>
      <span className="conf-dots" aria-hidden>
        <i className="on" />
        <i className={confidence !== 'low' ? 'on' : ''} />
        <i className={confidence === 'high' ? 'on' : ''} />
      </span>
      {confidence}
    </span>
  );
}

export function StatusPill({ status }: { status: DetectionStatus }) {
  return status === 'needs-review' ? <span className="pill pill-review">Needs review</span> : <span className="pill pill-confirmed">Confirmed</span>;
}

export function Tag({ children, tone = 'neutral', title }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent'; title?: string }) {
  return (
    <span className={`tag tag-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Meter({ value, tone, label }: { value: number | null; tone?: 'good' | 'fair' | 'poor' | 'none'; label?: string }) {
  const t = tone ?? scoreTone(value);
  return (
    <div className={`meter meter-${t}`} role="meter" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="meter-fill" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%` }} />
    </div>
  );
}

export function FileLink({ file, uri, line, column, endLine, endColumn, compact }: { file: string; uri: string; line?: number; column?: number; endLine?: number; endColumn?: number; compact?: boolean }) {
  const label = line ? `${file}:${line}` : file;
  return (
    <button
      type="button"
      className="file-link"
      title={`Open ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        openFile(uri, line, column, endLine, endColumn);
      }}
    >
      {!compact && <FileCode2 size={12} aria-hidden />}
      <span className="mono">{label}</span>
    </button>
  );
}

export function Section({ title, actions, children, subtitle, id }: { title: ReactNode; actions?: ReactNode; children: ReactNode; subtitle?: ReactNode; id?: string }) {
  return (
    <section className="section" id={id}>
      <header className="section-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        {actions && <div className="section-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  );
}

export function Skeleton({ lines = 3, height = 12 }: { lines?: number; height?: number }) {
  return (
    <div className="skeleton-group" aria-busy="true" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton" style={{ height, width: `${90 - ((i * 17) % 35)}%` }} />
      ))}
    </div>
  );
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i} className="kv-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Callout({ tone = 'info', icon, children }: { tone?: 'info' | 'warn' | 'error'; icon?: ReactNode; children: ReactNode }) {
  return (
    <div className={`callout callout-${tone}`} role={tone === 'error' ? 'alert' : 'note'}>
      {icon && <span className="callout-icon">{icon}</span>}
      <div>{children}</div>
    </div>
  );
}
