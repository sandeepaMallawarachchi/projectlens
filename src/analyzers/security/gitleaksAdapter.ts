import { execFile } from 'node:child_process';
import { promises as fs, constants as fsConstants } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Finding, Severity } from '../../models/types';
import { createFinding, type RuleMeta } from '../../core/findings';
import { fileUri, toPosix } from '../../utils/paths';

/**
 * Optional adapter for a locally installed Gitleaks binary.
 * - Never downloads or installs anything.
 * - Only runs when enabled in settings AND the workspace is trusted (enforced by the caller).
 * - Uses execFile (no shell) with a timeout; Gitleaks is asked to redact secrets in its report.
 */

export interface GitleaksResult {
  status: 'ok' | 'not-found' | 'error' | 'cancelled';
  findings: Finding[];
  message?: string;
  version?: string;
}

interface GitleaksReportEntry {
  RuleID?: string;
  Description?: string;
  File?: string;
  StartLine?: number;
  StartColumn?: number;
  Match?: string;
  Secret?: string;
}

async function isExecutable(p: string): Promise<boolean> {
  try {
    await fs.access(p, fsConstants.X_OK);
    const stat = await fs.stat(p);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** Resolves the Gitleaks executable from an explicit absolute path or PATH. */
export async function resolveGitleaks(configuredPath: string): Promise<string | null> {
  if (configuredPath) {
    if (!path.isAbsolute(configuredPath)) {
      return null;
    }
    return (await isExecutable(configuredPath)) ? configuredPath : null;
  }
  const names = process.platform === 'win32' ? ['gitleaks.exe'] : ['gitleaks'];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) {
      continue;
    }
    for (const name of names) {
      // turbopackIgnore: PATH lookup is dynamic by design (never used by the API server).
      const candidate = path.join(/*turbopackIgnore: true*/ dir, name);
      if (await isExecutable(candidate)) {
        return candidate;
      }
    }
  }
  return null;
}

function run(file: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, signal, windowsHide: true, shell: false }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ABORT_ERR') {
        reject(err);
        return;
      }
      const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : null) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export function mapGitleaksReport(entries: GitleaksReportEntry[], root: { path: string; name: string }, multiRoot: boolean): Finding[] {
  return entries.slice(0, 500).map((e) => {
    const abs = e.File ? (path.isAbsolute(e.File) ? e.File : path.join(root.path, e.File)) : root.path;
    const rel = toPosix(path.relative(root.path, abs));
    const severity: Severity = /private-key|aws|gcp|github|stripe|groq|openai/i.test(e.RuleID ?? '') ? 'critical' : 'high';
    const rule: RuleMeta = {
      id: `gitleaks/${e.RuleID ?? 'secret'}`,
      title: `Gitleaks: ${e.Description ?? e.RuleID ?? 'secret detected'}`,
      category: 'security',
      severity,
      confidence: 'high',
      analyzer: 'gitleaks',
      description: `Gitleaks rule \`${e.RuleID ?? 'unknown'}\` matched. Values are redacted by Gitleaks (--redact).`,
      impact: 'Leaked credentials can be used to access the associated service.',
      recommendation: 'Revoke and rotate the credential, then remove it from the source and Git history.'
    };
    // `Match` is already redacted by gitleaks --redact; it is redacted again by createFinding.
    return createFinding(rule, { file: multiRoot ? `${root.name}/${rel}` : rel, uri: fileUri(abs), line: e.StartLine ?? 1, column: e.StartColumn ?? 1 }, e.Match ?? '');
  });
}

export async function runGitleaks(
  executable: string,
  roots: { path: string; name: string }[],
  opts: { timeoutMs: number; signal?: AbortSignal }
): Promise<GitleaksResult> {
  const findings: Finding[] = [];
  let version: string | undefined;
  try {
    const v = await run(executable, ['version'], 10_000, opts.signal);
    version = v.stdout.trim().split('\n')[0];
  } catch {
    // version is informational
  }
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'projectlens-gitleaks-'));
  try {
    for (const root of roots) {
      const report = path.join(tmpDir, `report-${findings.length}.json`);
      // `detect --no-git` scans the working tree only. Exit code 1 means leaks were found.
      const { code, stderr } = await run(
        executable,
        ['detect', '--no-git', '--source', root.path, '--report-format', 'json', '--report-path', report, '--redact', '--no-banner', '--exit-code', '1'],
        opts.timeoutMs,
        opts.signal
      );
      if (code !== 0 && code !== 1) {
        return { status: 'error', findings: [], message: `Gitleaks exited with code ${code}: ${stderr.slice(0, 300)}`, version };
      }
      let entries: GitleaksReportEntry[] = [];
      try {
        const parsed = JSON.parse(await fs.readFile(report, 'utf8')) as unknown;
        entries = Array.isArray(parsed) ? (parsed as GitleaksReportEntry[]) : [];
      } catch {
        entries = [];
      }
      findings.push(...mapGitleaksReport(entries, root, roots.length > 1));
    }
    return { status: 'ok', findings, version };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ABORT_ERR') {
      return { status: 'cancelled', findings: [] };
    }
    return { status: 'error', findings: [], message: err instanceof Error ? err.message : String(err), version };
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
