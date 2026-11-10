import type { Finding, FunctionalModule, ScanResult } from '../models/types';
import type { AITask } from '../models/ai';
import { SEVERITY_RANK } from '../models/types';
import { redactPrivateKeyBlocks, redactText } from '../utils/redaction';

/** Files that are never sent to a cloud model, regardless of task. */
export const AI_EXCLUDED_FILES: { regex: RegExp; reason: string }[] = [
  { regex: /(^|\/)\.env(\.[\w.-]+)?$/, reason: 'environment file' },
  { regex: /\.(pem|key|p12|pfx|jks|keystore|crt|cer)$/i, reason: 'key or certificate' },
  { regex: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, reason: 'SSH key' },
  { regex: /(^|\/)(credentials|client_secret[\w-]*|service[-_]?account[\w-]*)\.json$/i, reason: 'credential file' },
  { regex: /(^|\/)(\.npmrc|\.pypirc|\.netrc|\.htpasswd|\.pgpass)$/, reason: 'credential configuration' },
  { regex: /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/, reason: 'lockfile' },
  { regex: /\.min\.(js|css)$|\.map$/, reason: 'generated file' },
  { regex: /(^|\/)(node_modules|dist|build|\.next|coverage)\//, reason: 'generated directory' }
];

export function exclusionReason(path: string): string | null {
  return AI_EXCLUDED_FILES.find((e) => e.regex.test(path))?.reason ?? null;
}

export const estimateTokens = (text: string) => Math.ceil(text.length / 3.5);

export interface ContextFile {
  path: string;
  uri: string;
  content: string;
  startLine: number;
  endLine: number;
  truncated: boolean;
  redactions: number;
}

export interface BuiltContext {
  task: AITask;
  title: string;
  target?: string;
  /** Compact local analysis summary (always included). */
  summary: string;
  files: ContextFile[];
  excluded: { path: string; reason: string }[];
  redactions: number;
  estimatedTokens: number;
  /** Display paths the model is allowed to reference. */
  allowedPaths: Set<string>;
  uriByPath: Map<string, string>;
}

export interface ContextRequest {
  task: AITask;
  scan: ScanResult;
  findingId?: string;
  moduleId?: string;
  fileUri?: string;
  /** Workspace-relative display path for `fileUri` when known. */
  filePath?: string;
}

export type FileReader = (uri: string) => Promise<string | null>;

function sanitize(text: string): { text: string; redactions: number } {
  const keys = redactPrivateKeyBlocks(text);
  const { text: out, redactions } = redactText(keys, 'marker');
  return { text: out, redactions: redactions + (keys !== text ? 1 : 0) };
}

function compactFinding(f: Finding): string {
  return `- [${f.severity}/${f.confidence}${f.status === 'needs-review' ? '/needs-review' : ''}] ${f.ruleId} — ${f.title} @ ${f.location.file}:${f.location.line} — evidence: ${f.evidence}`;
}

function summarize(scan: ScanResult, opts: { findings: Finding[]; modules?: FunctionalModule[]; placeholders?: boolean }): string {
  const s = scan.scores;
  const score = (a: { label: string; score: number | null; verdict: string }) => `${a.label}: ${a.score ?? 'not assessed'} (${a.verdict})`;
  const lines: string[] = [];
  lines.push(`Project: ${scan.projectName} · ${scan.mode} scan at ${scan.finishedAt}`);
  lines.push(`Primary framework: ${scan.technology.primaryFramework ?? 'unknown'} · package manager: ${scan.technology.packageManager ?? 'unknown'}`);
  lines.push(`Languages: ${scan.technology.languages.slice(0, 6).map((l) => `${l.language} ${l.files} files`).join(', ')}`);
  lines.push(`Technologies: ${scan.technology.technologies.filter((t) => t.usage !== 'declared').map((t) => `${t.name}${t.version ? `@${t.version}` : ''}`).join(', ') || 'none detected'}`);
  const declared = scan.technology.technologies.filter((t) => t.usage === 'declared').map((t) => t.name);
  if (declared.length) {
    lines.push(`Declared but no usage found: ${declared.join(', ')}`);
  }
  lines.push(`Scores (deterministic, local): ${[s.quality, s.security, s.implementation, s.readiness].map(score).join(' · ')}`);
  lines.push(`Coverage: ${scan.coverage.filesAnalyzed}/${scan.coverage.filesDiscovered} files, ${scan.coverage.sourceFilesParsed} JS/TS parsed, analyzers: ${scan.coverage.analyzersRun.join(', ')}`);
  const failed = [...s.readiness.checks, ...s.security.checks].filter((c) => c.status === 'failed').map((c) => `${c.label} (${c.detail})`);
  if (failed.length) {
    lines.push('Failed checks:', ...failed.slice(0, 15).map((f) => `- ${f}`));
  }
  const modules = opts.modules ?? scan.progress.modules;
  if (modules.length) {
    lines.push('Detected modules (heuristic):');
    for (const m of modules.slice(0, 25)) {
      const layers = Object.entries(m.layers).filter(([, v]) => v).map(([k]) => k).join('+') || 'none';
      lines.push(`- ${m.name} [${m.status}, ${m.completion}%, layers: ${layers}] — ${m.reasons.slice(0, 2).join('; ')}`);
    }
  }
  if (opts.placeholders && scan.progress.placeholders.length) {
    lines.push('Placeholders / unfinished markers:');
    for (const p of scan.progress.placeholders.slice(0, 30)) {
      lines.push(`- ${p.kind} @ ${p.file}:${p.line} — ${p.detail}`);
    }
  }
  if (opts.findings.length) {
    lines.push(`Local findings (${opts.findings.length} shown, evidence redacted):`, ...opts.findings.map(compactFinding));
  }
  return sanitize(lines.join('\n')).text;
}

/** Resolves a display path (prefixed with the folder name in multi-root workspaces) to a file URI. */
export function uriForDisplayPath(scan: ScanResult, displayPath: string): string | undefined {
  if (scan.roots.length === 1) {
    return `${scan.roots[0].uri.replace(/\/$/, '')}/${displayPath.split('/').map(encodeURIComponent).join('/')}`;
  }
  const root = scan.roots.find((r) => displayPath.startsWith(`${r.name}/`));
  if (!root) {
    return undefined;
  }
  const rel = displayPath.slice(root.name.length + 1);
  return `${root.uri.replace(/\/$/, '')}/${rel.split('/').map(encodeURIComponent).join('/')}`;
}

function topFindings(findings: Finding[], n: number, filter: (f: Finding) => boolean = () => true): Finding[] {
  return findings
    .filter((f) => filter(f) && !f.tags?.includes('test-or-fixture'))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])
    .slice(0, n);
}

/** Builds the minimal, redacted context for a task within a token budget. */
export async function buildContext(req: ContextRequest, read: FileReader, budgetTokens: number): Promise<BuiltContext> {
  const { scan } = req;
  const ctx: BuiltContext = {
    task: req.task,
    title: '',
    summary: '',
    files: [],
    excluded: [],
    redactions: 0,
    estimatedTokens: 0,
    allowedPaths: new Set(),
    uriByPath: new Map()
  };
  const budgetChars = Math.floor(budgetTokens * 3.5);
  let used = 0;

  const addSnippet = async (path: string, uri: string, around?: { line: number; radius: number }, maxChars?: number): Promise<boolean> => {
    const reason = exclusionReason(path);
    if (reason) {
      if (!ctx.excluded.some((e) => e.path === path)) {
        ctx.excluded.push({ path, reason });
      }
      return false;
    }
    if (ctx.files.some((f) => f.path === path && !around)) {
      return false;
    }
    const raw = await read(uri);
    if (raw === null) {
      ctx.excluded.push({ path, reason: 'unreadable' });
      return false;
    }
    const all = raw.split(/\r?\n/);
    let start = 1;
    let end = all.length;
    if (around) {
      start = Math.max(1, around.line - around.radius);
      end = Math.min(all.length, around.line + around.radius);
    }
    const remaining = Math.min(budgetChars - used, maxChars ?? Infinity);
    if (remaining < 200) {
      ctx.excluded.push({ path, reason: 'token budget exhausted' });
      return false;
    }
    let slice = all.slice(start - 1, end);
    let truncated = false;
    let text = slice.map((l, i) => `${String(start + i).padStart(4)}| ${l}`).join('\n');
    while (text.length > remaining && slice.length > 5) {
      slice = slice.slice(0, Math.floor(slice.length * 0.75));
      truncated = true;
      text = slice.map((l, i) => `${String(start + i).padStart(4)}| ${l}`).join('\n');
    }
    if (text.length > remaining) {
      text = text.slice(0, remaining);
      truncated = true;
    }
    const { text: clean, redactions } = sanitize(text);
    ctx.files.push({ path, uri, content: clean, startLine: start, endLine: start + slice.length - 1, truncated, redactions });
    ctx.redactions += redactions;
    ctx.allowedPaths.add(path);
    ctx.uriByPath.set(path, uri);
    used += clean.length;
    return true;
  };

  const fileOf = (path: string) => scan.findings.find((f) => f.location.file === path)?.location.uri;

  switch (req.task) {
    case 'explainFinding': {
      const finding = scan.findings.find((f) => f.id === req.findingId);
      if (!finding) {
        throw new Error('Finding not found in the latest scan.');
      }
      ctx.title = `Explain: ${finding.title}`;
      ctx.target = `${finding.location.file}:${finding.location.line}`;
      ctx.summary = summarize(scan, { findings: [finding], modules: [] }) + `\n\nFinding details:\n${JSON.stringify({ ruleId: finding.ruleId, title: finding.title, severity: finding.severity, confidence: finding.confidence, status: finding.status, description: finding.description, impact: finding.impact, recommendation: finding.recommendation, location: `${finding.location.file}:${finding.location.line}` }, null, 2)}`;
      await addSnippet(finding.location.file, finding.location.uri, { line: finding.location.line, radius: 25 });
      break;
    }
    case 'reviewFile': {
      const path = req.filePath ?? scan.findings.find((f) => f.location.uri === req.fileUri)?.location.file;
      if (!req.fileUri || !path) {
        throw new Error('No file selected for review.');
      }
      ctx.title = `File review: ${path}`;
      ctx.target = path;
      const fileFindings = scan.findings.filter((f) => f.location.file === path).slice(0, 40);
      ctx.summary = summarize(scan, { findings: fileFindings, modules: [] });
      await addSnippet(path, req.fileUri);
      break;
    }
    case 'reviewModule': {
      const mod = scan.progress.modules.find((m) => m.id === req.moduleId);
      if (!mod) {
        throw new Error('Module not found in the latest scan.');
      }
      ctx.title = `Module review: ${mod.name}`;
      ctx.target = mod.name;
      const files = [...new Map(mod.evidence.map((e) => [e.file, e.uri])).entries()];
      const rank = (p: string) => (/route|api|controller|service|action/.test(p) ? 0 : /model|schema|prisma/.test(p) ? 1 : /page/.test(p) ? 2 : 3);
      files.sort((a, b) => rank(a[0]) - rank(b[0]));
      const moduleFindings = scan.findings.filter((f) => files.some(([p]) => p === f.location.file)).slice(0, 30);
      ctx.summary = summarize(scan, { findings: moduleFindings, modules: [mod] }) + `\n\nModule evidence:\n${mod.evidence.slice(0, 40).map((e) => `- ${e.kind}: ${e.detail} @ ${e.file}:${e.line}`).join('\n')}`;
      const perFile = Math.max(1500, Math.floor(budgetChars / Math.min(files.length || 1, 6)));
      for (const [p, uri] of files.slice(0, 12)) {
        await addSnippet(p, uri, undefined, perFile);
      }
      break;
    }
    case 'securityConcerns': {
      ctx.title = 'Security concerns';
      const sec = topFindings(scan.findings, 40, (f) => f.category === 'security' || f.category === 'dependency');
      ctx.summary = summarize(scan, { findings: sec, modules: [] });
      for (const f of sec.slice(0, 10)) {
        await addSnippet(f.location.file, f.location.uri, { line: f.location.line, radius: 8 }, 2500);
      }
      break;
    }
    case 'incompletePatterns': {
      ctx.title = 'Incomplete implementation patterns';
      ctx.summary = summarize(scan, { findings: topFindings(scan.findings, 20, (f) => f.category === 'progress'), placeholders: true });
      for (const p of scan.progress.placeholders.filter((x) => x.kind !== 'todo').slice(0, 10)) {
        await addSnippet(p.file, p.uri, { line: p.line, radius: 8 }, 2000);
      }
      break;
    }
    case 'architectureSummary':
    case 'improvements':
    case 'projectAssessment': {
      ctx.title =
        req.task === 'architectureSummary' ? 'Architecture summary' : req.task === 'improvements' ? 'Prioritized improvements' : 'Project assessment';
      ctx.summary = summarize(scan, { findings: topFindings(scan.findings, 40), placeholders: req.task !== 'architectureSummary' });
      for (const p of scan.technology.manifests.slice(0, 1)) {
        const uri = fileOf(p) ?? uriForDisplayPath(scan, p);
        if (uri) {
          await addSnippet(p, uri, undefined, 3000);
        }
      }
      break;
    }
  }

  for (const f of scan.findings) {
    ctx.uriByPath.set(f.location.file, f.location.uri);
  }
  for (const m of scan.progress.modules) {
    for (const e of m.evidence) {
      ctx.uriByPath.set(e.file, e.uri);
    }
  }
  // Paths mentioned in the summary may also be referenced.
  for (const path of ctx.uriByPath.keys()) {
    if (ctx.summary.includes(path)) {
      ctx.allowedPaths.add(path);
    }
  }
  ctx.estimatedTokens = estimateTokens(ctx.summary) + ctx.files.reduce((s, f) => s + estimateTokens(f.content) + 20, 0) + 900;
  return ctx;
}

export function renderUserPrompt(ctx: BuiltContext, taskInstructions: string): string {
  const parts = [
    `TASK: ${taskInstructions}`,
    '',
    '=== LOCAL ANALYSIS SUMMARY (deterministic scanner output) ===',
    ctx.summary,
    ''
  ];
  for (const f of ctx.files) {
    parts.push(`=== FILE: ${f.path} (lines ${f.startLine}-${f.endLine}${f.truncated ? ', truncated' : ''}) ===`, f.content, '');
  }
  if (ctx.excluded.length) {
    parts.push(`(Excluded from context: ${ctx.excluded.map((e) => `${e.path} — ${e.reason}`).join('; ')})`);
  }
  return parts.join('\n');
}
