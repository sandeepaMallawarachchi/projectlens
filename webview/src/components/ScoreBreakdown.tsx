import type { ReactNode } from 'react';
import { CheckCircle2, CircleSlash, MinusCircle, XCircle, AlertTriangle } from 'lucide-react';
import type { ScoreAssessment, CheckStatus } from '../../../src/models/types';
import { Meter } from './ui';

const STATUS_ICON: Record<CheckStatus, ReactNode> = {
  passed: <CheckCircle2 size={14} className="ok" aria-label="passed" />,
  failed: <XCircle size={14} className="bad" aria-label="failed" />,
  unavailable: <CircleSlash size={14} className="muted" aria-label="unavailable" />,
  skipped: <MinusCircle size={14} className="muted" aria-label="skipped" />
};

/** Explains how a score was calculated: every check, its weight, credit and evidence. */
export function ScoreBreakdown({ assessment }: { assessment: ScoreAssessment }) {
  const counts = assessment.checks.reduce<Record<CheckStatus, number>>(
    (acc, c) => ({ ...acc, [c.status]: acc[c.status] + 1 }),
    { passed: 0, failed: 0, unavailable: 0, skipped: 0 }
  );
  const applicable = counts.passed + counts.failed;
  return (
    <div className="breakdown">
      <p className="muted small">{assessment.explanation}</p>
      {assessment.caps.map((c) => (
        <div key={c} className="cap">
          <AlertTriangle size={14} aria-hidden /> {c}
        </div>
      ))}
      {assessment.checks.length > 0 && (
        <>
          <div className="check-summary small muted">
            {applicable} applicable · {counts.passed} passed · {counts.failed} failed · {counts.unavailable} unavailable · {counts.skipped} skipped
          </div>
          <table className="table checks">
            <thead>
              <tr>
                <th />
                <th>Check</th>
                <th className="num">Weight</th>
                <th className="credit-col">Credit</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {assessment.checks.map((c) => (
                <tr key={c.id} className={`check-${c.status}`}>
                  <td className="icon-cell">{STATUS_ICON[c.status]}</td>
                  <td>{c.label}</td>
                  <td className="num">{c.weight}</td>
                  <td className="credit-col">
                    {c.status === 'passed' || c.status === 'failed' ? (
                      <div className="credit">
                        <Meter value={c.credit * 100} />
                        <span className="num small">{Math.round(c.credit * 100)}%</span>
                      </div>
                    ) : (
                      <span className="muted small">{c.status}</span>
                    )}
                  </td>
                  <td className="small muted">{c.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
