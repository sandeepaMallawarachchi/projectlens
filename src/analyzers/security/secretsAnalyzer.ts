import type { Finding } from '../../models/types';
import type { FileContext } from '../../core/fileContext';
import { findingAt, type RuleMeta } from '../../core/findings';
import { findSecrets } from './secretPatterns';
import { redactSecret } from '../../utils/redaction';

const SKIP_FILES = /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|Cargo\.lock|poetry\.lock)$|\.(svg|map|snap)$/i;
const MAX_FINDINGS_PER_FILE = 25;

export function shouldScanForSecrets(relPath: string): boolean {
  return !SKIP_FILES.test(relPath);
}

/** Line-based scan for credentials embedded in any text file. */
export function analyzeSecrets(ctx: FileContext): Finding[] {
  if (!shouldScanForSecrets(ctx.file.relPath)) {
    return [];
  }
  const findings: Finding[] = [];
  ctx.lines.forEach((line, i) => {
    if (findings.length >= MAX_FINDINGS_PER_FILE || line.length > 4000) {
      return;
    }
    for (const match of findSecrets(line)) {
      const p = match.pattern;
      // References to environment variables are the recommended pattern.
      if (p.generic && /process\.env|import\.meta\.env|os\.environ|getenv/i.test(line)) {
        continue;
      }
      const rule: RuleMeta = {
        id: p.id,
        title: p.title,
        category: 'security',
        severity: p.severity,
        confidence: p.confidence,
        analyzer: 'secrets',
        description: `${p.description} Detected value: ${redactSecret(match.secret)}.`,
        impact:
          'Anyone with access to the repository, build artifacts or client bundle can reuse the credential to access the associated service.',
        recommendation:
          'Revoke and rotate the credential, remove it from the source and Git history, and load it from an environment variable or secret manager at runtime.'
      };
      findings.push(
        findingAt(ctx, rule, { line: i + 1, column: match.secretIndex + 1 }, {
          tags: match.name ? [`name:${match.name}`] : undefined
        })
      );
    }
  });
  return findings;
}
