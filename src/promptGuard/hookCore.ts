import { createHash, randomBytes } from 'node:crypto';
import { AI_TOOL_LABELS, TOOL_CAN_BLOCK, type AiTool, type LocalPromptPolicy, type PromptEvent } from '../models/promptGuard';
import { checkPrompt, describeMatches, type PromptCheck } from './detector';

/**
 * Tool-specific hook protocol for Prompt Guard. Pure: no filesystem or process access, so it is
 * unit-tested directly. The entry point (hook.ts) handles stdin/stdout and files.
 *
 * Output formats (from each tool's hook documentation):
 * - Claude Code `UserPromptSubmit`: `{"decision":"block","reason"}`; warnings via `systemMessage`.
 * - Codex `UserPromptSubmit`: `{"decision":"block","reason"}`.
 * - Cursor `beforeSubmitPrompt`: `{"continue":false,"user_message"}`.
 * - GitHub Copilot `userPromptSubmitted`: output is ignored (observe only), so events are `detected`.
 * - Antigravity `PreInvocation`: `{"injectSteps":[{"errorMessage":{"userMessage"}}],"terminationBehavior":"terminate"}`.
 */

export interface HookOutcome {
  /** JSON printed to stdout ('' = print nothing). Exit code is always 0 (fail open). */
  stdout: string;
  event: PromptEvent | null;
  /** Sanitized prompt to save locally for "Copy Sanitized Prompt" (never uploaded). */
  sanitized: string | null;
  /** Antigravity: dedupe key of this prompt. */
  dedupeKey?: string;
  check: PromptCheck | null;
}

const PASS: HookOutcome = { stdout: '', event: null, sanitized: null, check: null };
const MAX_SANITIZED_IN_MESSAGE = 3000;

type Input = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Extracts the prompt text from a tool's hook input. */
export function promptOf(tool: AiTool, input: Input): string | null {
  switch (tool) {
    case 'antigravity':
      return str(input.lastUserInput);
    default:
      return str(input.prompt);
  }
}

/** Folder name of the workspace the prompt came from (never a full path). */
export function projectOf(tool: AiTool, input: Input): string | null {
  const first = (v: unknown) => (Array.isArray(v) && typeof v[0] === 'string' ? (v[0] as string) : null);
  const path = tool === 'cursor' ? first(input.workspace_roots) ?? str(input.cwd) : tool === 'antigravity' ? first(input.workspacePaths) : str(input.cwd);
  if (!path) {
    return null;
  }
  const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
  return name ? name.slice(0, 100) : null;
}

export function antigravityKey(input: Input, prompt: string): string {
  return createHash('sha256').update(`${str(input.conversationId) ?? ''}\u0000${prompt}`).digest('hex').slice(0, 32);
}

function blockMessage(local: LocalPromptPolicy, check: PromptCheck): string {
  const found = describeMatches(check.matches.filter((m) => m.action === 'block' || m.action === 'redact'));
  const sanitized = check.sanitized.length > MAX_SANITIZED_IN_MESSAGE ? `${check.sanitized.slice(0, MAX_SANITIZED_IN_MESSAGE)}\n[…truncated]` : check.sanitized;
  return [
    `ProjectLens Prompt Guard blocked this prompt (${local.orgName} policy). Found: ${found}.`,
    'Nothing was sent. Remove the sensitive part and try again, or resend this sanitized copy (also available via "ProjectLens: Copy Sanitized Prompt" in VS Code):',
    '',
    sanitized
  ].join('\n');
}

function warnMessage(local: LocalPromptPolicy, check: PromptCheck): string {
  return `ProjectLens Prompt Guard (${local.orgName} policy): this prompt was sent, but it contains sensitive details (${describeMatches(check.matches)}). Avoid sharing them with AI tools.`;
}

function makeEvent(tool: AiTool, action: PromptEvent['action'], check: PromptCheck, input: Input, local: LocalPromptPolicy, now: Date): PromptEvent {
  return {
    id: `pg-${randomBytes(12).toString('hex')}`,
    tool,
    action,
    ruleIds: check.ruleIds.slice(0, 20),
    categories: check.categories,
    project: projectOf(tool, input),
    policyVersion: local.policy.version,
    occurredAt: now.toISOString()
  };
}

/**
 * Decides what a hook does with one prompt. `seen` (Antigravity only) maps dedupe keys of prompts
 * already checked in this conversation to whether they were blocked, since PreInvocation fires
 * before every model call, not once per prompt.
 */
export function evaluateHook(tool: AiTool, input: Input, local: LocalPromptPolicy | null, seen: Record<string, boolean> = {}, now = new Date()): HookOutcome {
  if (!local || !local.enabled || local.policy.mode === 'off') {
    return PASS;
  }
  const prompt = promptOf(tool, input);
  if (!prompt || !prompt.trim()) {
    return PASS;
  }
  let dedupeKey: string | undefined;
  if (tool === 'antigravity') {
    dedupeKey = antigravityKey(input, prompt);
    if (dedupeKey in seen) {
      return seen[dedupeKey] ? { ...PASS, stdout: antigravityBlock('ProjectLens Prompt Guard blocked this prompt. Edit it and try again.'), dedupeKey } : { ...PASS, dedupeKey };
    }
  }

  const check = checkPrompt(prompt, local.policy);
  if (check.action === 'none') {
    return { ...PASS, dedupeKey, check };
  }
  const stops = check.action === 'block' || check.action === 'redact';

  if (!TOOL_CAN_BLOCK[tool]) {
    return { stdout: '', event: makeEvent(tool, stops ? 'detected' : 'warned', check, input, local, now), sanitized: stops ? check.sanitized : null, check };
  }
  if (!stops) {
    const stdout = tool === 'claude' ? JSON.stringify({ systemMessage: warnMessage(local, check) }) : tool === 'cursor' ? JSON.stringify({ continue: true }) : '';
    return { stdout, event: makeEvent(tool, 'warned', check, input, local, now), sanitized: null, dedupeKey, check };
  }

  const message = blockMessage(local, check);
  let stdout: string;
  switch (tool) {
    case 'claude':
      stdout = JSON.stringify({ decision: 'block', reason: message, hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true } });
      break;
    case 'codex':
      stdout = JSON.stringify({ decision: 'block', reason: message });
      break;
    case 'cursor':
      stdout = JSON.stringify({ continue: false, user_message: message });
      break;
    default:
      stdout = antigravityBlock(message);
  }
  return { stdout, event: makeEvent(tool, 'blocked', check, input, local, now), sanitized: check.sanitized, dedupeKey, check };
}

function antigravityBlock(message: string): string {
  return JSON.stringify({ injectSteps: [{ errorMessage: { userMessage: message } }], terminationBehavior: 'terminate' });
}

export function toolLabel(tool: AiTool): string {
  return AI_TOOL_LABELS[tool];
}
