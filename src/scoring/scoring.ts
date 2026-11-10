import type {
  Finding,
  ProgressReport,
  RecommendedAction,
  ScanMode,
  ScoreAssessment,
  ScoreCheck,
  TechnologyReport
} from '../models/types';
import { SEVERITY_RANK } from '../models/types';

export interface ScoringInputs {
  mode: ScanMode;
  findings: Finding[];
  /** Lines of JS/TS source parsed. */
  sourceLines: number;
  sourceFilesParsed: number;
  filesAnalyzed: number;
  hasTypeScript: boolean;
  eslintAvailable: boolean;
  gitleaks: 'ran' | 'disabled' | 'unavailable' | 'untrusted';
  technology: TechnologyReport;
  progress: ProgressReport;
  project: {
    hasPackageJson: boolean;
    scripts: Record<string, string>;
    hasLintConfig: boolean;
    hasCi: boolean;
    hasLockfile: boolean;
    hasGitignore: boolean;
    gitignoreCoversEnv: boolean;
    hasReadme: boolean;
    hasEnvExample: boolean;
    usesEnvVars: boolean;
    hasDeployConfig: boolean;
    tsStrict: boolean | undefined;
  };
}

export function grade(score: number | null): string {
  if (score === null) {
    return '—';
  }
  return score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';
}

function weightedScore(checks: ScoreCheck[]): number | null {
  const applicable = checks.filter((c) => c.status === 'passed' || c.status === 'failed');
  const total = applicable.reduce((s, c) => s + c.weight, 0);
  if (total === 0) {
    return null;
  }
  return Math.round((100 * applicable.reduce((s, c) => s + c.weight * c.credit, 0)) / total);
}

/** Full credit at/below threshold, zero at 4× threshold, linear in between. */
export function densityCredit(perKloc: number, threshold: number): number {
  if (perKloc <= threshold) {
    return 1;
  }
  if (perKloc >= threshold * 4) {
    return 0;
  }
  return Math.round((1 - (perKloc - threshold) / (threshold * 3)) * 100) / 100;
}

const realFindings = (findings: Finding[]) => findings.filter((f) => !f.tags?.includes('test-or-fixture'));
const byRule = (findings: Finding[], test: (id: string) => boolean) => findings.filter((f) => test(f.ruleId));

function densityCheck(id: string, label: string, weight: number, count: number, kloc: number, threshold: number, unit: string): ScoreCheck {
  const perKloc = count / kloc;
  const credit = densityCredit(perKloc, threshold);
  return {
    id,
    label,
    weight,
    credit,
    status: credit === 1 ? 'passed' : 'failed',
    detail: `${count} ${unit} (${perKloc.toFixed(2)} per 1,000 lines; threshold ${threshold}).`
  };
}

export function scoreQuality(i: ScoringInputs): ScoreAssessment {
  const label = 'Code Quality';
  if (i.mode === 'quick') {
    return notAssessed('quality', label, 'Quick Scan does not run code-quality analyzers. Run a Full Scan.');
  }
  if (i.sourceFilesParsed === 0 || i.sourceLines < 50) {
    return notAssessed('quality', label, 'Insufficient data: fewer than 50 lines of JavaScript/TypeScript were analyzed.');
  }
  const f = realFindings(i.findings);
  const kloc = Math.max(i.sourceLines / 1000, 0.1);
  const count = (pred: (id: string) => boolean, weightFn: (x: Finding) => number = () => 1) => byRule(f, pred).reduce((s, x) => s + weightFn(x), 0);

  const checks: ScoreCheck[] = [];
  if (i.hasTypeScript) {
    checks.push(densityCheck('type-safety', 'Type safety (any, unsafe assertions, suppressions)', 2, count((id) => /^ts\/(explicit-any|unsafe-assertion|suppressed-error)$/.test(id), (x) => (x.ruleId === 'ts/explicit-any' ? 1 : 2)), kloc, 3, 'weighted type-safety issues'));
  } else {
    checks.push({ id: 'type-safety', label: 'Type safety', weight: 2, credit: 0, status: 'skipped', detail: 'No TypeScript files found.' });
  }
  checks.push(densityCheck('error-handling', 'Error handling', 2, count((id) => /^quality\/(empty-catch|unhandled-promise|async-handler-no-error-handling|catch-only-logs)$/.test(id), (x) => (x.ruleId === 'quality/empty-catch' ? 2 : 1)), kloc, 1, 'weighted error-handling issues'));
  checks.push(densityCheck('complexity', 'Complexity & function size', 2, count((id) => /^quality\/(complex-function|deep-nesting|long-function|too-many-parameters)$/.test(id)), kloc, 1.5, 'complexity findings'));
  if (i.eslintAvailable) {
    checks.push(densityCheck('lint', 'Lint rules (built-in ESLint rule set)', 2, count((id) => id.startsWith('eslint/'), (x) => (x.severity === 'info' ? 0.25 : 1)), kloc, 4, 'weighted lint findings'));
  } else {
    checks.push({ id: 'lint', label: 'Lint rules', weight: 2, credit: 0, status: 'unavailable', detail: 'ESLint could not be loaded.' });
  }
  checks.push(densityCheck('markers', 'Outstanding TODO/FIXME markers', 1, count((id) => id.startsWith('marker/')), kloc, 3, 'markers'));
  checks.push(densityCheck('duplication', 'Code duplication', 1, count((id) => id === 'quality/duplicate-block'), kloc, 0.5, 'duplicated blocks'));
  checks.push(densityCheck('logging', 'Logging hygiene in server code', 0.5, count((id) => id === 'quality/console-in-server'), kloc, 2, 'console statements in server code'));
  if (i.hasTypeScript) {
    const strict = i.project.tsStrict === true;
    checks.push({ id: 'ts-strict', label: 'TypeScript strict mode', weight: 1, credit: strict ? 1 : 0, status: strict ? 'passed' : 'failed', detail: strict ? '`strict: true` in tsconfig.' : '`strict` is not enabled in the root tsconfig (inherited `extends` settings are not resolved).' });
  }
  const buildOverride = byRule(f, (id) => id === 'config/next-ignore-type-errors').length;
  checks.push({ id: 'build-guards', label: 'Build does not ignore type errors', weight: 1, credit: buildOverride ? 0 : 1, status: buildOverride ? 'failed' : 'passed', detail: buildOverride ? 'next.config ignores TypeScript build errors.' : 'No build-error overrides found.' });

  const score = weightedScore(checks);
  return {
    id: 'quality',
    label,
    score,
    grade: grade(score),
    verdict: verdictFor(score, ['Strong', 'Good', 'Fair', 'Needs attention']),
    checks,
    caps: [],
    explanation: `Weighted average of ${checks.filter((c) => c.status === 'passed' || c.status === 'failed').length} applicable checks over ${Math.round(i.sourceLines).toLocaleString('en-US')} lines in ${i.sourceFilesParsed} JS/TS files. Density checks award full credit at or below the threshold and decline linearly to zero at four times the threshold.`
  };
}

interface SecurityGroup {
  id: string;
  label: string;
  weight: number;
  full: boolean;
  match: (f: Finding) => boolean;
}

const SECURITY_GROUPS: SecurityGroup[] = [
  { id: 'secrets', label: 'No hardcoded secrets or credential files', weight: 3, full: false, match: (f) => /^(secret\/|gitleaks\/|env\/tracked-env-secret|env\/example-contains-secret|config\/docker-secret-in-image|config\/compose-literal-secret)/.test(f.ruleId) },
  { id: 'env', label: 'Environment variables not exposed', weight: 2, full: false, match: (f) => /^env\/(public-secret|public-key-review|env-file-not-ignored)/.test(f.ruleId) },
  { id: 'injection', label: 'No injection-prone query/command construction', weight: 2, full: true, match: (f) => /^sec\/(sql-injection|command-injection|eval|nosql-injection|path-traversal|mass-assignment)$/.test(f.ruleId) },
  { id: 'xss', label: 'No unsafe HTML rendering', weight: 1.5, full: true, match: (f) => f.ruleId === 'sec/unsafe-html' },
  { id: 'auth', label: 'Safe token & credential handling', weight: 1.5, full: true, match: (f) => /^sec\/(jwt-|token-in-localstorage|insecure-cookie|weak-password-hash|insecure-random|weak-hash)/.test(f.ruleId) },
  { id: 'authorization', label: 'Authorization visible on sensitive endpoints', weight: 1.5, full: true, match: (f) => /^sec\/(missing-authorization|unprotected-sensitive-read|server-action-no-auth|webhook-no-signature)$/.test(f.ruleId) },
  { id: 'transport', label: 'Safe CORS, TLS and platform configuration', weight: 1, full: true, match: (f) => /^sec\/(cors-|tls-|express-no-security-headers|open-redirect)/.test(f.ruleId) || (f.ruleId.startsWith('config/') && f.category === 'security' && !/secret/.test(f.ruleId)) },
  { id: 'logging', label: 'No sensitive data in logs', weight: 1, full: true, match: (f) => /^sec\/(sensitive-logging|env-dump)$/.test(f.ruleId) },
  { id: 'dependencies', label: 'Dependency hygiene (offline checks)', weight: 1, full: false, match: (f) => f.category === 'dependency' && f.ruleId !== 'dep/duplicate-declaration' }
];

export function securityCredit(findings: Finding[]): { credit: number; detail: string } {
  const relevant = findings.filter((f) => f.severity !== 'info');
  if (!relevant.length) {
    return { credit: 1, detail: 'No findings.' };
  }
  const confirmed = relevant.filter((f) => f.status === 'confirmed');
  const severe = confirmed.filter((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK.high);
  const counts = `${relevant.length} finding(s): ${confirmed.length} confirmed, ${relevant.length - confirmed.length} need review.`;
  if (severe.length) {
    return { credit: 0, detail: `${counts} ${severe.length} confirmed high/critical.` };
  }
  if (confirmed.some((f) => f.severity === 'medium')) {
    return { credit: 0.5, detail: counts };
  }
  if (relevant.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK.high)) {
    return { credit: 0.5, detail: `${counts} High-severity items need review.` };
  }
  return { credit: 0.75, detail: `${counts} Only low-severity or review items.` };
}

export function scoreSecurity(i: ScoringInputs): ScoreAssessment {
  const label = 'Security Health';
  if (i.filesAnalyzed === 0) {
    return notAssessed('security', label, 'Insufficient data: no files were analyzed.');
  }
  const f = realFindings(i.findings).filter((x) => x.category === 'security' || x.category === 'dependency' || x.ruleId.startsWith('config/'));
  const checks: ScoreCheck[] = SECURITY_GROUPS.map((g) => {
    if (g.full && i.mode === 'quick') {
      return { id: g.id, label: g.label, weight: g.weight, credit: 0, status: 'skipped', detail: 'Requires Full Scan (AST analysis).' };
    }
    const { credit, detail } = securityCredit(f.filter(g.match));
    return { id: g.id, label: g.label, weight: g.weight, credit, status: credit === 1 ? 'passed' : 'failed', detail };
  });
  checks.push({
    id: 'gitleaks',
    label: 'Gitleaks secret scan (optional)',
    weight: 0,
    credit: 0,
    status: i.gitleaks === 'ran' ? 'passed' : i.gitleaks === 'disabled' ? 'skipped' : 'unavailable',
    detail:
      i.gitleaks === 'ran'
        ? 'Gitleaks ran; its findings are included in the secrets check.'
        : i.gitleaks === 'untrusted'
          ? 'Disabled in untrusted workspaces.'
          : i.gitleaks === 'disabled'
            ? 'Disabled in settings (projectlens.gitleaks.enabled).'
            : 'Gitleaks executable not found.'
  });

  let score = weightedScore(checks);
  const caps: string[] = [];
  const critical = f.filter((x) => x.severity === 'critical' && x.status === 'confirmed');
  const high = f.filter((x) => x.severity === 'high' && x.status === 'confirmed');
  if (score !== null && critical.length) {
    if (score > 40) {
      caps.push(`${critical.length} confirmed critical issue(s): score capped at 40 (was ${score}).`);
      score = 40;
    } else {
      caps.push(`${critical.length} confirmed critical issue(s) present.`);
    }
  } else if (score !== null && high.length && score > 70) {
    caps.push(`${high.length} confirmed high-severity issue(s): score capped at 70 (was ${score}).`);
    score = 70;
  }
  return {
    id: 'security',
    label,
    score,
    grade: grade(score),
    verdict: critical.length ? 'Critical issues found' : verdictFor(score, ['No major issues detected', 'Minor issues', 'Issues need attention', 'Significant risk']),
    checks,
    caps,
    explanation:
      'Each check receives full credit with no findings, 0.75 when only low-severity/review items exist, 0.5 for confirmed medium issues (or unconfirmed high), and 0 for confirmed high/critical issues. Confirmed critical issues cap the score at 40; confirmed high issues cap it at 70. A high score does not prove the application is secure — static rules cannot see runtime configuration or business logic.'
  };
}

export function scoreImplementation(i: ScoringInputs): ScoreAssessment {
  const req = i.progress.requirements;
  const label = req && req.results.length ? 'Requirements Completion' : 'Implementation Evidence';
  if (req && req.results.length) {
    const checks: ScoreCheck[] = req.results.map((r) => ({
      id: r.feature.id,
      label: r.feature.name,
      weight: r.feature.weight,
      credit: r.completion / 100,
      status: r.status === 'implemented' ? 'passed' : 'failed',
      detail: r.matchedModules.length ? `${r.status} · ${r.completion}% · modules: ${r.matchedModules.join(', ')}` : 'No matching module detected.'
    }));
    return {
      id: 'implementation',
      label,
      score: req.weightedCompletion,
      grade: grade(req.weightedCompletion),
      verdict: `${req.results.filter((r) => r.status === 'implemented').length}/${req.results.length} features implemented`,
      checks,
      caps: [],
      explanation: `Completion = Σ(feature weight × estimated completion) / Σ(feature weights), using requirements from ${req.file}. Feature completion is the mean estimate of matched modules; unmatched features count as 0%.`
    };
  }
  const modules = i.progress.modules;
  if (!modules.length) {
    return notAssessed('implementation', label, 'No functional modules (routes, API handlers, models, services) were detected. Add a .projectlens.json requirements file for a requirements-based estimate.');
  }
  const checks: ScoreCheck[] = modules.map((m) => ({
    id: m.id,
    label: m.name,
    weight: 1,
    credit: m.completion / 100,
    status: m.status === 'implemented' ? 'passed' : 'failed',
    detail: `${m.status} · ${m.completion}% — ${m.reasons[0]}`
  }));
  const score = i.progress.implementationEvidence;
  return {
    id: 'implementation',
    label,
    score,
    grade: grade(score),
    verdict: `${modules.filter((m) => m.status === 'implemented').length}/${modules.length} detected modules show complete evidence`,
    checks,
    caps: [],
    explanation:
      'Mean completion estimate of detected modules. This measures evidence of finished implementation in the code that exists — it cannot know about features that were never started. Add a .projectlens.json file to measure against your requirements.'
  };
}

export function scoreReadiness(i: ScoringInputs, quality: ScoreAssessment, security: ScoreAssessment): ScoreAssessment {
  const label = 'Production Readiness';
  if (i.filesAnalyzed === 0) {
    return notAssessed('readiness', label, 'Insufficient data: no files were analyzed.');
  }
  const p = i.project;
  const f = realFindings(i.findings);
  const critical = f.filter((x) => x.severity === 'critical' && x.status === 'confirmed' && x.category === 'security').length;
  const bool = (id: string, lbl: string, weight: number, ok: boolean, okDetail: string, failDetail: string): ScoreCheck => ({ id, label: lbl, weight, credit: ok ? 1 : 0, status: ok ? 'passed' : 'failed', detail: ok ? okDetail : failDetail });
  const na = (id: string, lbl: string, weight: number, detail: string, status: 'skipped' | 'unavailable' = 'skipped'): ScoreCheck => ({ id, label: lbl, weight, credit: 0, status, detail });

  const checks: ScoreCheck[] = [];
  checks.push(
    security.score === null
      ? na('security', 'Security health ≥ 70 and no critical issues', 3, 'Security not assessed.', 'unavailable')
      : { id: 'security', label: 'Security health ≥ 70 and no critical issues', weight: 3, credit: critical ? 0 : Math.min(1, security.score / 70), status: !critical && security.score >= 70 ? 'passed' : 'failed', detail: `Security score ${security.score}${critical ? `, ${critical} critical issue(s)` : ''}.` }
  );
  checks.push(
    quality.score === null
      ? na('quality', 'Code quality ≥ 60', 2, i.mode === 'quick' ? 'Requires Full Scan.' : 'Quality not assessed.', i.mode === 'quick' ? 'skipped' : 'unavailable')
      : { id: 'quality', label: 'Code quality ≥ 60', weight: 2, credit: Math.min(1, quality.score / 60), status: quality.score >= 60 ? 'passed' : 'failed', detail: `Quality score ${quality.score}.` }
  );
  checks.push(bool('tests', 'Automated tests present', 2, i.progress.testFileCount > 0, `${i.progress.testFileCount} test file(s).`, 'No test files found.'));
  if (p.hasPackageJson) {
    const testScript = p.scripts.test && !/no test specified/.test(p.scripts.test);
    checks.push(bool('test-script', 'Test script defined', 1, !!testScript, `"test": "${p.scripts.test}"`, 'No usable `test` script in package.json.'));
    checks.push(bool('build-script', 'Build script defined', 1, !!p.scripts.build, `"build": "${p.scripts.build}"`, 'No `build` script in package.json.'));
    checks.push(bool('lockfile', 'Lockfile committed', 1, p.hasLockfile, 'Lockfile present.', 'No lockfile found.'));
  } else {
    checks.push(na('test-script', 'Test script defined', 1, 'No package.json found.'));
  }
  checks.push(bool('lint', 'Lint configuration', 1, p.hasLintConfig, 'Lint config present.', 'No ESLint/Biome configuration found.'));
  checks.push(bool('ci', 'Continuous integration', 1, p.hasCi, 'CI workflow present.', 'No CI configuration found.'));
  checks.push(bool('gitignore', '.gitignore covers env files', 1, p.hasGitignore && p.gitignoreCoversEnv, '.env files are ignored.', p.hasGitignore ? '.gitignore does not list .env files.' : 'No .gitignore file.'));
  checks.push(bool('readme', 'README present', 0.5, p.hasReadme, 'README found.', 'No README in the workspace root.'));
  if (p.usesEnvVars) {
    checks.push(bool('env-example', 'Environment template (.env.example)', 0.5, p.hasEnvExample, 'Template present.', 'Code reads environment variables but no .env.example documents them.'));
  }
  if (i.hasTypeScript) {
    checks.push(bool('ts-strict', 'TypeScript strict mode', 1, p.tsStrict === true, 'strict enabled.', 'strict not enabled.'));
  }
  const unfinished = i.progress.placeholders.filter((x) => x.kind === 'not-implemented' || x.kind === 'empty-function' || x.kind === 'status-501' || x.kind === 'mock-data').length;
  checks.push({ id: 'placeholders', label: 'No unfinished handlers or mock data', weight: 1, credit: unfinished <= 2 ? 1 : Math.max(0, 1 - (unfinished - 2) / 8), status: unfinished <= 2 ? 'passed' : 'failed', detail: `${unfinished} unfinished function(s), 501 responses or mock data sets.` });
  checks.push(bool('deploy', 'Deployment configuration', 0.5, p.hasDeployConfig, 'Deployment/container configuration found.', 'No Dockerfile or platform configuration found (may be configured outside the repo).'));

  const score = weightedScore(checks);
  const verdict = critical
    ? 'Blocked by critical security issues'
    : score === null
      ? 'Not assessed'
      : score >= 80
        ? 'Approaching production readiness'
        : score >= 60
          ? 'Needs work before production'
          : 'Not production ready';
  return {
    id: 'readiness',
    label,
    score,
    grade: grade(score),
    verdict,
    checks,
    caps: critical ? [`${critical} confirmed critical security issue(s) block readiness.`] : [],
    explanation:
      'Weighted checklist of engineering practices commonly expected before production. It is an advisory signal only: runtime configuration, infrastructure, monitoring and business requirements are outside the scope of a static scan.'
  };
}

function notAssessed(id: ScoreAssessment['id'], label: string, reason: string): ScoreAssessment {
  return { id, label, score: null, grade: '—', verdict: 'Not assessed', checks: [], caps: [], explanation: reason };
}

function verdictFor(score: number | null, labels: [string, string, string, string]): string {
  if (score === null) {
    return 'Not assessed';
  }
  return score >= 85 ? labels[0] : score >= 70 ? labels[1] : score >= 50 ? labels[2] : labels[3];
}

export function computeScores(i: ScoringInputs) {
  const quality = scoreQuality(i);
  const security = scoreSecurity(i);
  const implementation = scoreImplementation(i);
  const readiness = scoreReadiness(i, quality, security);
  return { quality, security, implementation, readiness };
}

/** Deterministic, evidence-backed recommended actions. */
export function recommendActions(findings: Finding[], scores: ReturnType<typeof computeScores>): RecommendedAction[] {
  const actions: RecommendedAction[] = [];
  const real = realFindings(findings);
  const groups = new Map<string, Finding[]>();
  for (const f of real) {
    if (SEVERITY_RANK[f.severity] >= SEVERITY_RANK.high && f.status === 'confirmed') {
      const list = groups.get(f.ruleId) ?? [];
      list.push(f);
      groups.set(f.ruleId, list);
    }
  }
  const sorted = [...groups.values()].sort((a, b) => SEVERITY_RANK[b[0].severity] - SEVERITY_RANK[a[0].severity] || b.length - a.length);
  for (const list of sorted.slice(0, 5)) {
    const f = list[0];
    actions.push({
      title: `${f.title} (${list.length})`,
      detail: f.recommendation,
      priority: f.severity === 'critical' ? 'high' : 'medium',
      findingIds: list.slice(0, 50).map((x) => x.id)
    });
  }
  const review = real.filter((f) => f.status === 'needs-review' && SEVERITY_RANK[f.severity] >= SEVERITY_RANK.medium && f.category === 'security');
  if (review.length) {
    actions.push({ title: `Review ${review.length} security item(s) that need application context`, detail: 'These patterns may be safe depending on how the code is used. Confirm or fix each one.', priority: 'medium', findingIds: review.slice(0, 50).map((f) => f.id) });
  }
  for (const c of scores.readiness.checks) {
    if (c.status === 'failed' && c.weight >= 1 && !['security', 'quality'].includes(c.id) && actions.length < 8) {
      actions.push({ title: c.label, detail: c.detail, priority: 'low', findingIds: [] });
    }
  }
  return actions.slice(0, 8);
}
