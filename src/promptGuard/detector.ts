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

/**
 * Prompt-specific credential assignments (`ADMIN_KEY=abc…`, `password: hunter22`, `apiKey = "…"`).
 * Stricter than the code scanner's generic rule: prompts are pasted config and chat, so unquoted
 * `.env`-style values and plain lowercase values count.
 */
const ASSIGNMENT = /(?<name>\b[A-Za-z][A-Za-z0-9_.-]{0,80})["']?[ \t]*(?:=|:|:=|=>)[ \t]*(?<q>["'`]?)(?<secret>[^\s"'`,;]{8,})\k<q>/g;
const SECRET_NAME_SEGMENT =
  /(?:^|[_.-])(?:api[_-]?key|key|keys|secret|secrets|token|password|passwd|pwd|pass|passphrase|passcode|credentials?|creds|auth|bearer|private|private[_-]?key|access[_-]?key|signing|signature|sig|salt|pepper|hmac|cookie|sk|pk[_-]?secret|dsn|seed|mnemonic|otp|totp)(?:$|[_.-])/i;
/** A provider name alone (`OPENAI=…`, `STRIPE=…`) almost always holds that provider's key. */
const PROVIDER_NAME = /^(?:[a-z0-9]+[_.-])?(?:openai|groq|anthropic|claude|gemini|google[_-]?ai|mistral|cohere|huggingface|hf|replicate|stripe|twilio|sendgrid|resend|mailgun|postmark|slack|discord|telegram|github|gitlab|vercel|netlify|supabase[_-]?service[_-]?role|service[_-]?role|firebase|algolia|pusher|datadog|sentry|npm|pypi|aws|azure|gcp|cloudflare|openrouter|deepseek|xai|perplexity)$/i
const SECRET_NAME_CAMEL = /[a-z0-9](?:Key|Keys|Secret|Token|Password|Passwd|Pwd|Passphrase|Credentials?|Creds|Salt|Cookie|Signature)(?:$|[A-Z_])/;
/** Names that mention a secret but describe metadata about it, not the value. */
const NON_SECRET_SUFFIX = /[_.-]?(?:expiry|expires?(?:_?at|_?in)?|ttl|length|len|size|url|uri|path|file|filename|name|type|header|id|count|timeout|endpoint|prefix|enabled|version|algorithm|alg|format|mode)$/i;
const REFERENCE_VALUE = /^(?:\$|process\.env|import\.meta|os\.environ|env\(|\{\{|<|%)|example|sample|dummy|placeholder|changeme|change[_-]?me|your[_-]|xxxx|\*\*\*|redacted|replace[_-]?me|insert[_-]|todo|fake|lorem|^(?:true|false|null|none|undefined)$/i;

function credentialAssignments(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  for (const m of text.matchAll(ASSIGNMENT)) {
    const name = m.groups!.name;
    const value = m.groups!.secret;
    const named = SECRET_NAME_SEGMENT.test(name) || SECRET_NAME_CAMEL.test(name) || PROVIDER_NAME.test(name);
    if (!named || NON_SECRET_SUFFIX.test(name) || REFERENCE_VALUE.test(value) || /^\d+$/.test(value) || /^(.)\1+$/.test(value) || /^https?:\/\/[^@]*$/.test(value)) {
      continue;
    }
    const start = m.index! + m[0].lastIndexOf(value);
    out.push({ start, end: start + value.length });
  }
  return out;
}

/** "the admin key is X", "my password: X", "token was X", "Bearer X", "use X as the key". */
const PROSE_BEFORE = /\b(?:api[ _-]?key|key|secret|token|password|passwd|passphrase|passcode|credentials?|pin)s?\b(?:\s+(?:is|was|=|:|->|would be|will be|are))+\s*["'`]?(?<secret>[^\s"'`,;]{8,})/gi;
const PROSE_AFTER = /\b(?:use|using|with|set|try|paste|is)\s+["'`]?(?<secret>[^\s"'`,;]{8,})["'`]?\s+(?:as|for)\s+(?:the|my|our|your|an?)?\s*(?:[\w-]+\s+){0,2}(?:api[ _-]?key|key|secret|token|password|passphrase|credentials?)\b/gi;
const BEARER = /\b(?:Bearer|Basic|Token)\s+(?<secret>[A-Za-z0-9._~+/=-]{12,})/g;
/** Long random-looking tokens under any name: mixed letters and digits, high entropy. Not hashes or UUIDs. */
const RANDOM_TOKEN = /(?<![\w/.-])(?<secret>[A-Za-z0-9_+/=-]{32,})(?![\w/.-])/g;

function entropy(v: string): number {
  const counts = new Map<string, number>();
  for (const c of v) {
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let e = 0;
  for (const n of counts.values()) {
    e -= (n / v.length) * Math.log2(n / v.length);
  }
  return e;
}

/** Prose values must look like a credential, not a word ("the key is important"). */
function credentialLike(v: string): boolean {
  if (/\d/.test(v) || (/[a-z]/.test(v) && /[A-Z]/.test(v)) || /[^A-Za-z]/.test(v)) {
    return !/^[A-Za-z]+\.$/.test(v);
  }
  const vowels = (v.match(/[aeiou]/gi) ?? []).length / v.length;
  return v.length >= 12 && vowels < 0.3;
}

function looseSecrets(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const push = (m: RegExpMatchArray) => {
    const value = m.groups!.secret;
    if (REFERENCE_VALUE.test(value) || /^\d+$/.test(value) || /^(.)\1+$/.test(value) || /^[a-z]+$/i.test(value) && value.length < 8) {
      return;
    }
    const start = m.index! + m[0].lastIndexOf(value);
    out.push({ start, end: start + value.length });
  };
  for (const re of [PROSE_BEFORE, PROSE_AFTER, BEARER]) {
    for (const m of text.matchAll(re)) {
      // Prose values must look like a credential, not an ordinary word ("the key is important").
      if (re !== BEARER && !credentialLike(m.groups!.secret)) {
        continue;
      }
      push(m);
    }
  }
  for (const m of text.matchAll(RANDOM_TOKEN)) {
    const v = m.groups!.secret;
    const hexOrUuid = /^[0-9a-f-]+$/i.test(v);
    const mixed = /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v);
    if (!hexOrUuid && mixed && entropy(v) >= 4 && !/^[A-Za-z]+(?:[_-][A-Za-z]+)+$/.test(v)) {
      push(m);
    }
  }
  return out;
}

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
    for (const a of [...credentialAssignments(text), ...looseSecrets(text)]) {
      if (!matches.some((x) => x.start < a.end && x.end > a.start)) {
        add({ ruleId: 'secrets', label: 'credential', category: 'secret', action: secrets, ...a });
      }
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
