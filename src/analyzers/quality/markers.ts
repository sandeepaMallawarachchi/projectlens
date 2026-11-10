import type { Finding, PlaceholderLocation } from '../../models/types';
import type { FileContext } from '../../core/fileContext';
import { findingAt, type RuleMeta } from '../../core/findings';

const MARKER = /(?:\/\/|\/\*+|^\s*\*|#|<!--|\{\/\*)\s*(TODO|FIXME|HACK|XXX)\b[:\s(-]*(.*)$/;

const RULES: Record<string, RuleMeta> = {
  TODO: {
    id: 'marker/todo',
    title: 'TODO marker',
    category: 'progress',
    severity: 'info',
    confidence: 'high',
    analyzer: 'markers',
    kind: 'rule',
    description: 'A TODO comment indicates unfinished work.',
    recommendation: 'Track the work in your issue tracker or complete it before release.'
  },
  FIXME: {
    id: 'marker/fixme',
    title: 'FIXME marker',
    category: 'progress',
    severity: 'low',
    confidence: 'high',
    analyzer: 'markers',
    description: 'A FIXME comment flags known broken or fragile behavior.',
    recommendation: 'Resolve the underlying issue or document why it is acceptable.'
  },
  HACK: {
    id: 'marker/hack',
    title: 'HACK marker',
    category: 'quality',
    severity: 'low',
    confidence: 'high',
    analyzer: 'markers',
    description: 'A HACK comment marks a known workaround.',
    recommendation: 'Replace the workaround with a proper solution when possible.'
  }
};
RULES.XXX = RULES.FIXME;

const MARKER_FILES = /\.([cm]?[jt]sx?|vue|svelte|astro|css|scss|less|html|py|rb|go|rs|java|kt|cs|php|sql|prisma|graphql|ya?ml|sh)$|(^|\/)Dockerfile/i;

export function analyzeMarkers(ctx: FileContext): { findings: Finding[]; placeholders: PlaceholderLocation[] } {
  if (!MARKER_FILES.test(ctx.file.relPath)) {
    return { findings: [], placeholders: [] };
  }
  const findings: Finding[] = [];
  const placeholders: PlaceholderLocation[] = [];
  ctx.lines.forEach((line, i) => {
    if (line.length > 1000) {
      return;
    }
    const m = MARKER.exec(line);
    if (!m) {
      return;
    }
    const tag = m[1].toUpperCase();
    const message = m[2].replace(/\*\/\s*$|-->\s*$|\*\/\}\s*$/, '').trim();
    findings.push(
      findingAt(ctx, RULES[tag], { line: i + 1, column: (m.index ?? 0) + 1 }, { description: message ? `${tag}: ${message}` : RULES[tag].description })
    );
    placeholders.push({
      kind: tag === 'TODO' ? 'todo' : 'fixme',
      detail: message || tag,
      file: ctx.file.displayPath,
      uri: ctx.file.uri,
      line: i + 1
    });
  });
  return { findings, placeholders };
}
