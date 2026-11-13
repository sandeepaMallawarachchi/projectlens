import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as orgSecret from '@/app/api/v1/orgs/[orgId]/webhook-secret/route';
import * as keySecret from '@/app/api/v1/webhook-secret/route';
import * as keys from '@/app/api/v1/keys/route';
import * as orgEvents from '@/app/api/v1/orgs/[orgId]/prompt-guard/events/route';
import * as keyEvents from '@/app/api/v1/prompt-guard/events/route';
import { sendWebhook } from '@/lib/webhook';
import { body, ctx, req, resetEnv, signIn } from './helpers';
import type { MemoryStore } from '@/lib/store/memory';

let store: MemoryStore;
beforeEach(() => {
  store = resetEnv({ WEBHOOK_ALLOWED_HOSTS: 'hooks.example.com' });
});
afterEach(() => vi.unstubAllGlobals());

function captureFetch() {
  const calls: { headers: Headers; body: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    calls.push({ headers: new Headers(init.headers), body: String(init.body) });
    return new Response('ok');
  }));
  return calls;
}

describe('per-organization webhook secret', () => {
  it('is created and rotated by admins, shown once, and never returned by GET', async () => {
    const pm = await signIn('pm');
    const dev = await signIn('dev');
    await store.addMembership({ orgId: pm.orgId, userId: dev.userId, role: 'member' });
    const orgId = pm.orgId;

    expect((await orgSecret.POST(req('POST', '/x', undefined, dev.token), ctx({ orgId }))).status).toBe(403);
    const created = (await body<{ data: { secret: string; last4: string } }>(await orgSecret.POST(req('POST', '/x', undefined, pm.token), ctx({ orgId })))).data;
    expect(created.secret).toMatch(/^whsec_[\w-]{40,}$/);
    expect(JSON.stringify(store.orgs.get(orgId))).not.toContain(created.secret);

    const status = (await body<{ data: Record<string, unknown> }>(await orgSecret.GET(req('GET', '/x', undefined, pm.token), ctx({ orgId })))).data;
    expect(status).toMatchObject({ configured: true, last4: created.last4 });
    expect(JSON.stringify(status)).not.toContain(created.secret);

    const rotated = (await body<{ data: { secret: string } }>(await orgSecret.POST(req('POST', '/x', undefined, pm.token), ctx({ orgId })))).data;
    expect(rotated.secret).not.toBe(created.secret);
    expect((await orgSecret.DELETE(req('DELETE', '/x', undefined, pm.token), ctx({ orgId }))).status).toBe(204);
    expect((await body<{ data: { configured: boolean } }>(await orgSecret.GET(req('GET', '/x', undefined, pm.token), ctx({ orgId })))).data.configured).toBe(false);
  });

  it('can be managed with an admin API key', async () => {
    const pm = await signIn('pm');
    const key = (await body<{ data: { key: string } }>(await keys.POST(req('POST', '/api/v1/keys', { name: 'pm-tool', scopes: ['admin'] }, pm.token, { 'x-projectlens-org': pm.orgId })))).data.key;
    const res = await keySecret.POST(req('POST', '/api/v1/webhook-secret', undefined, key));
    expect(res.status).toBe(201);
    expect((await body<{ data: { secret: string } }>(res)).data.secret).toMatch(/^whsec_/);
  });

  it('signs each organization\'s webhooks with its own secret', async () => {
    const a = await signIn('alpha');
    const b = await signIn('beta');
    const secretA = (await body<{ data: { secret: string } }>(await orgSecret.POST(req('POST', '/x', undefined, a.token), ctx({ orgId: a.orgId })))).data.secret;
    const secretB = (await body<{ data: { secret: string } }>(await orgSecret.POST(req('POST', '/x', undefined, b.token), ctx({ orgId: b.orgId })))).data.secret;
    const calls = captureFetch();

    await sendWebhook('https://hooks.example.com/a', 'scan.completed', { x: 1 }, a.orgId);
    await sendWebhook('https://hooks.example.com/b', 'scan.completed', { x: 1 }, b.orgId);
    const sig = (secret: string, raw: string) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    expect(calls[0].headers.get('x-projectlens-signature')).toBe(sig(secretA, calls[0].body));
    expect(calls[1].headers.get('x-projectlens-signature')).toBe(sig(secretB, calls[1].body));
    expect(calls[0].headers.get('x-projectlens-signature')).not.toBe(sig(secretB, calls[0].body));
  });

  it('falls back to the server secret, or sends unsigned, when the organization has none', async () => {
    const a = await signIn('alpha');
    let calls = captureFetch();
    await sendWebhook('https://hooks.example.com/a', 'scan.completed', {}, a.orgId);
    expect(calls[0].headers.get('x-projectlens-signature')).toBeNull();

    process.env.PROJECTLENS_WEBHOOK_SECRET = 'server-wide-secret';
    calls = captureFetch();
    await sendWebhook('https://hooks.example.com/a', 'scan.completed', {}, a.orgId);
    expect(calls[0].headers.get('x-projectlens-signature')).toBe(`sha256=${createHmac('sha256', 'server-wide-secret').update(calls[0].body).digest('hex')}`);
  });
});

describe('Prompt Guard event pagination', () => {
  it('pages through older events with the nextBefore cursor', async () => {
    const pm = await signIn('pm');
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({
      id: `evt-page-000${i}`,
      tool: 'claude',
      action: 'blocked',
      ruleIds: ['secrets'],
      categories: ['secret'],
      project: 'web',
      policyVersion: 1,
      occurredAt: new Date(now - i * 60_000).toISOString()
    }));
    await orgEvents.POST(req('POST', '/x', { events }, pm.token), ctx({ orgId: pm.orgId }));
    const key = (await body<{ data: { key: string } }>(await keys.POST(req('POST', '/api/v1/keys', { name: 'a', scopes: ['audit'] }, pm.token, { 'x-projectlens-org': pm.orgId })))).data.key;

    type Page = { data: { id: string }[]; pagination: { limit: number; nextBefore: string | null } };
    const p1 = await body<Page>(await keyEvents.GET(req('GET', '/api/v1/prompt-guard/events?limit=2', undefined, key)));
    expect(p1.data.map((e) => e.id)).toEqual(['evt-page-0000', 'evt-page-0001']);
    const p2 = await body<Page>(await keyEvents.GET(req('GET', `/api/v1/prompt-guard/events?limit=2&before=${encodeURIComponent(p1.pagination.nextBefore!)}`, undefined, key)));
    expect(p2.data.map((e) => e.id)).toEqual(['evt-page-0002', 'evt-page-0003']);
    const p3 = await body<Page>(await keyEvents.GET(req('GET', `/api/v1/prompt-guard/events?limit=2&before=${encodeURIComponent(p2.pagination.nextBefore!)}`, undefined, key)));
    expect(p3.data.map((e) => e.id)).toEqual(['evt-page-0004']);
    expect(p3.pagination.nextBefore).toBeNull();
    expect((await keyEvents.GET(req('GET', '/api/v1/prompt-guard/events?before=yesterday', undefined, key))).status).toBe(400);
  });
});
