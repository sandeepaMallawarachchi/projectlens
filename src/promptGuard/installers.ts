import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { AI_TOOLS, type AiTool } from '../models/promptGuard';

/**
 * Installs the Prompt Guard hook into each AI coding tool's user-level configuration.
 * - Merges into existing files and only touches entries whose command points at our launcher.
 * - Backs up the original file once (`<file>.projectlens-backup`).
 * - Refuses to modify a file it cannot parse, rather than overwriting the user's settings.
 */

export const HOOK_TIMEOUT_SECONDS = 10;

export interface HookPaths {
  home: string;
  /** Folder holding prompt-guard.js, launchers, policy.json and events.jsonl. */
  dir: string;
  windows: boolean;
}

export interface ToolStatus {
  tool: AiTool;
  /** The tool appears to be installed on this machine. */
  detected: boolean;
  installed: boolean;
  configPath: string;
  /** Extra step the user must take (e.g. trusting the hook in Codex). */
  note: string | null;
  error: string | null;
}

export function defaultHookDir(home: string): string {
  return join(home, '.projectlens', 'prompt-guard');
}

export function launcherPath(paths: HookPaths, tool: AiTool): string {
  return join(paths.dir, `hook-${tool}.${paths.windows ? 'cmd' : 'sh'}`);
}

/** Shell command that runs our launcher (quoted when the path contains spaces). */
export function hookCommand(paths: HookPaths, tool: AiTool): string {
  const p = launcherPath(paths, tool);
  return /\s/.test(p) ? `"${p}"` : p;
}

const isOurs = (command: unknown) => typeof command === 'string' && /[\\/]\.projectlens[\\/]prompt-guard[\\/]hook-/.test(command);

type Json = Record<string, unknown>;

function readConfig(path: string): Json {
  if (!existsSync(path)) {
    return {};
  }
  const text = readFileSync(path, 'utf8');
  if (!text.trim()) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSON (comments are not supported). Fix or back up the file, then try again.`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${path} does not contain a JSON object`);
  }
  return parsed as Json;
}

function writeConfig(path: string, config: Json): void {
  mkdirSync(dirname(path), { recursive: true });
  const backup = `${path}.projectlens-backup`;
  if (existsSync(path) && !existsSync(backup)) {
    copyFileSync(path, backup);
  }
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Claude Code and Codex share the matcher-group format: `hooks.UserPromptSubmit[].hooks[]`. */
function groupHasOurs(group: unknown): boolean {
  return arr(obj(group).hooks).some((h) => isOurs(obj(h).command));
}

function withoutOursGroups(groups: unknown[]): unknown[] {
  return groups
    .map((g) => {
      const o = obj(g);
      if (!groupHasOurs(o)) {
        return g;
      }
      const rest = arr(o.hooks).filter((h) => !isOurs(obj(h).command));
      return rest.length ? { ...o, hooks: rest } : null;
    })
    .filter((g) => g !== null);
}

interface ToolInstaller {
  configPath(p: HookPaths): string;
  detect(p: HookPaths): boolean;
  has(config: Json): boolean;
  add(config: Json, command: string): Json;
  remove(config: Json): Json;
  note: string | null;
  /** The whole file belongs to us (delete it on uninstall). */
  ownFile?: boolean;
}

function eventGroupInstaller(dirName: string, file: string, event: string, extra: Json = {}, note: string | null = null): ToolInstaller {
  return {
    configPath: (p) => join(p.home, dirName, file),
    detect: (p) => existsSync(join(p.home, dirName)),
    has: (c) => arr(obj(c.hooks)[event]).some(groupHasOurs),
    add: (c, command) => {
      const hooks = obj(c.hooks);
      const groups = withoutOursGroups(arr(hooks[event]));
      groups.push({ hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }] });
      return { ...extra, ...c, hooks: { ...hooks, [event]: groups } };
    },
    remove: (c) => {
      const hooks = { ...obj(c.hooks) };
      const groups = withoutOursGroups(arr(hooks[event]));
      if (groups.length) {
        hooks[event] = groups;
      } else {
        delete hooks[event];
      }
      return { ...c, hooks };
    },
    note
  };
}

const ANTIGRAVITY_HOOK = 'projectlens-prompt-guard';

export const INSTALLERS: Record<AiTool, ToolInstaller> = {
  claude: eventGroupInstaller('.claude', 'settings.json', 'UserPromptSubmit'),
  codex: eventGroupInstaller('.codex', 'hooks.json', 'UserPromptSubmit', {}, 'Codex runs new hooks only after you trust them: open Codex and run /hooks (CLI) or Settings → Hooks (app), then trust "ProjectLens Prompt Guard".'),
  cursor: {
    configPath: (p) => join(p.home, '.cursor', 'hooks.json'),
    detect: (p) => existsSync(join(p.home, '.cursor')),
    has: (c) => arr(obj(c.hooks).beforeSubmitPrompt).some((h) => isOurs(obj(h).command)),
    add: (c, command) => {
      const hooks = obj(c.hooks);
      const list = arr(hooks.beforeSubmitPrompt).filter((h) => !isOurs(obj(h).command));
      list.push({ command, timeout: HOOK_TIMEOUT_SECONDS });
      return { version: 1, ...c, hooks: { ...hooks, beforeSubmitPrompt: list } };
    },
    remove: (c) => {
      const hooks = { ...obj(c.hooks) };
      const list = arr(hooks.beforeSubmitPrompt).filter((h) => !isOurs(obj(h).command));
      if (list.length) {
        hooks.beforeSubmitPrompt = list;
      } else {
        delete hooks.beforeSubmitPrompt;
      }
      return { ...c, hooks };
    },
    note: null
  },
  copilot: {
    configPath: (p) => join(p.home, '.copilot', 'hooks', 'projectlens-prompt-guard.json'),
    // Used by Copilot in VS Code, the Copilot CLI and the Copilot app.
    detect: () => true,
    has: (c) => arr(obj(c.hooks).userPromptSubmitted).some((h) => isOurs(obj(h).bash) || isOurs(obj(h).powershell)),
    add: (_c, command) => ({
      version: 1,
      hooks: { userPromptSubmitted: [{ type: 'command', bash: command, powershell: `& ${command.startsWith('"') ? command : `"${command}"`}`, timeoutSec: HOOK_TIMEOUT_SECONDS }] }
    }),
    remove: () => ({}),
    ownFile: true,
    note: 'GitHub Copilot hooks can observe prompts but cannot stop them. ProjectLens alerts you right after a sensitive prompt so you can rotate the secret.'
  },
  antigravity: {
    configPath: (p) => join(p.home, '.gemini', 'config', 'hooks.json'),
    detect: (p) => existsSync(join(p.home, '.gemini')),
    has: (c) => arr(obj(c[ANTIGRAVITY_HOOK]).PreInvocation).some((h) => isOurs(obj(h).command)),
    add: (c, command) => ({ ...c, [ANTIGRAVITY_HOOK]: { enabled: true, PreInvocation: [{ type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }] } }),
    remove: (c) => {
      const rest = { ...c };
      delete rest[ANTIGRAVITY_HOOK];
      return rest;
    },
    note: null
  }
};

export function toolStatus(paths: HookPaths, tool: AiTool): ToolStatus {
  const inst = INSTALLERS[tool];
  const configPath = inst.configPath(paths);
  try {
    const installed = inst.has(readConfig(configPath)) && existsSync(launcherPath(paths, tool));
    return { tool, detected: inst.detect(paths) || installed, installed, configPath, note: inst.note, error: null };
  } catch (err) {
    return { tool, detected: inst.detect(paths), installed: false, configPath, note: inst.note, error: err instanceof Error ? err.message : String(err) };
  }
}

export function allToolStatus(paths: HookPaths): ToolStatus[] {
  return AI_TOOLS.map((t) => toolStatus(paths, t));
}

/**
 * Writes the hook script and per-tool launchers. Launchers prefer `node` on PATH and fall back to
 * the editor's own runtime (`ELECTRON_RUN_AS_NODE`), and exit 0 if neither exists (fail open).
 */
export function writeRuntime(paths: HookPaths, hookScript: string, nodeFallback: string): void {
  mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
  copyFileSync(hookScript, join(paths.dir, 'prompt-guard.js'));
  for (const tool of AI_TOOLS) {
    const file = launcherPath(paths, tool);
    if (paths.windows) {
      writeFileSync(
        file,
        [
          '@echo off',
          'rem ProjectLens Prompt Guard hook (generated). Lets prompts through if it cannot run.',
          'where node >nul 2>nul',
          `if %ERRORLEVEL%==0 ( node "%~dp0prompt-guard.js" ${tool} & exit /b 0 )`,
          `if exist "${nodeFallback}" ( set ELECTRON_RUN_AS_NODE=1& "${nodeFallback}" "%~dp0prompt-guard.js" ${tool} & exit /b 0 )`,
          'exit /b 0',
          ''
        ].join('\r\n')
      );
    } else {
      writeFileSync(
        file,
        [
          '#!/bin/sh',
          '# ProjectLens Prompt Guard hook (generated). Lets prompts through if it cannot run.',
          'DIR="$(cd "$(dirname "$0")" && pwd)"',
          `if command -v node >/dev/null 2>&1; then exec node "$DIR/prompt-guard.js" ${tool}; fi`,
          `if [ -x ${shQuote(nodeFallback)} ]; then ELECTRON_RUN_AS_NODE=1 exec ${shQuote(nodeFallback)} "$DIR/prompt-guard.js" ${tool}; fi`,
          'exit 0',
          ''
        ].join('\n')
      );
      chmodSync(file, 0o755);
    }
  }
}

function shQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function installHook(paths: HookPaths, tool: AiTool): ToolStatus {
  const inst = INSTALLERS[tool];
  const path = inst.configPath(paths);
  const config = inst.ownFile ? {} : readConfig(path);
  writeConfig(path, inst.add(config, hookCommand(paths, tool)));
  return toolStatus(paths, tool);
}

export function uninstallHook(paths: HookPaths, tool: AiTool): ToolStatus {
  const inst = INSTALLERS[tool];
  const path = inst.configPath(paths);
  if (inst.ownFile) {
    rmSync(path, { force: true });
  } else if (existsSync(path)) {
    const config = readConfig(path);
    if (inst.has(config)) {
      writeConfig(path, inst.remove(config));
    }
  }
  return toolStatus(paths, tool);
}
