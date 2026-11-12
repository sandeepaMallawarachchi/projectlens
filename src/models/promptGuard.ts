/**
 * Prompt Guard: organization policy that checks prompts sent to AI coding tools for sensitive
 * details before they leave a developer's machine. Shared by the extension, the hook script
 * and the API server. Prompt text is never part of any API payload.
 */

export const PROMPT_ACTIONS = ['off', 'warn', 'redact', 'block'] as const;
export type PromptAction = (typeof PROMPT_ACTIONS)[number];

export const PROMPT_MODES = ['off', 'optional', 'required'] as const;
export type PromptGuardMode = (typeof PROMPT_MODES)[number];

export const AI_TOOLS = ['claude', 'codex', 'cursor', 'copilot', 'antigravity'] as const;
export type AiTool = (typeof AI_TOOLS)[number];

export const AI_TOOL_LABELS: Record<AiTool, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
  antigravity: 'Antigravity'
};

/** Whether a tool's hook can stop a prompt (Copilot's prompt hook is observe-only). */
export const TOOL_CAN_BLOCK: Record<AiTool, boolean> = {
  claude: true,
  codex: true,
  cursor: true,
  copilot: false,
  antigravity: true
};

export const BUILTIN_DETECTORS = [
  { id: 'secrets', label: 'API keys, tokens, passwords, private keys, connection strings', category: 'secret', defaultAction: 'block' },
  { id: 'pii.card', label: 'Payment card numbers', category: 'pii', defaultAction: 'block' },
  { id: 'pii.email', label: 'Email addresses', category: 'pii', defaultAction: 'warn' },
  { id: 'pii.phone', label: 'Phone numbers', category: 'pii', defaultAction: 'warn' }
] as const;
export type BuiltinDetectorId = (typeof BUILTIN_DETECTORS)[number]['id'];

export interface CustomPromptRule {
  id: string;
  name: string;
  /** `term`: case-insensitive whole-word match; `regex`: JavaScript regular expression (case-insensitive). */
  type: 'term' | 'regex';
  pattern: string;
  action: Exclude<PromptAction, 'off'>;
}

export interface PromptPolicy {
  /** Increments on every change; hooks report which version they enforce. */
  version: number;
  mode: PromptGuardMode;
  /** Shown to members before they accept. Changing it (or the mode) requires renewed consent. */
  notice: string;
  /** Increments when the mode or notice changes. */
  consentVersion: number;
  builtin: Record<BuiltinDetectorId, PromptAction>;
  customRules: CustomPromptRule[];
  /** Exact strings that are never flagged (e.g. example keys in docs). */
  allowlist: string[];
  /** HTTPS endpoint notified about blocked/detected prompts (metadata only). */
  webhookUrl: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_NOTICE =
  'To protect customer data and credentials, this organization checks prompts sent to AI coding tools (Claude Code, Codex, Cursor, GitHub Copilot, Antigravity) on your computer. Prompts containing secrets or other sensitive details are blocked or flagged before they are sent. Your prompts are never uploaded: the organization only sees which rule matched, the tool, the project folder name and the time.';

export function defaultPromptPolicy(): PromptPolicy {
  return {
    version: 0,
    mode: 'off',
    notice: DEFAULT_NOTICE,
    consentVersion: 1,
    builtin: Object.fromEntries(BUILTIN_DETECTORS.map((d) => [d.id, d.defaultAction])) as Record<BuiltinDetectorId, PromptAction>,
    customRules: [],
    allowlist: [],
    webhookUrl: null,
    updatedAt: null,
    updatedBy: null
  };
}

/** What a hook reports. Never contains prompt text. */
export interface PromptEvent {
  /** Client-generated id (deduplication). */
  id: string;
  tool: AiTool;
  /** `blocked`: stopped; `warned`: allowed with a warning; `detected`: tool cannot block (Copilot). */
  action: 'blocked' | 'warned' | 'detected';
  ruleIds: string[];
  categories: string[];
  /** Workspace folder name only (no paths). */
  project: string | null;
  policyVersion: number;
  occurredAt: string;
}

/** Policy as written to disk for the hook script (enforcement state included). */
export interface LocalPromptPolicy {
  enabled: boolean;
  orgName: string;
  policy: PromptPolicy;
}

export type ConsentStatus = 'not_needed' | 'accepted' | 'declined' | 'pending';

export interface PromptGuardEventView extends PromptEvent {
  userId?: string;
  /** Member display name (admin view). */
  member?: string | null;
}

export interface PromptGuardMemberView {
  userId: string;
  name: string;
  role: string;
  consent: ConsentStatus;
  enabled: boolean;
  tools: AiTool[];
  upToDate: boolean;
  lastSeenAt: string | null;
  last30Days: { blocked: number; warned: number; detected: number };
}

/** Prompt Guard state shown in the dashboard. Contains no prompt text. */
export interface PromptGuardView {
  /** Signed in with an organization selected. */
  available: boolean;
  orgName: string | null;
  isAdmin: boolean;
  policy: PromptPolicy | null;
  consent: ConsentStatus;
  /** Hooks are enforcing the policy on this machine. */
  active: boolean;
  tools: { tool: AiTool; label: string; detected: boolean; installed: boolean; canBlock: boolean; note: string | null; error: string | null }[];
  events: PromptGuardEventView[];
  members: PromptGuardMemberView[];
  summary: { totals: { events: number; blocked: number; warned: number; detected: number }; byRule: Record<string, number>; members: { total: number; accepted: number; pending: number; declined: number; protected: number } } | null;
  pendingUploads: number;
  hasSanitizedCopy: boolean;
  busy: string | null;
  error: string | null;
}

export const EMPTY_PROMPT_GUARD = (): PromptGuardView => ({
  available: false,
  orgName: null,
  isAdmin: false,
  policy: null,
  consent: 'not_needed',
  active: false,
  tools: [],
  events: [],
  members: [],
  summary: null,
  pendingUploads: 0,
  hasSanitizedCopy: false,
  busy: null,
  error: null
});
