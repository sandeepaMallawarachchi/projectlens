import type { Finding, ScanResult, ScoreAssessment } from '../models/types';
import type { AIInsight } from '../models/ai';
import { countBySeverity } from './scanner';

/** JSON export. Findings already contain only redacted evidence. */
export function buildJsonReport(result: ScanResult, insights: AIInsight[] = []): string {
  return JSON.stringify(
    {
      generator: 'ProjectLens',
      reportVersion: 1,
      generatedAt: new Date().toISOString(),
      disclaimer:
        'Advisory static analysis. Findings include confidence and detection status; absence of findings does not prove the absence of vulnerabilities.',
      scan: result,
      aiInsights: insights
    },
    null,
    2
  );
}

const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const fmtScore = (a: ScoreAssessment) => (a.score === null ? 'Not assessed' : `${a.score}/100 (${a.grade})`);

function scoreSection(a: ScoreAssessment): string {
  const lines = [`### ${a.label}: ${fmtScore(a)}`, '', `**Verdict:** ${a.verdict}`, '', a.explanation, ''];
  if (a.caps.length) {
    lines.push(...a.caps.map((c) => `> ⚠ ${c}`), '');
  }
  if (a.checks.length) {
    lines.push('| Check | Status | Weight | Credit | Detail |', '|---|---|---|---|---|');
    for (const c of a.checks) {
      lines.push(`| ${esc(c.label)} | ${c.status} | ${c.weight} | ${c.status === 'passed' || c.status === 'failed' ? c.credit.toFixed(2) : '—'} | ${esc(c.detail)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function findingRow(f: Finding): string {
  return `| ${f.severity} | ${f.confidence} | ${f.status === 'needs-review' ? 'Needs review' : 'Confirmed'} | ${esc(f.title)} | \`${esc(f.location.file)}:${f.location.line}\` | \`${f.ruleId}\` |`;
}

export function buildMarkdownReport(result: ScanResult, insights: AIInsight[] = []): string {
  const counts = countBySeverity(result.findings);
  const security = result.findings.filter((f) => f.category === 'security' || f.category === 'dependency');
  const quality = result.findings.filter((f) => f.category === 'quality' || f.category === 'configuration');
  const cov = result.coverage;
  const out: string[] = [];

  out.push(`# ProjectLens Report — ${result.projectName}`, '');
  out.push(`- **Scan:** ${result.mode === 'full' ? 'Full' : 'Quick'} scan, finished ${result.finishedAt} (${(cov.durationMs / 1000).toFixed(1)} s)`);
  out.push(`- **Scope:** ${result.roots.map((r) => r.name).join(', ')}`);
  out.push(`- **Coverage:** ${cov.filesAnalyzed} of ${cov.filesDiscovered} files analyzed, ${cov.sourceFilesParsed} JS/TS files parsed, ${cov.linesAnalyzed.toLocaleString('en-US')} lines`);
  out.push(`- **Analyzers run:** ${cov.analyzersRun.join(', ')}`);
  if (cov.analyzersUnavailable.length) {
    out.push(`- **Unavailable:** ${cov.analyzersUnavailable.map((a) => `${a.analyzer} (${a.reason})`).join('; ')}`);
  }
  if (cov.skipped.length) {
    out.push(`- **Skipped:** ${cov.skipped.map((s) => `${s.count} ${s.reason}`).join(', ')}`);
  }
  out.push(`- **Findings:** ${result.findings.length} (critical ${counts.critical}, high ${counts.high}, medium ${counts.medium}, low ${counts.low}, info ${counts.info})${result.findingsTruncated ? ' — truncated' : ''}`);
  out.push('');
  out.push('> This report is advisory. Static rules cannot observe runtime configuration or business logic. "Needs review" findings require application context; no findings does not mean the project is secure.', '');

  if (result.warnings.length) {
    out.push('## Warnings', '', ...result.warnings.map((w) => `- ${w}`), '');
  }

  out.push('## Scores', '');
  out.push('| Assessment | Score | Verdict |', '|---|---|---|');
  for (const a of Object.values(result.scores)) {
    out.push(`| ${a.label} | ${fmtScore(a)} | ${esc(a.verdict)} |`);
  }
  out.push('');

  if (result.recommendedActions.length) {
    out.push('## Recommended actions', '');
    result.recommendedActions.forEach((a, i) => out.push(`${i + 1}. **${a.title}** (${a.priority}) — ${a.detail}`));
    out.push('');
  }

  out.push('## Technologies', '');
  out.push(`- **Primary framework:** ${result.technology.primaryFramework ?? 'Not detected'}`);
  out.push(`- **Package manager:** ${result.technology.packageManager ?? 'Not detected'}`);
  out.push(`- **Languages:** ${result.technology.languages.slice(0, 8).map((l) => `${l.language} (${l.files} files)`).join(', ')}`, '');
  out.push('| Technology | Category | Version | Usage | Confidence |', '|---|---|---|---|---|');
  for (const t of result.technology.technologies) {
    out.push(`| ${t.name} | ${t.category} | ${t.resolvedVersion ?? t.version ?? '—'} | ${t.usage} | ${t.confidence} |`);
  }
  out.push('');

  out.push('## Implementation progress', '');
  if (result.progress.requirements) {
    out.push(`Requirements-based completion: **${result.progress.requirements.weightedCompletion}%** (from ${result.progress.requirements.file})`, '');
    out.push('| Feature | Weight | Status | Completion |', '|---|---|---|---|');
    for (const r of result.progress.requirements.results) {
      out.push(`| ${esc(r.feature.name)} | ${r.feature.weight} | ${r.status} | ${r.completion}% |`);
    }
    out.push('');
  } else {
    out.push(`Implementation evidence: **${result.progress.implementationEvidence ?? '—'}${result.progress.implementationEvidence !== null ? '%' : ''}** (estimate from detected modules, not from requirements)`, '');
  }
  if (result.progress.modules.length) {
    out.push('| Module | Status | Completion | UI | API | Data | Tests |', '|---|---|---|---|---|---|---|');
    const yn = (b: boolean) => (b ? '✓' : '—');
    for (const m of result.progress.modules) {
      out.push(`| ${m.name} | ${m.status} | ${m.completion}% | ${yn(m.layers.ui)} | ${yn(m.layers.api)} | ${yn(m.layers.data)} | ${yn(m.layers.tests)} |`);
    }
    out.push('');
  }
  out.push('**Limitations:**', '', ...result.progress.limitations.map((l) => `- ${l}`), '');

  for (const a of Object.values(result.scores)) {
    out.push(scoreSection(a));
  }

  const table = (title: string, list: Finding[]) => {
    out.push(`## ${title} (${list.length})`, '');
    if (!list.length) {
      out.push('No findings from the enabled rules.', '');
      return;
    }
    out.push('| Severity | Confidence | Status | Finding | Location | Rule |', '|---|---|---|---|---|---|');
    out.push(...list.slice(0, 300).map(findingRow));
    if (list.length > 300) {
      out.push('', `…and ${list.length - 300} more (see the JSON export).`);
    }
    out.push('');
  };
  table('Security findings', security);
  table('Code-quality findings', quality);

  if (insights.length) {
    out.push('## AI insights', '', '> Generated by an AI model from redacted, user-approved context. Treat as suggestions, not verified facts.', '');
    for (const ins of insights) {
      out.push(`### ${ins.title}`, '', `_${ins.provider ?? 'groq'} · ${ins.model} · ${ins.createdAt}_`, '', ins.analysis.summary, '');
      for (const r of ins.analysis.recommendations) {
        out.push(`- **${r.title}** (${r.priority}, confidence ${r.confidence}) — ${r.detail}`);
      }
      out.push('');
    }
  }
  return out.join('\n');
}
