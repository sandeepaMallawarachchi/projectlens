import type { Finding } from '../../models/types';
import { createFinding, type RuleMeta } from '../../core/findings';
import { shortHash } from '../../utils/hash';

export const DUPLICATE_WINDOW = 8;
const MAX_HASHES_PER_FILE = 600;

const RULE: RuleMeta = {
  id: 'quality/duplicate-block',
  title: 'Duplicated code block',
  category: 'quality',
  severity: 'low',
  confidence: 'medium',
  analyzer: 'duplicates',
  kind: 'recommendation',
  description: `At least ${DUPLICATE_WINDOW} consecutive non-trivial lines are repeated elsewhere.`,
  recommendation: 'Extract the shared logic into a reusable function or component.'
};

function normalize(line: string): string {
  return line.trim().replace(/\s+/g, ' ');
}

function isTrivial(line: string): boolean {
  return (
    line.length < 4 ||
    /^[{}()[\];,]+$/.test(line) ||
    /^(import|export \{|export \* from|\/\/|\/\*|\*|<\/?\w+>$|return;|break;|\}\)?;?$)/.test(line) ||
    /^['"`]use (client|server)['"`];?$/.test(line)
  );
}

/** Computes rolling window hashes of normalized, non-trivial lines: [hash, line]. */
export function computeDuplicateHashes(lines: string[]): [string, number][] {
  const meaningful: { text: string; line: number }[] = [];
  lines.forEach((raw, i) => {
    const text = normalize(raw);
    if (!isTrivial(text)) {
      meaningful.push({ text, line: i + 1 });
    }
  });
  const hashes: [string, number][] = [];
  for (let i = 0; i + DUPLICATE_WINDOW <= meaningful.length; i++) {
    const window = meaningful.slice(i, i + DUPLICATE_WINDOW).map((m) => m.text).join('\n');
    // Very short windows (e.g. sequences of closing tags) are not interesting.
    if (window.length < 160) {
      continue;
    }
    hashes.push([shortHash(window, 10), meaningful[i].line]);
    if (hashes.length >= MAX_HASHES_PER_FILE) {
      break;
    }
  }
  return hashes;
}

export interface DuplicateInput {
  file: string;
  uri: string;
  hashes: [string, number][];
  isTest: boolean;
}

/** Cross-file duplicate detection. Overlapping windows are collapsed into one finding per block. */
export function findDuplicates(inputs: DuplicateInput[], maxFindings = 50): Finding[] {
  const firstSeen = new Map<string, { file: string; line: number }>();
  const findings: Finding[] = [];
  for (const input of inputs) {
    if (input.isTest) {
      continue;
    }
    let lastReportedLine = -Infinity;
    for (const [hash, line] of input.hashes) {
      const prior = firstSeen.get(hash);
      if (!prior) {
        firstSeen.set(hash, { file: input.file, line });
        continue;
      }
      if (prior.file === input.file && Math.abs(prior.line - line) < DUPLICATE_WINDOW) {
        continue;
      }
      if (line - lastReportedLine < DUPLICATE_WINDOW * 2) {
        continue;
      }
      lastReportedLine = line;
      findings.push(
        createFinding(RULE, { file: input.file, uri: input.uri, line }, `Duplicates ${prior.file}:${prior.line}`, {
          description: `${RULE.description} First occurrence: ${prior.file}:${prior.line}.`
        })
      );
      if (findings.length >= maxFindings) {
        return findings;
      }
    }
  }
  return findings;
}
