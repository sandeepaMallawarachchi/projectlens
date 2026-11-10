import { describe, expect, it } from 'vitest';
import { redactSecret, redactText, redactPrivateKeyBlocks, safeEvidence } from '../../src/utils/redaction';
import { buildContext, exclusionReason, renderUserPrompt } from '../../src/ai/contextBuilder';
import { DUMMY, scanFixture } from './helpers';
import { promises as fs } from 'node:fs';
import { uriToPath } from '../../src/utils/paths';

describe('redaction', () => {
  it('previews secrets without revealing them', () => {
    const preview = redactSecret(DUMMY.groq);
    expect(preview).not.toContain(DUMMY.groq);
    expect(preview.startsWith('gsk_')).toBe(true);
    expect(preview).toContain(`${DUMMY.groq.length} chars`);
    expect(redactSecret('short1234')).not.toMatch(/^sh/);
  });

  it('redacts every detected secret in text', () => {
    const text = `aws=${DUMMY.aws}\nconst password = "${DUMMY.genericPassword}";\nkeep = 1`;
    const { text: out, redactions } = redactText(text, 'marker');
    expect(redactions).toBe(2);
    expect(out).not.toContain(DUMMY.aws);
    expect(out).not.toContain(DUMMY.genericPassword);
    expect(out).toContain('[REDACTED:aws-access-key]');
    expect(out).toContain('keep = 1');
  });

  it('redacts private key bodies', () => {
    const pem = `${DUMMY.privateKeyHeader}\nMIIEsecretbody\n-----END RSA PRIVATE KEY-----`;
    const out = redactPrivateKeyBlocks(pem);
    expect(out).not.toContain('MIIEsecretbody');
    expect(out).toContain('[REDACTED PRIVATE KEY]');
  });

  it('truncates and redacts evidence', () => {
    expect(safeEvidence(`   token: "${DUMMY.github}"   `)).not.toContain(DUMMY.github);
    expect(safeEvidence('x'.repeat(500)).length).toBeLessThanOrEqual(181);
  });
});

describe('AI context builder', () => {
  const reader = async (uri: string) => {
    const p = uriToPath(uri);
    return p ? fs.readFile(p, 'utf8').catch(() => null) : null;
  };

  it('never sends sensitive files and excludes them with a reason', () => {
    expect(exclusionReason('.env')).toBe('environment file');
    expect(exclusionReason('config/.env.production')).toBe('environment file');
    expect(exclusionReason('keys/server.pem')).toBe('key or certificate');
    expect(exclusionReason('package-lock.json')).toBe('lockfile');
    expect(exclusionReason('src/app.ts')).toBeNull();
  });

  it('builds a redacted, budgeted context for a finding explanation', async () => {
    const scan = await scanFixture('vulnerable-app');
    const finding = scan.findings.find((f) => f.ruleId === 'secret/connection-string')!;
    const ctx = await buildContext({ task: 'explainFinding', scan, findingId: finding.id }, reader, 4000);
    const prompt = renderUserPrompt(ctx, 'Explain');
    expect(prompt).not.toContain('Wk3Rm9Tq2LxZ');
    expect(prompt).toContain('[REDACTED:');
    expect(ctx.files.map((f) => f.path)).toEqual(['src/config.js']);
    expect(ctx.allowedPaths.has('src/config.js')).toBe(true);
    expect(ctx.estimatedTokens).toBeLessThan(4000);
  });

  it('excludes env files even when a finding points at them', async () => {
    const scan = await scanFixture('vulnerable-app');
    const finding = scan.findings.find((f) => f.location.file === '.env')!;
    const ctx = await buildContext({ task: 'explainFinding', scan, findingId: finding.id }, reader, 4000);
    expect(ctx.files).toHaveLength(0);
    expect(ctx.excluded).toEqual([{ path: '.env', reason: 'environment file' }]);
    expect(renderUserPrompt(ctx, 'x')).not.toContain('Qz8vT2mLx9Rk4Wp7');
  });

  it('respects the token budget for module reviews', async () => {
    const scan = await scanFixture('partial-saas');
    const ctx = await buildContext({ task: 'reviewModule', scan, moduleId: 'billing' }, reader, 1200);
    const chars = ctx.files.reduce((s, f) => s + f.content.length, 0);
    expect(chars).toBeLessThanOrEqual(1200 * 3.5);
    expect(ctx.title).toBe('Module review: Billing & payments');
  });

  it('uses compact summaries for project-level tasks', async () => {
    const scan = await scanFixture('healthy-nextjs');
    const ctx = await buildContext({ task: 'architectureSummary', scan }, reader, 6000);
    expect(ctx.summary).toContain('Primary framework: Next.js');
    expect(ctx.files.every((f) => !f.path.includes('.env'))).toBe(true);
  });
});
