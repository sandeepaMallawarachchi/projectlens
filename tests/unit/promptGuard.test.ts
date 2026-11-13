import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkPrompt, luhn } from '../../src/promptGuard/detector';
import { evaluateHook, projectOf } from '../../src/promptGuard/hookCore';
import { allToolStatus, hookCommand, installHook, refreshInstalledHooks, uninstallHook, writeRuntime, type HookPaths } from '../../src/promptGuard/installers';
import { defaultPromptPolicy, type LocalPromptPolicy, type PromptPolicy } from '../../src/models/promptGuard';

// Built at runtime so this file contains no literal credential.
const AWS = ['AKIA', 'Q3EGRT7ZPM2LXWKD'].join('');
const GH = ['ghp_', 'R8sT2vX9yZ4bN6mQ1wE3rT5yU7iO9pA2sD4f'].join('');

const policy = (over: Partial<PromptPolicy> = {}): PromptPolicy => ({ ...defaultPromptPolicy(), mode: 'required', version: 3, ...over });
const local = (over: Partial<PromptPolicy> = {}): LocalPromptPolicy => ({ enabled: true, orgName: 'Acme', policy: policy(over) });

describe('Prompt Guard detector', () => {
  it('blocks secrets and replaces them in the sanitized copy', () => {
    const r = checkPrompt(`deploy with key ${AWS} please`, policy());
    expect(r.action).toBe('block');
    expect(r.ruleIds).toEqual(['secrets']);
    expect(r.sanitized).not.toContain(AWS);
    expect(r.sanitized).toMatch(/^deploy with key \[REDACTED .+\] please$/);
  });

  it('blocks .env-style and prose credential assignments that the code scanner skips', () => {
    for (const prompt of [
      'PROJECTLENS_ADMIN_KEY=abswbdedjfnjefbf check this key correctly configured',
      'export DB_PASSWORD="s3cretpass99"',
      'my api key: sk9f8g7h6j5k4l3m',
      'set clientSecret = qwertyuiop12 in the config',
      'SECRET_KEY_BASE=8f3a9c1d2e7b6a5f'
    ]) {
      const r = checkPrompt(prompt, policy());
      expect(r.action, prompt).toBe('block');
    }
    const r = checkPrompt('PROJECTLENS_ADMIN_KEY=abswbdedjfnjefbf check', policy());
    expect(r.sanitized).toBe('PROJECTLENS_ADMIN_KEY=[REDACTED credential] check');
  });

  it('catches keys under other names, in prose, and as long random tokens', () => {
    const v = 'abswbdedjfnjefbf';
    for (const prompt of [
      `STRIPE_SK=${v}`,
      `OPENAI=${v}`,
      `SUPABASE_SERVICE_ROLE=${v}`,
      `PASSPHRASE=${v}`,
      `WEBHOOK_SIGNING=${v}`,
      `SESSION_COOKIE=${v}`,
      `the admin key is ${v}`,
      `use ${v} as the admin key`,
      `my password: hunter2024`,
      `curl -H "Authorization: Bearer ${v}"`,
      `here it is: ${['Zx9', 'Qw2LmP8vRt5Kn3Hy7Bc4Df6Gj1Ss0Ae'].join('')}`
    ]) {
      expect(checkPrompt(prompt, policy()).action, prompt).toBe('block');
    }
  });

  it('does not flag ordinary text, hashes or ids', () => {
    for (const prompt of [
      'the key is important for caching',
      'the token was refreshed correctly',
      'use the password field as the login key',
      'commit 3f9a2c4d1e8b7a6f5c4d3e2f1a0b9c8d7e6f5a4b broke the build',
      'id 123e4567-e89b-12d3-a456-426614174000 is missing',
      'CLIENT_ID=my-app-frontend',
      'rename handleUserAuthenticationCallbackFunction to onAuth'
    ]) {
      expect(checkPrompt(prompt, policy()).action, prompt).toBe('none');
    }
  });

  it('ignores credential names without real values', () => {
    for (const prompt of [
      'PROJECTLENS_ADMIN_KEY= is empty in .env.example',
      'set API_KEY=${API_KEY} from the environment',
      'apiKey: process.env.API_KEY',
      'TOKEN_EXPIRY=86400000 and JWT_SECRET_LENGTH=64',
      'OPENAI_API_KEY=<your-key-here>',
      'password=changeme123',
      'the keyboard layout: dvorak-intl',
      'Authorization: Bearer <key>'
    ]) {
      expect(checkPrompt(prompt, policy()).action, prompt).toBe('none');
    }
  });

  it('redacts whole private key blocks', () => {
    const pem = ['-----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEA1c7+abc', 'def123==', '-----END RSA PRIVATE KEY-----'].join('\n');
    const r = checkPrompt(`why does this fail?\n${pem}\nthanks`, policy());
    expect(r.action).toBe('block');
    expect(r.sanitized).not.toContain('MIIEow');
    expect(r.sanitized).toContain('thanks');
  });

  it('warns on emails and phone numbers but ignores placeholders and version numbers', () => {
    const r = checkPrompt('email jane.doe@acme-corp.io or call +1 415 555 0132 about v1.2.3', policy());
    expect(r.action).toBe('warn');
    expect(r.ruleIds.sort()).toEqual(['pii.email', 'pii.phone']);
    expect(checkPrompt('use user@example.com as the sample', policy()).action).toBe('none');
    expect(checkPrompt('bump from 1.2.3 to 1.20.300 and port 3000', policy()).action).toBe('none');
  });

  it('flags only Luhn-valid card numbers', () => {
    expect(luhn('4111111111111111')).toBe(true);
    expect(checkPrompt('card 4111 1111 1111 1111 declined', policy()).ruleIds).toEqual(['pii.card']);
    expect(checkPrompt('order id 4111 1111 1111 1112', policy()).action).toBe('none');
  });

  it('applies custom terms and regexes, and honors the allowlist and off switches', () => {
    const p = policy({
      customRules: [
        { id: 'falcon', name: 'Codename', type: 'term', pattern: 'Project Falcon', action: 'block' },
        { id: 'host', name: 'Internal host', type: 'regex', pattern: '[a-z0-9-]+\\.corp\\.acme\\.net', action: 'warn' }
      ]
    });
    expect(checkPrompt('status of project falcon?', p).ruleIds).toEqual(['custom.falcon']);
    expect(checkPrompt('falconry is fun', p).action).toBe('none');
    expect(checkPrompt('ssh db-01.corp.acme.net', p)).toMatchObject({ action: 'warn', ruleIds: ['custom.host'] });
    expect(checkPrompt(`key ${AWS}`, policy({ allowlist: [AWS] })).action).toBe('none');
    expect(checkPrompt(`key ${AWS}`, policy({ builtin: { ...defaultPromptPolicy().builtin, secrets: 'off' } })).action).toBe('none');
  });
});

describe('Prompt Guard hook protocol', () => {
  const secret = `here is my token ${GH}`;

  it('passes everything through when disabled, off or clean', () => {
    expect(evaluateHook('claude', { prompt: secret }, null).stdout).toBe('');
    expect(evaluateHook('claude', { prompt: secret }, { ...local(), enabled: false }).stdout).toBe('');
    expect(evaluateHook('claude', { prompt: secret }, local({ mode: 'off' })).stdout).toBe('');
    expect(evaluateHook('claude', { prompt: 'refactor the login form' }, local())).toMatchObject({ stdout: '', event: null });
  });

  it('uses each tool\'s block format and never puts prompt text in the event', () => {
    const claude = evaluateHook('claude', { prompt: secret, cwd: '/Users/dev/work/web-app' }, local());
    const out = JSON.parse(claude.stdout);
    expect(out).toMatchObject({ decision: 'block', hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true } });
    expect(out.reason).toContain('Acme policy');
    expect(out.reason).not.toContain(GH);
    expect(claude.event).toMatchObject({ tool: 'claude', action: 'blocked', ruleIds: ['secrets'], project: 'web-app', policyVersion: 3 });
    expect(JSON.stringify(claude.event)).not.toContain('token');

    expect(JSON.parse(evaluateHook('codex', { prompt: secret }, local()).stdout)).toMatchObject({ decision: 'block' });
    expect(JSON.parse(evaluateHook('cursor', { prompt: secret, workspace_roots: ['C:\\src\\api'] }, local()).stdout)).toMatchObject({ continue: false });
    expect(projectOf('cursor', { workspace_roots: ['C:\\src\\api'] })).toBe('api');
    const ag = JSON.parse(evaluateHook('antigravity', { lastUserInput: secret, conversationId: 'c1' }, local()).stdout);
    expect(ag).toMatchObject({ terminationBehavior: 'terminate', injectSteps: [{ errorMessage: { userMessage: expect.stringContaining('blocked') } }] });
  });

  it('records Copilot prompts as detected (Copilot cannot block)', () => {
    const r = evaluateHook('copilot', { prompt: secret, cwd: '/x/repo' }, local());
    expect(r.stdout).toBe('');
    expect(r.event?.action).toBe('detected');
  });

  it('warns without blocking', () => {
    const r = evaluateHook('claude', { prompt: 'ping jane.doe@acme-corp.io' }, local());
    expect(JSON.parse(r.stdout).systemMessage).toContain('email address');
    expect(r.event?.action).toBe('warned');
    expect(evaluateHook('codex', { prompt: 'ping jane.doe@acme-corp.io' }, local()).stdout).toBe('');
  });

  it('deduplicates Antigravity invocations of the same prompt', () => {
    const first = evaluateHook('antigravity', { lastUserInput: secret, conversationId: 'c9' }, local());
    const seen = { [first.dedupeKey!]: true };
    const again = evaluateHook('antigravity', { lastUserInput: secret, conversationId: 'c9' }, local(), seen);
    expect(again.event).toBeNull();
    expect(JSON.parse(again.stdout).terminationBehavior).toBe('terminate');
  });
});

describe('Prompt Guard installers', () => {
  let home: string;
  let paths: HookPaths;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'pg-home-'));
    paths = { home, dir: join(home, '.projectlens', 'prompt-guard'), windows: false };
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  it('merges into existing Claude settings, keeps other hooks, backs up, and removes cleanly', () => {
    mkdirSync(join(home, '.claude'));
    const original = { model: 'opus', hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo mine' }] }], Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } };
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(original));
    writeRuntime(paths, __filename, process.execPath);

    expect(installHook(paths, 'claude').installed).toBe(true);
    installHook(paths, 'claude'); // idempotent
    const cfg = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'));
    expect(cfg.model).toBe('opus');
    expect(cfg.hooks.Stop).toEqual(original.hooks.Stop);
    expect(cfg.hooks.UserPromptSubmit).toHaveLength(2);
    expect(cfg.hooks.UserPromptSubmit[1].hooks[0]).toMatchObject({ type: 'command', timeout: 10, command: expect.stringContaining('hook-claude.sh') });
    expect(existsSync(join(home, '.claude', 'settings.json.projectlens-backup'))).toBe(true);

    expect(uninstallHook(paths, 'claude').installed).toBe(false);
    expect(JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'))).toEqual(original);
  });

  it('writes the documented formats for Codex, Cursor, Copilot and Antigravity', () => {
    for (const d of ['.codex', '.cursor', '.gemini']) {
      mkdirSync(join(home, d));
    }
    writeRuntime(paths, __filename, process.execPath);
    for (const t of ['codex', 'cursor', 'copilot', 'antigravity'] as const) {
      installHook(paths, t);
    }
    const read = (...p: string[]) => JSON.parse(readFileSync(join(home, ...p), 'utf8'));
    expect(read('.codex', 'hooks.json').hooks.UserPromptSubmit[0].hooks[0].command).toContain('hook-codex.sh');
    expect(read('.cursor', 'hooks.json')).toMatchObject({ version: 1, hooks: { beforeSubmitPrompt: [{ command: expect.stringContaining('hook-cursor.sh') }] } });
    expect(read('.copilot', 'hooks', 'projectlens-prompt-guard.json')).toMatchObject({ version: 1, hooks: { userPromptSubmitted: [{ type: 'command', bash: expect.stringContaining('hook-copilot.sh'), timeoutSec: 10 }] } });
    expect(read('.gemini', 'config', 'hooks.json')['projectlens-prompt-guard'].PreInvocation[0].command).toContain('hook-antigravity.sh');
    expect(allToolStatus(paths).filter((s) => s.tool !== 'claude').every((s) => s.installed)).toBe(true);
    expect(statSync(join(paths.dir, 'hook-cursor.sh')).mode & 0o111).toBeTruthy();

    uninstallHook(paths, 'copilot');
    expect(existsSync(join(home, '.copilot', 'hooks', 'projectlens-prompt-guard.json'))).toBe(false);
  });

  it('installs the Claude Code hook with PowerShell on Windows and migrates old entries', () => {
    const win: HookPaths = { home, dir: join(home, '.projectlens', 'prompt-guard'), windows: true };
    mkdirSync(join(home, '.claude'));
    writeRuntime(win, __filename, 'C:\\Program Files\\Microsoft VS Code\\Code.exe');
    // An entry as written by 0.3.x: a bare path, which Git Bash cannot run.
    const old = join(win.dir, 'hook-claude.cmd');
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: old, timeout: 10 }] }] } }));
    expect(refreshInstalledHooks(win)).toEqual(['claude']);
    const entry = JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).hooks.UserPromptSubmit;
    expect(entry).toHaveLength(1);
    expect(entry[0].hooks[0]).toEqual({ type: 'command', command: `& '${old}'`, shell: 'powershell', timeout: 10 });
    // Codex keeps the plain path (it already works on Windows).
    mkdirSync(join(home, '.codex'));
    installHook(win, 'codex');
    const codex = JSON.parse(readFileSync(join(home, '.codex', 'hooks.json'), 'utf8')).hooks.UserPromptSubmit[0].hooks[0];
    expect(codex.shell).toBeUndefined();
    expect(codex.command).toBe(join(win.dir, 'hook-codex.cmd'));
    // Unchanged files are not rewritten.
    const before = statSync(join(home, '.claude', 'settings.json')).mtimeMs;
    refreshInstalledHooks(win);
    expect(statSync(join(home, '.claude', 'settings.json')).mtimeMs).toBe(before);
  });

  it('escapes single quotes in the PowerShell path', () => {
    const win: HookPaths = { home: "C:\\Users\\o'brien", dir: "C:\\Users\\o'brien\\.projectlens\\prompt-guard", windows: true };
    expect(hookCommand(win, 'claude')).toMatch(/^& 'C:.*o''brien.*hook-claude\.cmd'$/);
  });

  it('refuses to overwrite a settings file it cannot parse', () => {
    mkdirSync(join(home, '.claude'));
    writeFileSync(join(home, '.claude', 'settings.json'), '{ // comment\n "a": 1 }');
    expect(() => installHook(paths, 'claude')).toThrow(/not valid JSON/);
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toContain('// comment');
  });
});

describe('Prompt Guard hook script (bundled)', () => {
  const script = join(__dirname, '../../dist/prompt-guard.js');
  it.skipIf(!existsSync(script) || process.platform === 'win32')('blocks via the launcher and logs a metadata-only event', () => {
    const home = mkdtempSync(join(tmpdir(), 'pg-run-'));
    try {
      const paths: HookPaths = { home, dir: join(home, '.projectlens', 'prompt-guard'), windows: false };
      writeRuntime(paths, script, process.execPath);
      writeFileSync(join(paths.dir, 'policy.json'), JSON.stringify(local()));
      const out = execFileSync(join(paths.dir, 'hook-claude.sh'), { input: JSON.stringify({ prompt: `use ${GH}`, cwd: '/tmp/demo' }) }).toString();
      expect(JSON.parse(out).decision).toBe('block');
      const events = readFileSync(join(paths.dir, 'events.jsonl'), 'utf8');
      expect(events).toContain('"action":"blocked"');
      expect(events).not.toContain(GH);
      expect(readFileSync(join(paths.dir, 'last-sanitized.txt'), 'utf8')).toMatch(/^use \[REDACTED/);
      // Malformed input fails open.
      expect(execFileSync(join(paths.dir, 'hook-claude.sh'), { input: 'not json' }).toString()).toBe('');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
