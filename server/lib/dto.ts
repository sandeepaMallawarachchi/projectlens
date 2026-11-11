import type { Finding, ScanResult, ScoreAssessment, Severity } from '@/engine/models/types';
import { SEVERITY_RANK } from '@/engine/models/types';
import type { ProjectRecord, ScanRecord } from './store/types';

/** API shapes. Never include repository tokens or source code. */

const score = (a: ScoreAssessment) => ({ score: a.score, grade: a.grade, verdict: a.verdict });

export function findingDto(f: Finding) {
  return {
    id: f.id,
    ruleId: f.ruleId,
    title: f.title,
    category: f.category,
    severity: f.severity,
    confidence: f.confidence,
    status: f.status,
    kind: f.kind,
    analyzer: f.analyzer,
    file: f.location.file,
    line: f.location.line,
    url: f.location.uri || null,
    description: f.description,
    impact: f.impact ?? null,
    recommendation: f.recommendation,
    evidence: f.evidence,
    testOrFixture: !!f.tags?.includes('test-or-fixture')
  };
}

export function overviewDto(r: ScanResult) {
  const real = r.findings.filter((f) => !f.tags?.includes('test-or-fixture'));
  const bySeverity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of real) {
    bySeverity[f.severity]++;
  }
  const topRisks = real
    .filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK.medium && (f.category === 'security' || f.category === 'dependency' || f.severity !== 'medium'))
    .slice(0, 10)
    .map((f) => ({ id: f.id, title: f.title, severity: f.severity, confidence: f.confidence, status: f.status, category: f.category, file: f.location.file, line: f.location.line, url: f.location.uri || null }));
  const p = r.progress;
  return {
    projectName: r.projectName,
    primaryFramework: r.technology.primaryFramework ?? null,
    packageManager: r.technology.packageManager ?? null,
    scores: { quality: score(r.scores.quality), security: score(r.scores.security), implementation: score(r.scores.implementation), readiness: score(r.scores.readiness) },
    findings: {
      total: real.length,
      bySeverity,
      security: real.filter((f) => f.category === 'security' || f.category === 'dependency').length,
      quality: real.filter((f) => f.category === 'quality' || f.category === 'configuration').length,
      needsReview: real.filter((f) => f.status === 'needs-review').length
    },
    progress: {
      label: p.requirements ? 'Requirements completion' : 'Implementation evidence',
      estimate: p.requirements?.weightedCompletion ?? p.implementationEvidence,
      modules: p.modules.map((m) => ({ id: m.id, name: m.name, status: m.status, completion: m.completion, layers: m.layers })),
      requirements: p.requirements?.results.map((x) => ({ id: x.feature.id, name: x.feature.name, weight: x.feature.weight, status: x.status, completion: x.completion })) ?? null,
      pages: p.routeCount,
      apiEndpoints: p.apiEndpointCount,
      components: p.componentCount,
      testFiles: p.testFileCount,
      unfinishedItems: p.placeholders.length
    },
    technologies: r.technology.technologies.filter((t) => t.usage !== 'declared').map((t) => ({ name: t.name, category: t.category, version: t.resolvedVersion ?? t.version ?? null, usage: t.usage, confidence: t.confidence })),
    languages: r.technology.languages.filter((l) => l.lines > 0).slice(0, 8),
    topRisks,
    recommendedActions: r.recommendedActions.map((a) => ({ title: a.title, detail: a.detail, priority: a.priority, findings: a.findingIds.length })),
    coverage: { filesAnalyzed: r.coverage.filesAnalyzed, linesAnalyzed: r.coverage.linesAnalyzed, durationMs: r.coverage.durationMs, analyzersRun: r.coverage.analyzersRun },
    warnings: r.warnings
  };
}

export type ScanOverview = ReturnType<typeof overviewDto>;

export function scanDto(s: ScanRecord) {
  return {
    id: s.id,
    projectId: s.projectId,
    status: s.status,
    mode: s.mode,
    ref: s.ref,
    commitSha: s.commitSha,
    triggeredBy: s.triggeredBy,
    createdAt: s.createdAt,
    startedAt: s.startedAt,
    finishedAt: s.finishedAt,
    durationMs: s.startedAt && s.finishedAt ? new Date(s.finishedAt).getTime() - new Date(s.startedAt).getTime() : null,
    error: s.error,
    overview: s.summary
  };
}

/** Detailed scan: overview plus score explanations and module reasoning (no findings list; use /findings). */
export function scanDetailDto(s: ScanRecord) {
  const r = s.result;
  return {
    ...scanDto(s),
    scores: r
      ? Object.fromEntries(
          Object.entries(r.scores).map(([k, a]) => [k, { ...score(a), label: a.label, explanation: a.explanation, caps: a.caps, checks: a.checks }])
        )
      : null,
    modules: r?.progress.modules.map((m) => ({ id: m.id, name: m.name, status: m.status, completion: m.completion, layers: m.layers, fileCount: m.fileCount, reasons: m.reasons })) ?? null,
    limitations: r?.progress.limitations ?? null
  };
}

export function projectDto(p: ProjectRecord, latest: ScanRecord | null, history: ScanRecord[] = []) {
  return {
    id: p.id,
    name: p.name,
    provider: p.provider,
    repository: p.repository,
    baseUrl: p.baseUrl,
    ref: p.ref,
    externalId: p.externalId,
    hasAccessToken: !!p.tokenEncrypted,
    metadata: p.metadata,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    latestScan: latest ? scanDto(latest) : null,
    trend: history
      .filter((s) => s.status === 'completed' && s.summary)
      .slice(0, 20)
      .reverse()
      .map((s) => ({
        scanId: s.id,
        finishedAt: s.finishedAt,
        commitSha: s.commitSha,
        quality: s.summary!.scores.quality.score,
        security: s.summary!.scores.security.score,
        implementation: s.summary!.scores.implementation.score,
        readiness: s.summary!.scores.readiness.score,
        critical: s.summary!.findings.bySeverity.critical,
        high: s.summary!.findings.bySeverity.high
      }))
  };
}
