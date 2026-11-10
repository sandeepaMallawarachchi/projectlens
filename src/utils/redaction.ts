import { findSecrets } from '../analyzers/security/secretPatterns';

/**
 * Produces a short, non-reversible preview of a secret: a few leading characters
 * (only for long values) and the length. The full value is never returned.
 */
export function redactSecret(value: string): string {
  const visible = value.length >= 16 ? 4 : value.length >= 10 ? 2 : 0;
  return `${value.slice(0, visible)}${'•'.repeat(6)} (${value.length} chars)`;
}

/** Replaces every detected secret in `text` with a redacted marker. */
export function redactText(text: string, style: 'preview' | 'marker' = 'preview'): { text: string; redactions: number } {
  const matches = findSecrets(text);
  if (matches.length === 0) {
    return { text, redactions: 0 };
  }
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    if (m.secretIndex < cursor) {
      continue;
    }
    out += text.slice(cursor, m.secretIndex);
    out += style === 'preview' ? redactSecret(m.secret) : `[REDACTED:${m.pattern.id.replace('secret/', '')}]`;
    cursor = m.secretIndex + m.secret.length;
  }
  out += text.slice(cursor);
  return { text: out, redactions: matches.length };
}

/** Redacts private key bodies spanning multiple lines (headers are kept for context). */
export function redactPrivateKeyBlocks(text: string): string {
  return text.replace(
    /(-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----)[\s\S]*?(-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----)/g,
    '$1\n[REDACTED PRIVATE KEY]\n$2'
  );
}

/** Builds a safe single-line evidence snippet. */
export function safeEvidence(line: string, maxLength = 180): string {
  const trimmed = line.trim();
  const { text } = redactText(trimmed);
  return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}
