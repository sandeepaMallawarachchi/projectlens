import type { Finding, Severity } from '../../models/types';
import { createFinding, type RuleMeta } from '../../core/findings';
import type { ProjectManifestInfo, PackageManifest } from '../technology/manifests';

/**
 * Offline dependency checks. The advisory list is a small curated set of well-known
 * issues — it is NOT a vulnerability database. `npm audit` or an SCA tool is still required.
 */
interface Advisory {
  name: string;
  /** Inclusive lower / exclusive upper bounds. */
  ranges: [string, string][];
  severity: Severity;
  summary: string;
  fix: string;
}

const ADVISORIES: Advisory[] = [
  {
    name: 'next',
    ranges: [['11.1.4', '12.3.5'], ['13.0.0', '13.5.9'], ['14.0.0', '14.2.25'], ['15.0.0', '15.2.3']],
    severity: 'high',
    summary: 'CVE-2025-29927: authorization checks in middleware can be bypassed via the x-middleware-subrequest header.',
    fix: 'Upgrade to 12.3.5 / 13.5.9 / 14.2.25 / 15.2.3 or later.'
  },
  { name: 'jsonwebtoken', ranges: [['0.0.0', '9.0.0']], severity: 'medium', summary: 'Versions before 9.0.0 have multiple advisories (e.g. CVE-2022-23539/23540/23541) around key handling and algorithm confusion.', fix: 'Upgrade to jsonwebtoken 9.x.' },
  { name: 'lodash', ranges: [['0.0.0', '4.17.21']], severity: 'medium', summary: 'Prototype pollution and command injection advisories (CVE-2020-8203, CVE-2021-23337).', fix: 'Upgrade to lodash 4.17.21 or later.' },
  { name: 'axios', ranges: [['0.8.1', '1.12.0']], severity: 'medium', summary: 'Known advisories include CSRF token leakage (CVE-2023-45857) and unbounded data: URI handling (CVE-2025-58754).', fix: 'Upgrade to axios 1.12.0 or later.' },
  { name: 'minimist', ranges: [['0.0.0', '1.2.6']], severity: 'medium', summary: 'Prototype pollution (CVE-2021-44906).', fix: 'Upgrade to minimist 1.2.6 or later.' },
  { name: 'express', ranges: [['0.0.0', '4.19.2']], severity: 'low', summary: 'Open redirect in malformed URL handling (CVE-2024-29041).', fix: 'Upgrade to express 4.19.2 or later.' },
  { name: 'crypto-js', ranges: [['0.0.0', '4.2.0']], severity: 'medium', summary: 'PBKDF2 defaults are drastically weaker than intended (CVE-2023-46233).', fix: 'Upgrade to crypto-js 4.2.0 or use Node\'s built-in crypto.' },
  { name: 'node-serialize', ranges: [['0.0.0', '999.0.0']], severity: 'critical', summary: 'Insecure deserialization leading to remote code execution (CVE-2017-5941). No fixed version.', fix: 'Remove the package and use JSON serialization.' },
  { name: 'event-stream', ranges: [['3.3.6', '3.3.7']], severity: 'critical', summary: 'Version 3.3.6 contained a malicious payload (flatmap-stream).', fix: 'Pin to a safe version or remove the dependency.' },
  { name: 'request', ranges: [['0.0.0', '999.0.0']], severity: 'low', summary: 'The package is deprecated and unmaintained; it will not receive security fixes.', fix: 'Migrate to fetch, undici, axios or got.' }
];

const base = { category: 'dependency', analyzer: 'dependencies' } as const;
const RULES = {
  advisory: { ...base, id: 'dep/known-advisory', title: 'Dependency with known advisory', severity: 'medium', confidence: 'medium', description: '', recommendation: '', impact: 'Known vulnerabilities in dependencies are a common attack vector.' },
  wildcard: { ...base, id: 'dep/unpinned-version', title: 'Unpinned dependency version', severity: 'medium', confidence: 'high', description: 'The dependency uses `*`, `latest` or an empty range, so any future (possibly malicious or breaking) release is installed.', recommendation: 'Pin to a semver range and commit a lockfile.', impact: 'Builds are not reproducible and supply-chain attacks are easier.' },
  remote: { ...base, id: 'dep/remote-source', title: 'Dependency installed from Git/URL', severity: 'low', confidence: 'high', status: 'needs-review', description: 'The dependency is fetched from a Git repository, URL or local path rather than the registry.', recommendation: 'Prefer registry packages, or pin the Git dependency to an immutable commit SHA.', impact: 'Remote sources bypass registry integrity checks and can change unexpectedly.' },
  noLockfile: { ...base, id: 'dep/missing-lockfile', title: 'No lockfile committed', severity: 'medium', confidence: 'high', description: 'package.json declares dependencies but no lockfile was found.', recommendation: 'Commit package-lock.json, pnpm-lock.yaml or yarn.lock to make installs reproducible.', impact: 'Different environments may install different (and unreviewed) versions.' },
  duplicate: { ...base, id: 'dep/duplicate-declaration', title: 'Dependency declared twice', severity: 'info', confidence: 'high', kind: 'recommendation', description: 'The package appears in both dependencies and devDependencies.', recommendation: 'Keep the package in only one section.' }
} satisfies Record<string, RuleMeta>;

export function parseVersion(v: string): number[] | null {
  const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v);
  if (!m) {
    return null;
  }
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVersion(a) ?? [0, 0, 0];
  const pb = parseVersion(b) ?? [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] - pb[i];
    }
  }
  return 0;
}

export function versionInRanges(version: string, ranges: [string, string][]): boolean {
  return ranges.some(([lo, hi]) => compareVersions(version, lo) >= 0 && compareVersions(version, hi) < 0);
}

function lineOfKey(text: string | undefined, name: string): number {
  if (!text) {
    return 1;
  }
  const idx = text.split(/\r?\n/).findIndex((l) => l.includes(`"${name}"`));
  return idx >= 0 ? idx + 1 : 1;
}

export function analyzeDependencies(info: ProjectManifestInfo, manifestTexts: Map<string, string>): Finding[] {
  const findings: Finding[] = [];
  const at = (pkg: PackageManifest, name: string) => ({ file: pkg.file.displayPath, uri: pkg.file.uri, line: lineOfKey(manifestTexts.get(pkg.file.displayPath), name) });

  for (const pkg of info.packages) {
    const all: [string, string, boolean][] = [
      ...Object.entries(pkg.dependencies).map(([n, r]) => [n, r, false] as [string, string, boolean]),
      ...Object.entries(pkg.devDependencies).map(([n, r]) => [n, r, true] as [string, string, boolean])
    ];
    for (const [name, range] of all) {
      const loc = at(pkg, name);
      const line = `"${name}": "${range}"`;
      if (/^(\*|latest|x|)$/.test(range.trim())) {
        findings.push(createFinding(RULES.wildcard, loc, line));
      } else if (/^(git\+|git:|github:|gitlab:|bitbucket:|https?:|file:|link:)/.test(range) || /^[\w-]+\/[\w.-]+(#.*)?$/.test(range)) {
        if (!/#[0-9a-f]{40}$/.test(range)) {
          findings.push(createFinding(RULES.remote, loc, line));
        }
      }
      const advisory = ADVISORIES.find((a) => a.name === name);
      if (advisory) {
        const resolved = info.resolvedVersions.get(name);
        const version = resolved ?? (parseVersion(range) ? range.replace(/^[^\d]*/, '') : undefined);
        if (version && versionInRanges(version, advisory.ranges)) {
          findings.push(
            createFinding(
              {
                ...RULES.advisory,
                severity: advisory.severity,
                confidence: resolved ? 'high' : 'medium',
                status: resolved ? 'confirmed' : 'needs-review',
                title: `${name}@${version}: known advisory`,
                description: `${advisory.summary}${resolved ? ' (resolved from lockfile)' : ' (based on the declared range; the installed version may differ)'}`,
                recommendation: `${advisory.fix} Run \`npm audit\` (or your package manager's equivalent) for a complete report.`
              },
              loc,
              line
            )
          );
        }
      }
    }
    for (const name of Object.keys(pkg.devDependencies)) {
      if (pkg.dependencies[name]) {
        findings.push(createFinding(RULES.duplicate, at(pkg, name), `"${name}"`));
      }
    }
    const depCount = Object.keys(pkg.dependencies).length + Object.keys(pkg.devDependencies).length;
    const pkgDir = pkg.file.displayPath.replace(/package\.json$/, '');
    // Only workspace-root manifests are checked; monorepo packages share the root lockfile.
    const hasLock = info.lockfiles.some((l) => l.startsWith(pkgDir) && !l.slice(pkgDir.length).includes('/'));
    if (depCount > 0 && !hasLock && pkg.file.relPath === 'package.json') {
      findings.push(createFinding(RULES.noLockfile, { file: pkg.file.displayPath, uri: pkg.file.uri, line: 1 }, pkg.file.relPath));
    }
  }
  return findings;
}
