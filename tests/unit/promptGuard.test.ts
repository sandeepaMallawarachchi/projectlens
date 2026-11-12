import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { checkPrompt, luhn } from '../../src/promptGuard/detector';
import { evaluateHook, projectOf } from '../../src/promptGuard/hookCore';
import { allToolStatus, installHook, uninstallHook, writeRuntime, type HookPaths } from '../../src/promptGuard/installers';
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
