import type {
  AnalyzerId,
  Confidence,
  DetectionStatus,
  Finding,
  FindingCategory,
  FindingKind,
  Severity
} from '../models/types';
import { SEVERITY_RANK, CONFIDENCE_RANK } from '../models/types';
import { shortHash } from '../utils/hash';
import { safeEvidence } from '../utils/redaction';
import type { FileContext } from './fileContext';

export interface RuleMeta {
  id: string;
  title: string;
  category: FindingCategory;
  severity: Severity;
  confidence: Confidence;
  kind?: FindingKind;
  status?: DetectionStatus;
  analyzer: AnalyzerId;
  description: string;
  recommendation: string;
  impact?: string;
}

export interface FindingLocation {
  file: string;
  uri: string;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
}

export function createFinding(
  rule: RuleMeta,
  location: FindingLocation,
  evidenceLine: string,
  overrides: Partial<Omit<Finding, 'location' | 'id' | 'ruleId'>> = {}
): Finding {
  const evidence = safeEvidence(evidenceLine);
  const finding: Finding = {
    id: '',
    ruleId: rule.id,
    title: rule.title,
    category: rule.category,
    severity: rule.severity,
    confidence: rule.confidence,
    kind: rule.kind ?? 'rule',
    status: rule.status ?? 'confirmed',
    analyzer: rule.analyzer,
    description: rule.description,
    evidence,
    recommendation: rule.recommendation,
    impact: rule.impact,
    location: {
      file: location.file,
      uri: location.uri,
      line: Math.max(1, location.line),
      column: Math.max(1, location.column ?? 1),
      endLine: location.endLine,
      endColumn: location.endColumn
    },
    ...overrides
  };
  finding.id = shortHash(`${rule.id}|${location.file}|${location.line}|${location.column ?? 1}|${evidence}`, 16);
  return finding;
}

/** Convenience wrapper for findings inside a parsed file. */
export function findingAt(
  ctx: FileContext,
  rule: RuleMeta,
  pos: { line: number; column?: number; endLine?: number; endColumn?: number },
  overrides: Partial<Omit<Finding, 'location' | 'id' | 'ruleId'>> = {}
): Finding {
  const lineText = ctx.lines[pos.line - 1] ?? '';
  // Test and fixture files commonly contain deliberate dummy values.
  const isTestCode = ctx.roles.isTest || ctx.roles.isFixtureOrExample;
  const tags = [...(overrides.tags ?? []), ...(isTestCode ? ['test-or-fixture'] : [])];
  return createFinding(rule, { file: ctx.file.displayPath, uri: ctx.file.uri, ...pos }, lineText, {
    ...(isTestCode ? { confidence: 'low' as Confidence } : {}),
    ...overrides,
    tags: tags.length ? tags : undefined
  });
}

export function compareFindings(a: Finding, b: Finding): number {
  return (
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
    CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence] ||
    a.location.file.localeCompare(b.location.file) ||
    a.location.line - b.location.line
  );
}

/** Removes duplicate findings (same rule family at the same location). */
export function dedupeFindings(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const f of findings) {
    const family = f.category === 'security' && f.ruleId.startsWith('secret/') ? 'secret' : f.ruleId;
    const key = `${family}|${f.location.file}|${f.location.line}`;
    const existing = seen.get(key);
    if (!existing || SEVERITY_RANK[f.severity] > SEVERITY_RANK[existing.severity]) {
      seen.set(key, f);
    }
  }
  return [...seen.values()];
}
