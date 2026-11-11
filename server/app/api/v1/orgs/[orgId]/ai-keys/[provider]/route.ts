import { HttpError, handle, json, readJson } from '@/lib/http';
import { getStore } from '@/lib/store';
import { encryptSecret } from '@/lib/crypto';
import { orgMember } from '@/lib/org-access';
import { validateProviderKey } from '@/lib/ai-runner';
import { aiKeySchema } from '@/lib/validation';
import { isProviderId, AI_PROVIDERS } from '@/engine/models/ai';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

function provider(value: string) {
  if (!isProviderId(value)) {
    throw new HttpError(404, 'not_found', 'Unknown AI provider');
  }
  return value;
}

/** Stores the organization's own key for a provider (encrypted). Validated with the provider by default. */
export const PUT = handle(async (req: Request, { params }: Params<'orgId' | 'provider'>) => {
  const p = await params;
  const id = provider(p.provider);
  const { org } = await orgMember(req, p.orgId, 'admin');
  const body = await readJson(req, aiKeySchema);
  if (body.validate) {
    await validateProviderKey(id, body.apiKey);
  }
  const store = getStore();
  const record = await store.upsertOrgAiKey({ orgId: org.id, provider: id, keyEncrypted: encryptSecret(body.apiKey), last4: body.apiKey.slice(-4) });
  if (!org.aiProvider) {
    await store.updateOrg(org.id, { aiProvider: id });
  }
  return json({ data: { provider: id, label: AI_PROVIDERS[id].label, configured: true, last4: record.last4, updatedAt: record.updatedAt } });
});

export const DELETE = handle(async (req: Request, { params }: Params<'orgId' | 'provider'>) => {
  const p = await params;
  const id = provider(p.provider);
  const { org } = await orgMember(req, p.orgId, 'admin');
  const store = getStore();
  await store.deleteOrgAiKey(org.id, id);
  if (org.aiProvider === id) {
    const remaining = await store.listOrgAiKeys(org.id);
    await store.updateOrg(org.id, { aiProvider: remaining[0]?.provider ?? null, aiModel: null });
  }
  return new Response(null, { status: 204 });
});
