import type { Confidence, Severity } from '../../models/types';

export interface SecretPattern {
  id: string;
  title: string;
  /** Global regex. Capture group `secret` (named) marks the sensitive portion; otherwise the full match. */
  regex: RegExp;
  severity: Severity;
  confidence: Confidence;
  /** Minimum Shannon entropy of the secret portion, when applicable. */
  minEntropy?: number;
  /** Apply placeholder heuristics (generic rules are much more prone to false positives). */
  generic?: boolean;
  description: string;
}

/**
 * Provider-specific credential formats. These are deliberately conservative to keep
 * false positives low; the generic assignment rule catches the remaining cases.
 */
export const SECRET_PATTERNS: SecretPattern[] = [
  {
    id: 'secret/private-key',
    title: 'Private key material',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g,
    severity: 'critical',
    confidence: 'high',
    description: 'A PEM/OpenSSH private key header was found in a tracked file.'
  },
  {
    id: 'secret/aws-access-key',
    title: 'AWS access key ID',
    regex: /\b(?<secret>(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16})\b/g,
    severity: 'critical',
    confidence: 'high',
    description: 'An AWS access key identifier was found. Combined with its secret key it grants AWS API access.'
  },
  {
    id: 'secret/aws-secret-key',
    title: 'AWS secret access key',
    regex: /aws_?secret_?access_?key["']?\s*[:=]\s*["']?(?<secret>[A-Za-z0-9/+=]{40})\b/gi,
    severity: 'critical',
    confidence: 'high',
    minEntropy: 3.5,
    description: 'An AWS secret access key assignment was found.'
  },
  {
    id: 'secret/github-token',
    title: 'GitHub token',
    regex: /\b(?<secret>(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,90})\b/g,
    severity: 'critical',
    confidence: 'high',
    description: 'A GitHub personal access or app token was found.'
  },
  {
    id: 'secret/gitlab-token',
    title: 'GitLab token',
    regex: /\b(?<secret>glpat-[A-Za-z0-9_-]{20,})\b/g,
    severity: 'critical',
    confidence: 'high',
    description: 'A GitLab personal access token was found.'
  },
  {
    id: 'secret/stripe-live-key',
    title: 'Stripe live secret key',
    regex: /\b(?<secret>(?:sk|rk)_live_[A-Za-z0-9]{20,})\b/g,
    severity: 'critical',
    confidence: 'high',
    description: 'A Stripe live-mode secret or restricted key was found.'
  },
  {
    id: 'secret/stripe-test-key',
    title: 'Stripe test secret key',
    regex: /\b(?<secret>sk_test_[A-Za-z0-9]{20,})\b/g,
    severity: 'medium',
    confidence: 'high',
    description: 'A Stripe test-mode secret key was found. Test keys still expose account data.'
  },
  {
    id: 'secret/slack-token',
    title: 'Slack token',
    regex: /\b(?<secret>xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    severity: 'high',
    confidence: 'high',
    description: 'A Slack API token was found.'
  },
  {
    id: 'secret/slack-webhook',
    title: 'Slack webhook URL',
    regex: /(?<secret>https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]{16,})/g,
    severity: 'medium',
    confidence: 'high',
    description: 'A Slack incoming-webhook URL allows anyone to post into the channel.'
  },
  {
    id: 'secret/google-api-key',
    title: 'Google API key',
    regex: /\b(?<secret>AIza[0-9A-Za-z_-]{35})\b/g,
    severity: 'medium',
    confidence: 'medium',
    description:
      'A Google API key was found. Firebase web keys are public by design, but other Google API keys must be restricted.'
  },
  {
    id: 'secret/groq-key',
    title: 'Groq API key',
    regex: /\b(?<secret>gsk_[A-Za-z0-9]{40,})\b/g,
    severity: 'critical',
    confidence: 'high',
    description: 'A Groq API key was found.'
  },
  {
    id: 'secret/anthropic-key',
    title: 'Anthropic API key',
    regex: /\b(?<secret>sk-ant-[A-Za-z0-9_-]{32,})\b/g,
    severity: 'critical',
    confidence: 'high',
    description: 'An Anthropic API key was found.'
  },
  {
    id: 'secret/openai-key',
    title: 'OpenAI API key',
    regex: /\b(?<secret>sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,})\b/g,
    severity: 'critical',
    confidence: 'medium',
    minEntropy: 3.5,
    description: 'An OpenAI-style secret key was found.'
  },
  {
    id: 'secret/sendgrid-key',
    title: 'SendGrid API key',
    regex: /\b(?<secret>SG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43})\b/g,
    severity: 'high',
    confidence: 'high',
    description: 'A SendGrid API key was found.'
  },
  {
    id: 'secret/npm-token',
    title: 'npm access token',
    regex: /\b(?<secret>npm_[A-Za-z0-9]{36})\b/g,
    severity: 'critical',
    confidence: 'high',
    description: 'An npm access token was found. It may allow publishing packages.'
  },
  {
    id: 'secret/jwt',
    title: 'Hardcoded JSON Web Token',
    regex: /\b(?<secret>eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g,
    severity: 'medium',
    confidence: 'medium',
    description: 'A signed JWT is embedded in the source. It may be a live session or service-role token.'
  },
  {
    id: 'secret/connection-string',
    title: 'Credentials in connection string',
    regex: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|mariadb|redis|rediss|amqps?|mssql):\/\/[^\s:'"/@]+:(?<secret>[^\s@'"/]{3,})@/g,
    severity: 'high',
    confidence: 'high',
    generic: true,
    description: 'A database or broker connection string contains an inline password.'
  },
  {
    id: 'secret/generic-assignment',
    title: 'Possible hardcoded credential',
    regex:
      /(?<name>[A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|api[_-]?key|apikey|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret|signing[_-]?key)[A-Za-z0-9_.-]*)["']?\s*(?::|=|:=|=>)\s*(?<q>["'`])(?<secret>[^"'`\s]{8,})\k<q>/gi,
    severity: 'high',
    confidence: 'medium',
    minEntropy: 3.0,
    generic: true,
    description: 'A variable or property with a credential-like name is assigned a literal value.'
  }
];

const PLACEHOLDER_HINTS =
  /(example|sample|dummy|placeholder|changeme|change[_-]?me|your[_-]|<[^>]+>|xxxx|\*\*\*\*|redacted|replace|insert|todo|fake|mock|lorem|\$\{|\{\{|process\.env|import\.meta|^test|test$|password123|^secret$|^password$)/i;

export function shannonEntropy(value: string): number {
  if (!value) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Heuristics that suppress obvious placeholders, repeated characters and references. */
export function looksLikePlaceholder(value: string, generic: boolean): boolean {
  if (/^(.)\1+$/.test(value)) {
    return true;
  }
  if (/EXAMPLE/.test(value)) {
    return true;
  }
  if (!generic) {
    return false;
  }
  if (PLACEHOLDER_HINTS.test(value)) {
    return true;
  }
  // Identifiers, paths and URLs without credentials are usually references, not secrets.
  if (/^[a-z]+([A-Z][a-z]+)+$/.test(value) || /^[a-z_]+$/.test(value) || /^[A-Z_]+$/.test(value)) {
    return true;
  }
  if (/^(https?:)?\/\//.test(value) || /^\.{0,2}\//.test(value)) {
    return true;
  }
  return false;
}

export interface SecretMatch {
  pattern: SecretPattern;
  /** Index of the full match in the scanned text. */
  index: number;
  length: number;
  secretIndex: number;
  secret: string;
  name?: string;
}

/** Finds secret candidates in a single line or block of text. */
export function findSecrets(text: string): SecretMatch[] {
  const matches: SecretMatch[] = [];
  const claimed: [number, number][] = [];
  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.regex.exec(text)) !== null) {
      const secret = m.groups?.secret ?? m[0];
      const offsetInMatch = m.groups?.secret ? m[0].lastIndexOf(secret) : 0;
      const secretIndex = m.index + offsetInMatch;
      if (claimed.some(([s, e]) => secretIndex < e && secretIndex + secret.length > s)) {
        continue;
      }
      if (looksLikePlaceholder(secret, !!pattern.generic)) {
        continue;
      }
      if (pattern.minEntropy !== undefined && shannonEntropy(secret) < pattern.minEntropy) {
        continue;
      }
      claimed.push([secretIndex, secretIndex + secret.length]);
      matches.push({
        pattern,
        index: m.index,
        length: m[0].length,
        secretIndex,
        secret,
        name: m.groups?.name
      });
      if (m[0].length === 0) {
        pattern.regex.lastIndex++;
      }
    }
  }
  return matches.sort((a, b) => a.index - b.index);
}
