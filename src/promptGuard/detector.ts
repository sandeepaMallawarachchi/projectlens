import { findSecrets } from '../analyzers/security/secretPatterns';
import { BUILTIN_DETECTORS, type PromptAction, type PromptPolicy } from '../models/promptGuard';

export interface PromptMatch {
  ruleId: string;
  label: string;
  category: string;
  action: Exclude<PromptAction, 'off'>;
  start: number;
  end: number;
}

export interface PromptCheck {
  /** Strongest action among matches (`none` when clean). */
  action: 'none' | 'warn' | 'redact' | 'block';
  matches: PromptMatch[];
  /** Prompt with every matched span replaced by a marker. */
  sanitized: string;
  ruleIds: string[];
  categories: string[];
}

const RANK = { none: 0, warn: 1, redact: 2, block: 3 } as const;
const MAX_PROMPT = 200_000;

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// Conservative: international format or (xxx) xxx-xxxx, to avoid flagging version numbers and ids.
const PHONE = /(?:\+\d{1,3}[\s.-]?\(?\d{1,4}\)?[\s.-]?\d{3,4}[\s.-]?\d{3,4}\b)|(?:\(\d{3}\)\s?\d{3}[\s.-]\d{4}\b)/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
const PLACEHOLDER_EMAIL = /@(example\.(com|org|net)|test\.com|localhost)$|^(you|user|name|someone|noreply|no-reply)@/i;

export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) {
        d -= 9;
      }
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Singular, human label of one match (used in messages and sanitized markers). */
const MATCH_LABELS: Record<string, string> = { 'pii.email': 'email address', 'pii.phone': 'phone number', 'pii.card': 'payment card number' };

function builtinLabel(id: string): string {
  return MATCH_LABELS[id] ?? BUILTIN_DETECTORS.find((d) => d.id === id)?.label ?? id;
}

/** Checks a prompt against an organization policy. Runs fully offline. */
export function checkPrompt(input: string, policy: PromptPolicy): PromptCheck {
  const text = input.length > MAX_PROMPT ? input.slice(0, MAX_PROMPT) : input;
  const matches: PromptMatch[] = [];
  const allow = policy.allowlist.filter(Boolean);
  const add = (m: Omit<PromptMatch, 'label'> & { label?: string }) => {
    const value = text.slice(m.start, m.end);
    if (allow.some((a) => value === a || value.includes(a))) {
      return;
    }
    matches.push({ label: m.label ?? builtinLabel(m.ruleId), ...m });
  };

  const secrets = policy.builtin.secrets;
  if (secrets && secrets !== 'off') {
    for (const s of findSecrets(text)) {
      add({ ruleId: 'secrets', label: s.pattern.title, category: 'secret', action: secrets, start: s.secretIndex, end: s.secretIndex + s.secret.length });
    }
    // Private key bodies span lines: redact the whole block.
    const pem = /-----BEGIN [A-Z ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY(?: BLOCK)?-----|$)/g;
    let m: RegExpExecArray | null;
    while ((m = pem.exec(text)) !== null) {
      add({ ruleId: 'secrets', label: 'private key', category: 'secret', action: secrets, start: m.index, end: m.index + m[0].length });
    }
  }
  const email = policy.builtin['pii.email'];
  if (email && email !== 'off') {
    for (const m of text.matchAll(EMAIL)) {
      if (!PLACEHOLDER_EMAIL.test(m[0])) {
        add({ ruleId: 'pii.email', category: 'pii', action: email, start: m.index!, end: m.index! + m[0].length });
      }
    }
  }
  const phone = policy.builtin['pii.phone'];
  if (phone && phone !== 'off') {
    for (const m of text.matchAll(PHONE)) {
      if (m[0].replace(/\D/g, '').length >= 9) {
        add({ ruleId: 'pii.phone', category: 'pii', action: phone, start: m.index!, end: m.index! + m[0].length });
      }
    }
  }
  const card = policy.builtin['pii.card'];
  if (card && card !== 'off') {
    for (const m of text.matchAll(CARD)) {
      const digits = m[0].replace(/\D/g, '');
      if (digits.length >= 13 && digits.length <= 19 && !/^(\d)\1+$/.test(digits) && luhn(digits)) {
        add({ ruleId: 'pii.card', category: 'pii', action: card, start: m.index!, end: m.index! + m[0].trimEnd().length });
      }
    }
  }
  for (const rule of policy.customRules) {
    let re: RegExp;
    try {
      re = rule.type === 'term' ? new RegExp(`(?<![\\w])${escapeRegex(rule.pattern)}(?![\\w])`, 'gi') : new RegExp(rule.pattern, 'gi');
    } catch {
      continue; // invalid regex: ignored (validated server-side)
    }
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(text)) !== null && guard++ < 500) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      add({ ruleId: `custom.${rule.id}`, label: rule.name, category: 'custom', action: rule.action, start: m.index, end: m.index + m[0].length });
    }
  }

  matches.sort((a, b) => a.start - b.start || b.end - a.end);
  let action: PromptCheck['action'] = 'none';
  for (const m of matches) {
    if (RANK[m.action] > RANK[action]) {
      action = m.action;
    }
  }
  return {
    action,
    matches,
    sanitized: sanitize(text, matches),
    ruleIds: [...new Set(matches.map((m) => m.ruleId))],
    categories: [...new Set(matches.map((m) => m.category))]
  };
}

/** Replaces matched spans (non-overlapping, earliest first) with readable markers. */
export function sanitize(text: string, matches: PromptMatch[]): string {
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    if (m.start < cursor) {
      continue;
    }
    out += text.slice(cursor, m.start);
    out += `[REDACTED ${m.label}]`;
    cursor = m.end;
  }
  return out + text.slice(cursor);
}

/** Human summary of what was found, e.g. "GitHub token and email address". */
export function describeMatches(matches: PromptMatch[]): string {
  const labels = [...new Set(matches.map((m) => m.label))];
  if (labels.length <= 2) {
    return labels.join(' and ');
  }
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}
