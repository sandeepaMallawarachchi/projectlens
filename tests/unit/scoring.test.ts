import { describe, expect, it } from 'vitest';
import { computeScores, densityCredit, securityCredit, grade, type ScoringInputs } from '../../src/scoring/scoring';
import type { Finding } from '../../src/models/types';
import { scanFixture } from './helpers';

const finding = (over: Partial<Finding>): Finding => ({
  id: Math.random().toString(36),
  ruleId: 'sec/sql-injection',
  title: 't',
  category: 'security',
  severity: 'high',
  confidence: 'high',
  kind: 'rule',
  status: 'confirmed',
  analyzer: 'security-ast',
  description: '',
  evidence: '',
  recommendation: '',
  location: { file: 'a.ts', uri: 'file:///a.ts', line: 1, column: 1 },
  ...over
});

const base = (over: Partial<ScoringInputs> = {}): ScoringInputs => ({
  mode: 'full',
  findings: [],
  sourceLines: 2000,
  sourceFilesParsed: 20,
  filesAnalyzed: 30,
  hasTypeScript: true,
  eslintAvailable: true,
  gitleaks: 'disabled',
  technology: { languages: [], technologies: [], dependencies: [], manifests: [] },
  progress: { modules: [], implementationEvidence: null, placeholders: [], routeCount: 0, apiEndpointCount: 0, componentCount: 0, testFileCount: 3, limitations: [] },
  project: {
    hasPackageJson: true,
    scripts: { test: 'vitest', build: 'tsc' },
    hasLintConfig: true,
    hasCi: true,
    hasLockfile: true,
    hasGitignore: true,
    gitignoreCoversEnv: true,
    hasReadme: true,
    hasEnvExample: true,
    usesEnvVars: true,
    hasDeployConfig: true,
    tsStrict: true
  },
  ...over
});

describe('scoring', () => {
  it('awards density credit linearly between threshold and 4× threshold', () => {
    expect(densityCredit(1, 2)).toBe(1);
    expect(densityCredit(2, 2)).toBe(1);
    expect(densityCredit(5, 2)).toBe(0.5);
    expect(densityCredit(8, 2)).toBe(0);
  });

  it('weights confirmed versus needs-review security findings', () => {
    expect(securityCredit([]).credit).toBe(1);
    expect(securityCredit([finding({ severity: 'critical' })]).credit).toBe(0);
    expect(securityCredit([finding({ severity: 'medium' })]).credit).toBe(0.5);
    expect(securityCredit([finding({ severity: 'high', status: 'needs-review' })]).credit).toBe(0.5);
    expect(securityCredit([finding({ severity: 'low', status: 'needs-review' })]).credit).toBe(0.75);
    expect(securityCredit([finding({ severity: 'info' })]).credit).toBe(1);
  });

  it('produces a perfect deterministic score for a clean project', () => {
    const s = computeScores(base());
    expect(s.security.score).toBe(100);
    expect(s.quality.score).toBe(100);
    expect(s.readiness.score).toBe(100);
    expect(computeScores(base())).toEqual(s);
  });

  it('caps security at 40 when a confirmed critical issue exists', () => {
    const s = computeScores(base({ findings: [finding({ ruleId: 'secret/aws-access-key', severity: 'critical' })] }));
    expect(s.security.score).toBeLessThanOrEqual(40);
    expect(s.security.caps[0]).toMatch(/critical/);
    expect(s.readiness.verdict).toBe('Blocked by critical security issues');
  });

  it('caps security at 70 for confirmed high issues', () => {
    const s = computeScores(base({ findings: [finding({ ruleId: 'sec/tls-verification-disabled', severity: 'high' })] }));
    expect(s.security.score).toBe(70);
  });

  it('ignores test/fixture findings in scores', () => {
    const s = computeScores(base({ findings: [finding({ severity: 'critical', ruleId: 'secret/aws-access-key', tags: ['test-or-fixture'] })] }));
    expect(s.security.score).toBe(100);
  });

  it('reports "Not assessed" instead of inventing numbers', () => {
    const quick = computeScores(base({ mode: 'quick' }));
    expect(quick.quality.score).toBeNull();
    expect(quick.quality.verdict).toBe('Not assessed');
    expect(quick.security.checks.filter((c) => c.status === 'skipped').length).toBeGreaterThan(0);
    const empty = computeScores(base({ sourceLines: 10, filesAnalyzed: 0 }));
    expect(empty.quality.score).toBeNull();
    expect(empty.security.score).toBeNull();
    expect(empty.implementation.score).toBeNull();
    expect(grade(null)).toBe('—');
  });

  it('records applicable, failed, unavailable and skipped checks', () => {
    const s = computeScores(base({ eslintAvailable: false, gitleaks: 'unavailable', hasTypeScript: false }));
    const statuses = (a: typeof s.quality) => Object.fromEntries(a.checks.map((c) => [c.id, c.status]));
    expect(statuses(s.quality).lint).toBe('unavailable');
    expect(statuses(s.quality)['type-safety']).toBe('skipped');
    expect(statuses(s.security).gitleaks).toBe('unavailable');
  });

  it('explains every score in fixture scans', async () => {
    const r = await scanFixture('vulnerable-app');
    for (const a of Object.values(r.scores)) {
      expect(a.explanation.length).toBeGreaterThan(20);
      if (a.score !== null) {
        expect(a.checks.length).toBeGreaterThan(0);
      }
    }
    expect(r.recommendedActions.length).toBeGreaterThan(0);
    expect(r.recommendedActions[0].findingIds.length).toBeGreaterThan(0);
  });
});
