import { beforeEach, describe, expect, it } from 'vitest';
import * as orgPolicy from '@/app/api/v1/orgs/[orgId]/prompt-guard/policy/route';
import * as consent from '@/app/api/v1/orgs/[orgId]/prompt-guard/consent/route';
import * as heartbeat from '@/app/api/v1/orgs/[orgId]/prompt-guard/heartbeat/route';
import * as orgEvents from '@/app/api/v1/orgs/[orgId]/prompt-guard/events/route';
import * as orgMembers from '@/app/api/v1/orgs/[orgId]/prompt-guard/members/route';
import * as orgSummary from '@/app/api/v1/orgs/[orgId]/prompt-guard/summary/route';
import * as keyPolicy from '@/app/api/v1/prompt-guard/policy/route';
import * as keyEvents from '@/app/api/v1/prompt-guard/events/route';
import * as keySummary from '@/app/api/v1/prompt-guard/summary/route';
import * as keys from '@/app/api/v1/keys/route';
import * as projects from '@/app/api/v1/projects/route';
import { body, ctx, req, resetEnv, signIn } from './helpers';
import type { MemoryStore } from '@/lib/store/memory';

let store: MemoryStore;
beforeEach(() => {
  store = resetEnv();
});

type Policy = { version: number; mode: string; consentVersion: number; builtin: Record<string, string>; customRules: { id: string; name: string }[]; webhookUrl: string | null };

async function team() {
  const pm = await signIn('pm');
  const dev = await signIn('dev');
  await store.addMembership({ orgId: pm.orgId, userId: dev.userId, role: 'member' });
  const h = { 'x-projectlens-org': pm.orgId };
  return { pm, dev, orgId: pm.orgId, h };
}

const event = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  tool: 'claude',
  action: 'blocked',
  ruleIds: ['secrets'],
  categories: ['secret'],
  project: 'web-app',
  policyVersion: 1,
  occurredAt: new Date().toISOString(),
  ...over
});

describe('Prompt Guard policy', () => {
  it('defaults to off with secrets blocked and PII warned; only admins can change it', async () => {
    const { pm, dev, orgId } = await team();
    const res = await orgPolicy.GET(req('GET', `/api/v1/orgs/${orgId}/prompt-guard/policy`, undefined, dev.token), ctx({ orgId }));
    const d = (await body<{ data: { policy: Policy; me: { consent: string } } }>(res)).data;
    expect(d.policy).toMatchObject({ mode: 'off', version: 0, builtin: { secrets: 'block', 'pii.card': 'block', 'pii.email': 'warn', 'pii.phone': 'warn' } });
    expect(d.me.consent).toBe('not_needed');

    expect((await orgPolicy.PUT(req('PUT', `/api/v1/orgs/${orgId}/prompt-guard/policy`, { mode: 'required' }, dev.token), ctx({ orgId }))).status).toBe(403);
    const put = await orgPolicy.PUT(
      req('PUT', `/api/v1/orgs/${orgId}/prompt-guard/policy`, { mode: 'optional', customRules: [{ name: 'Client codename', type: 'term', pattern: 'Project Falcon', action: 'block' }] }, pm.token),
      ctx({ orgId })
    );
    expect(put.status).toBe(200);
    const p = (await body<{ data: Policy }>(put)).data;
    expect(p).toMatchObject({ mode: 'optional', version: 1, consentVersion: 2 });
    expect(p.customRules[0].id).toMatch(/^[\w-]+$/);
  });

  it('rejects invalid regular expressions and private webhook hosts', async () => {
    const { pm, orgId } = await team();
    const bad = await orgPolicy.PUT(req('PUT', '/x', { customRules: [{ name: 'x', type: 'regex', pattern: '([a-z', action: 'warn' }] }, pm.token), ctx({ orgId }));
    expect(bad.status).toBe(400);
    const empty = await orgPolicy.PUT(req('PUT', '/x', { customRules: [{ name: 'x', type: 'regex', pattern: 'a*', action: 'warn' }] }, pm.token), ctx({ orgId }));
    expect(empty.status).toBe(400);
    const hook = await orgPolicy.PUT(req('PUT', '/x', { webhookUrl: 'http://127.0.0.1/hook' }, pm.token), ctx({ orgId }));
    expect(hook.status).toBe(400);
  });

  it('can be managed from a PM tool with an admin API key; webhook URL hidden from read-only keys', async () => {
    const { pm, orgId, h } = await team();
    const mk = async (scopes: string[]) =>
      (await body<{ data: { key: string } }>(await keys.POST(req('POST', '/api/v1/keys', { name: scopes.join('-'), scopes }, pm.token, h)))).data.key;
    const admin = await mk(['admin']);
    const read = await mk(['read']);
    const res = await keyPolicy.PUT(req('PUT', '/api/v1/prompt-guard/policy', { mode: 'required', builtin: { 'pii.email': 'block' }, webhookUrl: 'https://hooks.example.com/pg' }, admin));
    expect(res.status).toBe(200);
    expect((await body<{ data: Policy }>(res)).data.builtin['pii.email']).toBe('block');
    expect((await keyPolicy.PUT(req('PUT', '/api/v1/prompt-guard/policy', { mode: 'off' }, read))).status).toBe(403);
    const seen = (await body<{ data: Policy }>(await keyPolicy.GET(req('GET', '/api/v1/prompt-guard/policy', undefined, read)))).data;
    expect(seen.webhookUrl).toBe('(configured)');
    expect((await store.getPromptPolicy(orgId))!.updatedBy).toMatch(/^key:/);
  });
});

describe('Prompt Guard consent', () => {
  it('blocks organization data for members who have not accepted a required policy', async () => {
    const { pm, dev, orgId, h } = await team();
    await orgPolicy.PUT(req('PUT', '/x', { mode: 'required' }, pm.token), ctx({ orgId }));

    const blocked = await projects.GET(req('GET', '/api/v1/projects', undefined, dev.token, h));
    expect(blocked.status).toBe(403);
    expect((await body<{ error: { code: string } }>(blocked)).error.code).toBe('prompt_guard_consent_required');

    // Declining is not possible when required.
    const { policy } = (await body<{ data: { policy: Policy } }>(await orgPolicy.GET(req('GET', '/x', undefined, dev.token), ctx({ orgId })))).data;
    expect((await consent.POST(req('POST', '/x', { consentVersion: policy.consentVersion, accept: false }, dev.token), ctx({ orgId }))).status).toBe(400);
    // A stale version is refused.
    expect((await consent.POST(req('POST', '/x', { consentVersion: policy.consentVersion - 1, accept: true }, dev.token), ctx({ orgId }))).status).toBe(409);

    const ok = await consent.POST(req('POST', '/x', { consentVersion: policy.consentVersion, accept: true }, dev.token), ctx({ orgId }));
    expect((await body<{ data: { consent: string } }>(ok)).data.consent).toBe('accepted');
    expect((await projects.GET(req('GET', '/api/v1/projects', undefined, dev.token, h))).status).toBe(200);

    // Changing the notice requires accepting again.
    await orgPolicy.PUT(req('PUT', '/x', { notice: 'We now also check prompts for customer names. Prompts are never uploaded.' }, pm.token), ctx({ orgId }));
    expect((await projects.GET(req('GET', '/api/v1/projects', undefined, dev.token, h))).status).toBe(403);
  });

  it('lets members decline an optional policy without losing access', async () => {
    const { pm, dev, orgId, h } = await team();
    const p = (await body<{ data: Policy }>(await orgPolicy.PUT(req('PUT', '/x', { mode: 'optional' }, pm.token), ctx({ orgId })))).data;
    const res = await consent.POST(req('POST', '/x', { consentVersion: p.consentVersion, accept: false }, dev.token), ctx({ orgId }));
    expect((await body<{ data: { consent: string } }>(res)).data.consent).toBe('declined');
    expect((await projects.GET(req('GET', '/api/v1/projects', undefined, dev.token, h))).status).toBe(200);
  });
});

describe('Prompt Guard events', () => {
  it('stores metadata only, deduplicates, and scopes visibility by role', async () => {
    const { pm, dev, orgId, h } = await team();
    await heartbeat.POST(req('POST', '/x', { enabled: true, tools: ['claude', 'cursor'], policyVersion: 0, clientVersion: '0.3.0' }, dev.token), ctx({ orgId }));

    const up = await orgEvents.POST(req('POST', '/x', { events: [event('evt-00000001'), event('evt-00000002', { tool: 'copilot', action: 'detected' })] }, dev.token), ctx({ orgId }));
    expect(up.status).toBe(201);
    expect((await body<{ data: { accepted: number } }>(up)).data.accepted).toBe(2);
    const again = await orgEvents.POST(req('POST', '/x', { events: [event('evt-00000001')] }, dev.token), ctx({ orgId }));
    expect((await body<{ data: { duplicates: number } }>(again)).data.duplicates).toBe(1);

    // Unknown fields such as prompt text are not stored.
    await orgEvents.POST(req('POST', '/x', { events: [{ ...event('evt-00000003'), prompt: 'my password is hunter2' }] }, pm.token), ctx({ orgId }));
    expect(JSON.stringify(store.promptEvents)).not.toContain('hunter2');

    // Paths are refused as project names.
    expect((await orgEvents.POST(req('POST', '/x', { events: [event('evt-00000004', { project: '/Users/dev/secret' })] }, dev.token), ctx({ orgId }))).status).toBe(400);

    const mine = (await body<{ data: { userId: string }[] }>(await orgEvents.GET(req('GET', '/x', undefined, dev.token), ctx({ orgId })))).data;
    expect(mine).toHaveLength(2);
    expect(mine.every((e) => e.userId === dev.userId)).toBe(true);
    const all = (await body<{ data: unknown[] }>(await orgEvents.GET(req('GET', '/x', undefined, pm.token), ctx({ orgId })))).data;
    expect(all).toHaveLength(3);

    expect((await orgMembers.GET(req('GET', '/x', undefined, dev.token), ctx({ orgId }))).status).toBe(403);
    const report = (await body<{ data: { user: { id: string }; tools: string[]; last30Days: { blocked: number; detected: number } }[] }>(await orgMembers.GET(req('GET', '/x', undefined, pm.token), ctx({ orgId })))).data;
    expect(report.find((m) => m.user.id === dev.userId)).toMatchObject({ tools: ['claude', 'cursor'], last30Days: { blocked: 1, detected: 1 } });

    const sum = (await body<{ data: { totals: { events: number }; byTool: Record<string, number> } }>(await orgSummary.GET(req('GET', '/x', undefined, pm.token), ctx({ orgId })))).data;
    expect(sum.totals.events).toBe(3);
    expect(sum.byTool).toEqual({ claude: 2, copilot: 1 });

    // API key access needs the audit scope.
    const mk = async (scopes: string[]) => (await body<{ data: { key: string } }>(await keys.POST(req('POST', '/api/v1/keys', { name: 'k', scopes }, pm.token, h)))).data.key;
    expect((await keyEvents.GET(req('GET', '/api/v1/prompt-guard/events', undefined, await mk(['read'])))).status).toBe(403);
    const audit = await mk(['audit']);
    const viaKey = (await body<{ data: unknown[] }>(await keyEvents.GET(req('GET', `/api/v1/prompt-guard/events?userId=${dev.userId}&tool=claude`, undefined, audit)))).data;
    expect(viaKey).toHaveLength(1);
    expect((await keySummary.GET(req('GET', '/api/v1/prompt-guard/summary?days=7', undefined, audit))).status).toBe(200);
  });
});
