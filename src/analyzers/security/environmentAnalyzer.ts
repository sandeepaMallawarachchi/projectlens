import type { Finding } from '../../models/types';
import type { DiscoveredFile } from '../../core/fileDiscovery';
import { SENSITIVE_FILE_PATTERNS } from '../../core/fileDiscovery';
import type { FileContext } from '../../core/fileContext';
import { createFinding, findingAt, type RuleMeta } from '../../core/findings';
import { looksLikePlaceholder, shannonEntropy } from './secretPatterns';
import { redactSecret } from '../../utils/redaction';

export const PUBLIC_ENV_PREFIX = /^(NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_|NUXT_PUBLIC_|GATSBY_)/;
const SECRET_NAME = /(SECRET|PRIVATE|PASSWORD|PASSWD|SERVICE_ROLE|DATABASE_URL|DB_URL|DB_PASS|MONGODB_URI|MONGO_URI|POSTGRES_URL|ADMIN_KEY|SIGNING|WEBHOOK_SECRET|CLIENT_SECRET|ACCESS_KEY|AUTH_TOKEN)/;
const MAYBE_SECRET_NAME = /(API_KEY|APIKEY|TOKEN|KEY)$/;

const RULES = {
  publicSecret: {
    id: 'env/public-secret',
    title: 'Secret exposed through public environment prefix',
    category: 'security',
    severity: 'high',
    confidence: 'high',
    analyzer: 'environment',
    description:
      'Variables with a public prefix (NEXT_PUBLIC_, VITE_, REACT_APP_, …) are inlined into the client bundle at build time. This variable name suggests a secret.',
    impact: 'The value is shipped to every browser and can be read by anyone visiting the site.',
    recommendation:
      'Rename the variable without the public prefix and only access it from server-side code (API routes, server components, server actions).'
  },
  publicKeyReview: {
    id: 'env/public-key-review',
    title: 'Public environment variable holds a key or token',
    category: 'security',
    severity: 'low',
    confidence: 'medium',
    status: 'needs-review',
    analyzer: 'environment',
    description:
      'A publicly exposed variable holds a key or token. Some keys are designed to be public (e.g. Firebase web keys, Stripe publishable keys); others are not.',
    impact: 'If the key is not meant to be public, it can be abused by anyone who inspects the client bundle.',
    recommendation: 'Confirm the key is publishable and restricted (domain/API restrictions). Otherwise move it server-side.'
  },
  envNotIgnored: {
    id: 'env/env-file-not-ignored',
    title: 'Environment file is not ignored by Git',
    category: 'security',
    severity: 'high',
    confidence: 'high',
    analyzer: 'environment',
    description: 'A dotenv file containing local configuration is not covered by .gitignore and may be committed.',
    impact: 'Credentials in the file can leak through the repository history.',
    recommendation: 'Add `.env*` (with `!.env.example`) to .gitignore and rotate any credentials that were committed.'
  },
  exampleHasValue: {
    id: 'env/example-contains-secret',
    title: 'Example environment file contains a real-looking secret',
    category: 'security',
    severity: 'medium',
    confidence: 'medium',
    analyzer: 'environment',
    description: 'Template env files are usually committed. This entry has a high-entropy value for a secret-like name.',
    impact: 'If the value is real, it is exposed to everyone with repository access.',
    recommendation: 'Replace the value with a placeholder and rotate the credential if it was real.'
  },
  envFileSecret: {
    id: 'env/tracked-env-secret',
    title: 'Secret value in tracked environment file',
    category: 'security',
    severity: 'critical',
    confidence: 'high',
    analyzer: 'environment',
    description: 'A dotenv file that is not ignored by Git contains a secret-like value.',
    impact: 'The credential is likely committed and exposed to everyone with repository access.',
    recommendation: 'Remove the file from Git, add it to .gitignore, and rotate the credential.'
  },
  credentialFile: {
    id: 'secret/credential-file',
    title: 'Credential file in workspace',
    category: 'security',
    severity: 'high',
    confidence: 'medium',
    analyzer: 'environment',
    description: 'A file that typically contains private keys or service credentials is present and not ignored by Git.',
    impact: 'Private keys or service-account credentials allow impersonation of the owner or service.',
    recommendation: 'Remove the file from the repository, add it to .gitignore and rotate the contained credentials.'
  },
  npmrcToken: {
    id: 'secret/npmrc-token',
    title: 'Registry auth token in .npmrc',
    category: 'security',
    severity: 'critical',
    confidence: 'high',
    analyzer: 'environment',
    description: 'A literal registry auth token is stored in .npmrc.',
    impact: 'The token may allow publishing or reading private packages.',
    recommendation: 'Use `${NPM_TOKEN}` interpolation in .npmrc and provide the token through CI secrets.'
  }
} satisfies Record<string, RuleMeta>;

/** URL values only count as secrets when they embed a non-placeholder password. */
export function isRealSecretValue(value: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const creds = /:\/\/[^:@/\s]+:([^@\s]+)@/.exec(value);
    if (!creds) {
      return false;
    }
    const password = creds[1];
    return password.length >= 6 && !looksLikePlaceholder(password, true) && !/^\$\{?\w+\}?$/.test(password);
  }
  return value.length >= 8 && !looksLikePlaceholder(value, true) && shannonEntropy(value) >= 3;
}

const isEnvFile = (rel: string) => /(^|\/)\.env(\.[\w.-]+)?$/.test(rel);
const isEnvExample = (rel: string) => /\.(example|sample|template|dist|defaults?)$/.test(rel);

/** Per-file environment checks: dotenv contents, public prefixes in code, .npmrc tokens. */
export function analyzeEnvironment(ctx: FileContext, opts: { trackedEnv: boolean }): Finding[] {
  const rel = ctx.file.relPath;
  const findings: Finding[] = [];

  if (isEnvFile(rel)) {
    ctx.lines.forEach((line, i) => {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) {
        return;
      }
      const [, name, rawValue] = m;
      const value = rawValue.replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim();
      const hasValue = isRealSecretValue(value);
      if (PUBLIC_ENV_PREFIX.test(name)) {
        const unprefixed = name.replace(PUBLIC_ENV_PREFIX, '');
        if (SECRET_NAME.test(unprefixed)) {
          findings.push(findingAt(ctx, RULES.publicSecret, { line: i + 1 }));
        } else if (MAYBE_SECRET_NAME.test(unprefixed) && !/PUBLISHABLE|ANON|PUBLIC|SITE_KEY/.test(unprefixed) && hasValue) {
          findings.push(findingAt(ctx, RULES.publicKeyReview, { line: i + 1 }));
        }
      } else if ((SECRET_NAME.test(name) || MAYBE_SECRET_NAME.test(name)) && hasValue) {
        if (isEnvExample(rel)) {
          findings.push(findingAt(ctx, RULES.exampleHasValue, { line: i + 1 }, { evidence: `${name}=${redactSecret(value)}` }));
        } else if (opts.trackedEnv) {
          findings.push(findingAt(ctx, RULES.envFileSecret, { line: i + 1 }, { evidence: `${name}=${redactSecret(value)}` }));
        }
      }
    });
    return findings;
  }

  if (/(^|\/)\.npmrc$/.test(rel)) {
    ctx.lines.forEach((line, i) => {
      if (/_authToken\s*=\s*(?!\$\{)[A-Za-z0-9_-]{16,}/.test(line)) {
        findings.push(findingAt(ctx, RULES.npmrcToken, { line: i + 1 }));
      }
    });
    return findings;
  }

  // Public-prefixed secret names referenced from code.
  const re = /(?:process\.env|import\.meta\.env)\.((?:NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|NUXT_PUBLIC_|GATSBY_)[A-Z0-9_]+)/g;
  ctx.lines.forEach((line, i) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      if (SECRET_NAME.test(m[1].replace(PUBLIC_ENV_PREFIX, ''))) {
        findings.push(findingAt(ctx, RULES.publicSecret, { line: i + 1, column: m.index + 1 }));
      }
    }
  });
  return findings;
}

/** Checks root dotenv files against .gitignore. */
export function analyzeEnvIgnoreStatus(envFiles: { file: DiscoveredFile; gitignored: boolean }[], hasGitignore: Map<string, boolean>): Finding[] {
  const findings: Finding[] = [];
  for (const { file, gitignored } of envFiles) {
    if (isEnvExample(file.relPath) || gitignored) {
      continue;
    }
    const rule = { ...RULES.envNotIgnored };
    if (!hasGitignore.get(file.root)) {
      rule.description += ' No .gitignore file exists in this workspace folder.';
    }
    findings.push(createFinding(rule, { file: file.displayPath, uri: file.uri, line: 1 }, file.relPath));
  }
  return findings;
}

/** Name-based detection of credential containers (keys, keystores, service-account JSON). */
export function analyzeCredentialFiles(files: DiscoveredFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const file of files) {
    const hit = SENSITIVE_FILE_PATTERNS.find((p) => p.regex.test(file.relPath));
    if (!hit) {
      continue;
    }
    // Public certificates/keys are fine; only flag private material by name heuristics.
    if (/\.(pem|key)$/i.test(file.relPath) && /(public|pub|cert|chain|ca)[\w.-]*\.(pem|key)$/i.test(file.relPath)) {
      continue;
    }
    const isFixture = /(^|\/)(fixtures?|test|tests|__tests__|examples?)\//i.test(file.relPath);
    findings.push(
      createFinding(
        { ...RULES.credentialFile, title: `${RULES.credentialFile.title}: ${hit.label}` },
        { file: file.displayPath, uri: file.uri, line: 1 },
        file.relPath,
        isFixture ? { confidence: 'low', tags: ['test-or-fixture'] } : {}
      )
    );
  }
  return findings;
}
