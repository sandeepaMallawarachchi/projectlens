import type { Finding } from '../../models/types';
import type { FileContext } from '../../core/fileContext';
import { findingAt, type RuleMeta } from '../../core/findings';

interface LineRule {
  rule: RuleMeta;
  files: RegExp;
  pattern: RegExp;
  /** When set, the rule triggers once per file if `pattern` is absent. */
  absent?: boolean;
}

const cfg = { analyzer: 'configuration' } as const;

const LINE_RULES: LineRule[] = [
  {
    files: /(^|\/)next\.config\.(js|mjs|cjs|ts|mts)$/,
    pattern: /ignoreBuildErrors\s*:\s*true/,
    rule: { ...cfg, id: 'config/next-ignore-type-errors', title: 'Next.js ignores TypeScript build errors', category: 'configuration', severity: 'medium', confidence: 'high', description: '`typescript.ignoreBuildErrors: true` lets production builds succeed with type errors.', recommendation: 'Remove the override and fix the type errors.' }
  },
  {
    files: /(^|\/)next\.config\.(js|mjs|cjs|ts|mts)$/,
    pattern: /ignoreDuringBuilds\s*:\s*true/,
    rule: { ...cfg, id: 'config/next-ignore-lint', title: 'Next.js skips ESLint during builds', category: 'configuration', severity: 'low', confidence: 'high', description: '`eslint.ignoreDuringBuilds: true` disables lint checks in production builds.', recommendation: 'Run lint in CI or remove the override.' }
  },
  {
    files: /(^|\/)next\.config\.(js|mjs|cjs|ts|mts)$/,
    pattern: /hostname\s*:\s*['"`]\*\*?['"`]/,
    rule: { ...cfg, id: 'config/next-open-image-proxy', title: 'Next.js image optimizer accepts any host', category: 'security', severity: 'low', confidence: 'high', status: 'needs-review', description: 'A wildcard `remotePatterns` hostname lets anyone use your image optimizer as an open proxy.', impact: 'Increased bandwidth/compute costs and possible abuse.', recommendation: 'Restrict `remotePatterns` to the domains you actually serve images from.' }
  },
  {
    files: /(^|\/)next\.config\.(js|mjs|cjs|ts|mts)$/,
    pattern: /productionBrowserSourceMaps\s*:\s*true/,
    rule: { ...cfg, id: 'config/next-public-sourcemaps', title: 'Production source maps are public', category: 'security', severity: 'low', confidence: 'high', status: 'needs-review', description: 'Browser source maps expose original source code in production.', impact: 'Makes reverse engineering and discovery of hidden endpoints easier.', recommendation: 'Disable public source maps or upload them privately to your error tracker.' }
  },
  {
    files: /(^|\/)(Dockerfile(\.[\w-]+)?|[\w.-]+\.dockerfile)$/i,
    pattern: /^\s*(ENV|ARG)\s+[\w]*(SECRET|PASSWORD|PASSWD|TOKEN|API_KEY|PRIVATE_KEY|ACCESS_KEY)[\w]*\s*[= ]\s*\S{4,}/i,
    rule: { ...cfg, id: 'config/docker-secret-in-image', title: 'Secret baked into Docker image', category: 'security', severity: 'high', confidence: 'medium', description: 'A secret-like value is set with ENV/ARG and becomes part of the image layers/history.', impact: 'Anyone who can pull the image can extract the value.', recommendation: 'Inject secrets at runtime or use BuildKit `--secret` mounts.' }
  },
  {
    files: /(^|\/)(Dockerfile(\.[\w-]+)?|[\w.-]+\.dockerfile)$/i,
    pattern: /^\s*FROM\s+[^\s:]+(:latest)?\s*(AS\s+\w+)?\s*$/i,
    rule: { ...cfg, id: 'config/docker-unpinned-base', title: 'Unpinned Docker base image', category: 'configuration', severity: 'low', confidence: 'high', kind: 'recommendation', description: 'The base image uses `latest` or no tag, making builds non-reproducible.', recommendation: 'Pin the base image to a specific version (ideally a digest).' }
  },
  {
    files: /(^|\/)(Dockerfile(\.[\w-]+)?|[\w.-]+\.dockerfile)$/i,
    pattern: /^\s*USER\s+/im,
    absent: true,
    rule: { ...cfg, id: 'config/docker-runs-as-root', title: 'Container runs as root', category: 'security', severity: 'low', confidence: 'medium', status: 'needs-review', description: 'No `USER` instruction was found, so the container process runs as root.', impact: 'A compromised process has root privileges inside the container.', recommendation: 'Create and switch to an unprivileged user (e.g. `USER node`).' }
  },
  {
    files: /(^|\/)(docker-compose(\.[\w-]+)?\.ya?ml|compose\.ya?ml)$/,
    pattern: /^\s*-?\s*[\w]*(PASSWORD|SECRET|TOKEN|API_KEY)[\w]*\s*[:=]\s*(?!\$\{)['"]?[^\s'"$]{3,}/i,
    rule: { ...cfg, id: 'config/compose-literal-secret', title: 'Literal credential in Compose file', category: 'security', severity: 'medium', confidence: 'medium', status: 'needs-review', description: 'A secret-like environment value is hardcoded in a Compose file.', impact: 'Acceptable for local development only; if reused in production, the credential is exposed.', recommendation: 'Use `${VAR}` interpolation with an untracked .env file or Docker secrets.' }
  },
  {
    files: /(^|\/)\.github\/workflows\/[\w.-]+\.ya?ml$/,
    pattern: /^\s*pull_request_target\s*:/m,
    rule: { ...cfg, id: 'config/gha-pull-request-target', title: 'Workflow uses pull_request_target', category: 'security', severity: 'medium', confidence: 'medium', status: 'needs-review', description: '`pull_request_target` runs with repository secrets; checking out untrusted PR code in it is dangerous.', impact: 'A malicious pull request could exfiltrate secrets or push to the repository.', recommendation: 'Avoid checking out PR head code in `pull_request_target` workflows, or use `pull_request`.' }
  },
  {
    files: /(^|\/)\.github\/workflows\/[\w.-]+\.ya?ml$/,
    pattern: /echo\s+.*\$\{\{\s*secrets\./,
    rule: { ...cfg, id: 'config/gha-secret-echo', title: 'Secret echoed in workflow', category: 'security', severity: 'medium', confidence: 'medium', description: 'A workflow step echoes a secret expression.', impact: 'Masking can be bypassed by transformations; secrets may end up in logs or artifacts.', recommendation: 'Pass secrets via `env:` and never print them.' }
  }
];

export function isConfigTarget(relPath: string): boolean {
  return LINE_RULES.some((r) => r.files.test(relPath));
}

export function analyzeConfigFiles(ctx: FileContext): Finding[] {
  const findings: Finding[] = [];
  for (const lr of LINE_RULES) {
    if (!lr.files.test(ctx.file.relPath)) {
      continue;
    }
    if (lr.absent) {
      if (!lr.pattern.test(ctx.text)) {
        findings.push(findingAt(ctx, lr.rule, { line: 1 }));
      }
      continue;
    }
    ctx.lines.forEach((line, i) => {
      if (lr.pattern.test(line)) {
        findings.push(findingAt(ctx, lr.rule, { line: i + 1 }));
      }
    });
  }
  return findings;
}
