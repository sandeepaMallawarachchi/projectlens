/**
 * Core domain model shared by the extension host and the dashboard webview.
 * This module must stay free of Node.js and VS Code imports.
 */

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export const FINDING_CATEGORIES = ['security', 'quality', 'progress', 'dependency', 'configuration'] as const;
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];

/** `confirmed`: the rule matched concrete evidence. `needs-review`: requires application-wide context. */
export type DetectionStatus = 'confirmed' | 'needs-review';

/** `rule`: deterministic violation. `recommendation`: subjective best-practice advice. */
export type FindingKind = 'rule' | 'recommendation';

export type AnalyzerId =
  | 'secrets'
  | 'security-ast'
  | 'environment'
  | 'quality-ast'
  | 'eslint'
  | 'markers'
  | 'duplicates'
  | 'dependencies'
  | 'gitleaks'
  | 'progress'
  | 'configuration';

export interface SourceLocation {
  /** Workspace-relative path using forward slashes (prefixed with the folder name in multi-root workspaces). */
  file: string;
  /** Absolute file URI (`file:///…`). */
  uri: string;
  /** 1-based line. */
  line: number;
  /** 1-based column. */
  column: number;
  endLine?: number;
  endColumn?: number;
}

export interface Finding {
  id: string;
  ruleId: string;
  title: string;
  category: FindingCategory;
  severity: Severity;
  confidence: Confidence;
  kind: FindingKind;
  status: DetectionStatus;
  analyzer: AnalyzerId;
  description: string;
  /** Redacted, single-line evidence snippet. Never contains a full secret value. */
  evidence: string;
  recommendation: string;
  /** Security findings: the potential impact. */
  impact?: string;
  location: SourceLocation;
  tags?: string[];
}

export type TechnologyCategory =
  | 'language'
  | 'frontend'
  | 'backend'
  | 'fullstack'
  | 'database'
  | 'orm'
  | 'auth'
  | 'ui'
  | 'testing'
  | 'tooling'
  | 'infrastructure'
  | 'cloud'
  | 'ai'
  | 'state'
  | 'validation';

export type TechnologyUsage = 'used' | 'configured' | 'declared';

export interface TechnologyEvidence {
  kind: 'dependency' | 'devDependency' | 'import' | 'config-file' | 'script' | 'file-pattern' | 'lockfile';
  detail: string;
  file?: string;
  uri?: string;
  line?: number;
}

export interface Technology {
  id: string;
  name: string;
  category: TechnologyCategory;
  version?: string;
  resolvedVersion?: string;
  usage: TechnologyUsage;
  confidence: Confidence;
  evidence: TechnologyEvidence[];
  importCount: number;
}

export interface LanguageStat {
  language: string;
  files: number;
  lines: number;
}

export interface DependencyInfo {
  name: string;
  range: string;
  resolved?: string;
  dev: boolean;
  manifest: string;
}

export interface TechnologyReport {
  languages: LanguageStat[];
  technologies: Technology[];
  packageManager?: string;
  primaryFramework?: string;
  dependencies: DependencyInfo[];
  manifests: string[];
}

export type ModuleStatus = 'implemented' | 'partial' | 'not-detected';

export interface ModuleEvidenceItem {
  kind:
    | 'page'
    | 'api-route'
    | 'component'
    | 'service'
    | 'model'
    | 'test'
    | 'placeholder'
    | 'todo'
    | 'mock-data'
    | 'missing-endpoint'
    | 'auth'
    | 'data-access';
  detail: string;
  file: string;
  uri: string;
  line: number;
}

export interface FunctionalModule {
  id: string;
  name: string;
  status: ModuleStatus;
  /** 0–100 heuristic estimate of implementation completeness based on evidence. */
  completion: number;
  layers: { ui: boolean; api: boolean; data: boolean; tests: boolean };
  fileCount: number;
  evidence: ModuleEvidenceItem[];
  reasons: string[];
}

export interface RequirementFeature {
  id: string;
  name: string;
  weight: number;
  description?: string;
  match?: string[];
  paths?: string[];
}

export interface RequirementResult {
  feature: RequirementFeature;
  status: ModuleStatus;
  completion: number;
  matchedModules: string[];
}

export interface PlaceholderLocation {
  kind: 'not-implemented' | 'empty-function' | 'mock-data' | 'status-501' | 'todo' | 'fixme' | 'placeholder-text';
  detail: string;
  file: string;
  uri: string;
  line: number;
}

export interface ProgressReport {
  modules: FunctionalModule[];
  /** Mean module completion (only when no requirements file exists). */
  implementationEvidence: number | null;
  requirements?: {
    file: string;
    results: RequirementResult[];
    /** Σ(weight × completion) / Σ(weight) */
    weightedCompletion: number;
    errors: string[];
  };
  placeholders: PlaceholderLocation[];
  routeCount: number;
  apiEndpointCount: number;
  componentCount: number;
  testFileCount: number;
  limitations: string[];
}

export type CheckStatus = 'passed' | 'failed' | 'unavailable' | 'skipped';

export interface ScoreCheck {
  id: string;
  label: string;
  status: CheckStatus;
  weight: number;
  /** 0–1 credit awarded (passed = 1). */
  credit: number;
  detail: string;
}

export interface ScoreAssessment {
  id: 'quality' | 'security' | 'implementation' | 'readiness';
  label: string;
  /** null when not assessed / insufficient data. */
  score: number | null;
  grade: string;
  verdict: string;
  checks: ScoreCheck[];
  caps: string[];
  explanation: string;
}

export interface ScanCoverage {
  roots: string[];
  filesDiscovered: number;
  filesAnalyzed: number;
  sourceFilesParsed: number;
  linesAnalyzed: number;
  skipped: { reason: string; count: number }[];
  analyzersRun: AnalyzerId[];
  analyzersUnavailable: { analyzer: AnalyzerId; reason: string }[];
  cacheHits: number;
  durationMs: number;
}

export type ScanMode = 'quick' | 'full';

export interface ScanResult {
  version: 1;
  id: string;
  mode: ScanMode;
  startedAt: string;
  finishedAt: string;
  projectName: string;
  roots: { name: string; uri: string }[];
  technology: TechnologyReport;
  findings: Finding[];
  /** True when the findings list was truncated to keep storage bounded. */
  findingsTruncated: boolean;
  progress: ProgressReport;
  scores: {
    quality: ScoreAssessment;
    security: ScoreAssessment;
    implementation: ScoreAssessment;
    readiness: ScoreAssessment;
  };
  coverage: ScanCoverage;
  warnings: string[];
  recommendedActions: RecommendedAction[];
}

export interface RecommendedAction {
  title: string;
  detail: string;
  priority: 'high' | 'medium' | 'low';
  findingIds: string[];
}

export interface ScanHistoryEntry {
  id: string;
  mode: ScanMode;
  finishedAt: string;
  durationMs: number;
  filesAnalyzed: number;
  findingCounts: Record<Severity, number>;
  securityCount: number;
  qualityCount: number;
  scores: { quality: number | null; security: number | null; implementation: number | null; readiness: number | null };
}

export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };
export const CONFIDENCE_RANK: Record<Confidence, number> = { high: 2, medium: 1, low: 0 };
