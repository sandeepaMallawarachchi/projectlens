import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { AnalyzerId, Finding, LanguageStat, RequirementFeature, ScanMode, ScanResult, Severity } from '../models/types';
import { SEVERITY_RANK } from '../models/types';
import { discoverFiles, type DiscoveredFile } from './fileDiscovery';
import { createFileContext, type FileContext } from './fileContext';
import { isJsTs, SOURCE_LANGUAGES } from './languages';
import { compareFindings, dedupeFindings } from './findings';
import { AnalysisCache, type CachedFileAnalysis } from './cache';
import { throwIfCancelled, yieldToEventLoop } from '../utils/async';
import { shortHash } from '../utils/hash';
import { fileUri } from '../utils/paths';
import { analyzeSecrets } from '../analyzers/security/secretsAnalyzer';
import { analyzeEnvironment, analyzeEnvIgnoreStatus, analyzeCredentialFiles } from '../analyzers/security/environmentAnalyzer';
import { analyzeSecurityAst } from '../analyzers/security/securityAstRules';
import { analyzeConfigFiles, isConfigTarget } from '../analyzers/security/configAnalyzer';
import { analyzeAuthorization, refineAuthorizationFindings } from '../analyzers/security/authorization';
import { resolveGitleaks, runGitleaks } from '../analyzers/security/gitleaksAdapter';
import { analyzeQualityAst } from '../analyzers/quality/qualityAstRules';
import { runEslint, eslintAvailability } from '../analyzers/quality/eslintRunner';
import { analyzeMarkers } from '../analyzers/quality/markers';
import { findDuplicates } from '../analyzers/quality/duplicates';
import { extractFacts, emptyFacts, packageNameFromSpecifier, AUTH_MIDDLEWARE_NAME, type FileFacts } from '../analyzers/progress/facts';
import { estimateProgress } from '../analyzers/progress/progressEstimator';
import { parseRequirements, REQUIREMENTS_FILE } from '../analyzers/progress/requirements';
import { collectManifests } from '../analyzers/technology/manifests';
import { detectTechnologies } from '../analyzers/technology/detector';
import { TECHNOLOGIES } from '../analyzers/technology/catalog';
import { analyzeDependencies } from '../analyzers/dependencies/dependencyAnalyzer';
import { computeScores, recommendActions } from '../scoring/scoring';

export interface ScanProgress {
  phase: string;
  processed: number;
  total: number;
}

export interface ScanOptions {
  roots: { name: string; path: string }[];
  mode: ScanMode;
  respectGitignore: boolean;
  extraExcludes: string[];
  maxFileSizeBytes: number;
  maxFiles: number;
  gitleaks: { enabled: boolean; trusted: boolean; path: string; timeoutMs: number };
  cache?: AnalysisCache;
  signal?: AbortSignal;
  onProgress?: (p: ScanProgress) => void;
}

export const MAX_STORED_FINDINGS = 5000;

const CONTENT_SIGNALS = TECHNOLOGIES.filter((t) => t.content).map((t) => ({ id: t.id, ...t.content! }));

/** Regex import extraction for Quick Scan (no AST). */
function quickFacts(ctx: FileContext): FileFacts {
  const facts = emptyFacts(ctx.lines.length);
  const imports = new Set<string>();
  const re = /(?:import\s+(type\s+)?[^'"]*?from\s*|import\s*\(\s*|require\s*\(\s*|export\s[^'"]*?from\s*)['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(ctx.text)) !== null) {
    if (m[1]) {
      continue; // type-only imports do not indicate runtime usage
    }
    const pkg = packageNameFromSpecifier(m[2]);
    if (pkg) {
      imports.add(pkg);
    }
  }
  facts.imports = [...imports];
  facts.hasJsx = /\.(jsx|tsx)$/.test(ctx.file.relPath) && /<[A-Za-z][\w.]*[\s/>]/.test(ctx.text);
  const envRe = /(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g;
  const env = new Set<string>();
  while ((m = envRe.exec(ctx.text)) !== null) {
    env.add(m[1]);
  }
  facts.envVars = [...env];
  return facts;
}

async function readTextFile(file: DiscoveredFile): Promise<string | null> {
  try {
    const buf = await fs.readFile(file.absPath);
    const head = buf.subarray(0, 8192);
    if (head.includes(0)) {
      return null;
    }
    return buf.toString('utf8');
  } catch {
    return null;
  }
}

function analyzeFile(ctx: FileContext, mode: ScanMode, trackedEnv: boolean): CachedFileAnalysis {
  const findings: Finding[] = [];
  const full = mode === 'full';
  const jsTs = isJsTs(ctx.file.relPath);
  findings.push(...analyzeSecrets(ctx));
  findings.push(...analyzeEnvironment(ctx, { trackedEnv }));
  if (isConfigTarget(ctx.file.relPath)) {
    findings.push(...analyzeConfigFiles(ctx));
  }
  let facts: FileFacts;
  let lintError: string | undefined;
  let markerPlaceholders: CachedFileAnalysis['markerPlaceholders'] = [];
  if (full) {
    const markers = analyzeMarkers(ctx);
    findings.push(...markers.findings);
    markerPlaceholders = markers.placeholders;
    facts = jsTs || /\.prisma$/.test(ctx.file.relPath) ? extractFacts(ctx, { duplicates: true }) : emptyFacts(ctx.lines.length);
    if (jsTs && ctx.sourceFile) {
      findings.push(...analyzeSecurityAst(ctx));
      findings.push(...analyzeQualityAst(ctx).findings);
      findings.push(...analyzeAuthorization(ctx, facts));
      const lint = runEslint(ctx);
      findings.push(...lint.findings);
      lintError = lint.error;
    }
  } else {
    facts = jsTs ? quickFacts(ctx) : /\.prisma$/.test(ctx.file.relPath) ? extractFacts(ctx, { duplicates: false }) : emptyFacts(ctx.lines.length);
  }
  const contentSignals = CONTENT_SIGNALS.filter((s) => s.files.test(ctx.file.relPath) && s.pattern.test(ctx.text)).map((s) => s.id);
  const apiProxy =
    (/(^|\/)next\.config\.[cm]?[jt]s$/.test(ctx.file.relPath) && /\brewrites\s*\(|\brewrites\s*:/.test(ctx.text)) ||
    (/(^|\/)vite\.config\.[cm]?[jt]s$/.test(ctx.file.relPath) && /\bproxy\s*:/.test(ctx.text));
  return {
    stamp: '',
    findings,
    facts,
    roles: ctx.roles,
    lines: ctx.lines.length,
    parsed: !!ctx.sourceFile,
    lintError,
    contentSignals,
    markerPlaceholders,
    apiProxy
  };
}

export async function scanWorkspace(options: ScanOptions): Promise<ScanResult> {
  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const { mode, signal } = options;
  const report = (phase: string, processed: number, total: number) => options.onProgress?.({ phase, processed, total });
  const warnings: string[] = [];
  const analyzersUnavailable: ScanResult['coverage']['analyzersUnavailable'] = [];

  report('Discovering files', 0, 0);
  const discovery = await discoverFiles({
    roots: options.roots,
    respectGitignore: options.respectGitignore,
    extraExcludes: options.extraExcludes,
    maxFileSizeBytes: options.maxFileSizeBytes,
    maxFiles: options.maxFiles,
    signal,
    onProgress: (n) => report('Discovering files', n, 0)
  });
  if (discovery.truncated) {
    warnings.push(`File limit reached (${options.maxFiles} per folder); some files were not analyzed. Increase projectlens.scan.maxFiles to scan more.`);
  }
  throwIfCancelled(signal);

  report('Reading manifests', 0, 0);
  const manifests = await collectManifests(discovery.files, options.roots.map((r) => r.path));
  warnings.push(...manifests.warnings);

  const trackedEnvFiles = new Set(discovery.envFiles.filter((e) => !e.gitignored).map((e) => e.file.relPath));
  const analyzable = discovery.files.filter((f) => !f.binary && !f.tooLarge);
  const results: { file: DiscoveredFile; analysis: CachedFileAnalysis }[] = [];
  const cache = options.cache;
  let cacheHits = 0;
  let lintErrors = 0;
  const manifestTexts = new Map<string, string>();

  for (let i = 0; i < analyzable.length; i++) {
    if (i % 10 === 0) {
      throwIfCancelled(signal);
      report('Analyzing files', i, analyzable.length);
      await yieldToEventLoop();
    }
    const file = analyzable[i];
    const stamp = AnalysisCache.stamp(file.mtimeMs, file.size, mode) + (trackedEnvFiles.has(file.relPath) ? ':tracked' : '');
    const cached = cache?.get(file.uri, stamp);
    if (/(^|\/)package\.json$/.test(file.relPath)) {
      const text = await readTextFile(file);
      if (text) {
        manifestTexts.set(file.displayPath, text);
      }
    }
    if (cached) {
      cacheHits++;
      results.push({ file, analysis: cached });
      continue;
    }
    const text = await readTextFile(file);
    if (text === null) {
      continue;
    }
    const ctx = createFileContext(file, text, mode === 'full');
    const analysis = analyzeFile(ctx, mode, trackedEnvFiles.has(file.relPath));
    analysis.stamp = stamp;
    cache?.set(file.uri, analysis);
    results.push({ file, analysis });
  }
  cache?.retain(new Set(analyzable.map((f) => f.uri)));
  throwIfCancelled(signal);
  report('Cross-file analysis', analyzable.length, analyzable.length);

  let findings: Finding[] = results.flatMap((r) => r.analysis.findings);
  lintErrors = results.filter((r) => r.analysis.lintError).length;
  if (lintErrors) {
    warnings.push(`${lintErrors} file(s) could not be linted (parse errors or unsupported syntax).`);
  }

  findings.push(...analyzeCredentialFiles(discovery.files));
  findings.push(...analyzeEnvIgnoreStatus(discovery.envFiles, manifests.hasGitignore));
  findings.push(...analyzeDependencies(manifests, manifestTexts));

  const analyzersRun: AnalyzerId[] = ['secrets', 'environment', 'configuration', 'dependencies', 'progress'];
  const eslint = eslintAvailability();
  if (mode === 'full') {
    analyzersRun.push('security-ast', 'quality-ast', 'markers', 'duplicates');
    if (eslint.available) {
      analyzersRun.push('eslint');
    } else {
      analyzersUnavailable.push({ analyzer: 'eslint', reason: eslint.reason ?? 'unavailable' });
    }
    findings.push(
      ...findDuplicates(
        results
          .filter((r) => r.analysis.facts.duplicateHashes.length)
          .map((r) => ({ file: r.file.displayPath, uri: r.file.uri, hashes: r.analysis.facts.duplicateHashes, isTest: r.analysis.roles.isTest }))
      )
    );
    const middleware = results.find((r) => /^(src\/)?middleware\.[cm]?[jt]s$/.test(r.file.relPath) && r.analysis.facts.hasAuthSignal);
    const globalAuth = results.find((r) => r.analysis.facts.useCalls.some((u) => !u.path && u.names.some((n) => AUTH_MIDDLEWARE_NAME.test(n))));
    findings = refineAuthorizationFindings(findings, {
      nextMiddlewareWithAuth: middleware?.file.displayPath ?? null,
      globalExpressAuth: globalAuth?.file.displayPath ?? null,
      expressFiles: results.filter((r) => r.analysis.facts.imports.includes('express') && !r.analysis.roles.isTest).map((r) => ({ file: r.file.displayPath, uri: r.file.uri })),
      helmetUsed: results.some((r) => r.analysis.facts.imports.includes('helmet'))
    });
  }

  // Optional Gitleaks
  let gitleaksState: 'ran' | 'disabled' | 'unavailable' | 'untrusted' = 'disabled';
  if (mode === 'full' && options.gitleaks.enabled) {
    if (!options.gitleaks.trusted) {
      gitleaksState = 'untrusted';
      analyzersUnavailable.push({ analyzer: 'gitleaks', reason: 'Workspace is not trusted.' });
    } else {
      report('Running Gitleaks', 0, 0);
      const exe = await resolveGitleaks(options.gitleaks.path);
      if (!exe) {
        gitleaksState = 'unavailable';
        analyzersUnavailable.push({ analyzer: 'gitleaks', reason: options.gitleaks.path ? `Not an executable: ${options.gitleaks.path}` : 'gitleaks not found on PATH.' });
      } else {
        const res = await runGitleaks(exe, options.roots, { timeoutMs: options.gitleaks.timeoutMs, signal });
        throwIfCancelled(signal);
        if (res.status === 'ok') {
          gitleaksState = 'ran';
          analyzersRun.push('gitleaks');
          findings.push(...res.findings);
        } else {
          gitleaksState = 'unavailable';
          analyzersUnavailable.push({ analyzer: 'gitleaks', reason: res.message ?? res.status });
          warnings.push(`Gitleaks failed: ${res.message ?? res.status}`);
        }
      }
    }
  }

  // Technology detection
  report('Detecting technologies', 0, 0);
  const imports = new Map<string, { file: string; uri: string }[]>();
  const contentSignals = new Map<string, { file: string; uri: string }[]>();
  for (const r of results) {
    for (const pkg of r.analysis.facts.imports) {
      const list = imports.get(pkg) ?? [];
      list.push({ file: r.file.displayPath, uri: r.file.uri });
      imports.set(pkg, list);
    }
    for (const id of r.analysis.contentSignals) {
      const list = contentSignals.get(id) ?? [];
      list.push({ file: r.file.displayPath, uri: r.file.uri });
      contentSignals.set(id, list);
    }
  }
  const langStats = new Map<string, LanguageStat>();
  const linesByUri = new Map(results.map((r) => [r.file.uri, r.analysis.lines]));
  for (const f of discovery.files) {
    if (!f.language) {
      continue;
    }
    const stat = langStats.get(f.language) ?? { language: f.language, files: 0, lines: 0 };
    stat.files++;
    stat.lines += linesByUri.get(f.uri) ?? 0;
    langStats.set(f.language, stat);
  }
  const languages = [...langStats.values()].sort((a, b) => b.lines - a.lines || b.files - a.files);
  const technology = detectTechnologies({ files: discovery.files, manifests, imports, contentSignals, languages });

  // Requirements & progress
  report('Estimating progress', 0, 0);
  let requirements: { file: string; features: RequirementFeature[]; errors: string[] } | undefined;
  const reqRoot = options.roots[0];
  if (reqRoot) {
    try {
      const text = await fs.readFile(path.join(reqRoot.path, REQUIREMENTS_FILE), 'utf8');
      const parsed = parseRequirements(text);
      requirements = { file: REQUIREMENTS_FILE, ...parsed };
      if (parsed.errors.length) {
        warnings.push(`${REQUIREMENTS_FILE} is invalid: ${parsed.errors.slice(0, 3).join('; ')}`);
        if (!parsed.features.length) {
          requirements = undefined;
        }
      }
    } catch {
      requirements = undefined;
    }
  }
  const dbTech = technology.technologies.some((t) => ['database', 'orm'].includes(t.category) && t.usage !== 'declared');
  const progress = estimateProgress({
    files: results.map((r) => ({ file: r.file, roles: r.analysis.roles, facts: r.analysis.facts })),
    markerPlaceholders: results.flatMap((r) => r.analysis.markerPlaceholders),
    requirements,
    hasApiProxy: results.some((r) => r.analysis.apiProxy),
    hasDatabase: dbTech
  });
  if (mode === 'quick') {
    progress.limitations.unshift('Quick Scan: modules are inferred from file structure only; placeholders, TODOs and UI→API connections require a Full Scan.');
  }

  // Finalize findings
  findings = dedupeFindings(findings).sort(compareFindings);
  const findingsTruncated = findings.length > MAX_STORED_FINDINGS;
  if (findingsTruncated) {
    warnings.push(`${findings.length} findings were produced; only the ${MAX_STORED_FINDINGS} most severe are kept.`);
    findings = findings.slice(0, MAX_STORED_FINDINGS);
  }

  const jsTsResults = results.filter((r) => isJsTs(r.file.relPath));
  const sourceLines = jsTsResults.reduce((s, r) => s + r.analysis.lines, 0);
  const rootPkg = manifests.packages.find((p) => p.file.relPath === 'package.json') ?? manifests.packages[0];
  const scores = computeScores({
    mode,
    findings,
    sourceLines,
    sourceFilesParsed: jsTsResults.filter((r) => r.analysis.parsed).length,
    filesAnalyzed: results.length,
    hasTypeScript: jsTsResults.some((r) => /\.[cm]?tsx?$/.test(r.file.relPath)),
    eslintAvailable: eslint.available,
    gitleaks: gitleaksState,
    technology,
    progress,
    project: {
      hasPackageJson: !!rootPkg,
      scripts: rootPkg?.scripts ?? {},
      hasLintConfig: manifests.hasLintConfig,
      hasCi: manifests.hasCi,
      hasLockfile: manifests.lockfiles.length > 0,
      hasGitignore: [...manifests.hasGitignore.values()].some(Boolean),
      gitignoreCoversEnv: manifests.gitignoreCoversEnv,
      hasReadme: manifests.hasReadme,
      hasEnvExample: manifests.hasEnvExample,
      usesEnvVars: results.some((r) => r.analysis.facts.envVars.length > 0),
      hasDeployConfig: manifests.hasDockerfile || manifests.hasDeployConfig,
      tsStrict: manifests.tsconfig?.strict
    }
  });

  const otherLanguages = languages.filter((l) => SOURCE_LANGUAGES.has(l.language) && !['TypeScript', 'JavaScript'].includes(l.language));
  if (otherLanguages.length) {
    warnings.push(`Only secret, environment and configuration rules apply to ${otherLanguages.map((l) => l.language).join(', ')} files; AST analysis supports JavaScript/TypeScript.`);
  }
  if (!options.gitleaks.trusted) {
    warnings.push('Workspace is not trusted: external scanners are disabled.');
  }

  const skipped = [...discovery.skipped.entries()].map(([reason, count]) => ({ reason, count }));
  const finished = Date.now();
  const rootName = options.roots.length === 1 ? options.roots[0].name : `${options.roots[0]?.name ?? 'workspace'} (+${options.roots.length - 1})`;

  return {
    version: 1,
    id: shortHash(`${startedAt}|${rootName}|${mode}`, 12),
    mode,
    startedAt,
    finishedAt: new Date(finished).toISOString(),
    projectName: rootPkg?.name ?? rootName,
    roots: options.roots.map((r) => ({ name: r.name, uri: fileUri(r.path) })),
    technology,
    findings,
    findingsTruncated,
    progress,
    scores,
    coverage: {
      roots: options.roots.map((r) => r.name),
      filesDiscovered: discovery.files.length,
      filesAnalyzed: results.length,
      sourceFilesParsed: jsTsResults.filter((r) => r.analysis.parsed).length,
      linesAnalyzed: results.reduce((s, r) => s + r.analysis.lines, 0),
      skipped,
      analyzersRun,
      analyzersUnavailable,
      cacheHits,
      durationMs: finished - started
    },
    warnings,
    recommendedActions: recommendActions(findings, scores)
  };
}

export function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    counts[f.severity]++;
  }
  return counts;
}

export function topSeverity(findings: Finding[]): Severity | null {
  return findings.reduce<Severity | null>((acc, f) => (!acc || SEVERITY_RANK[f.severity] > SEVERITY_RANK[acc] ? f.severity : acc), null);
}
