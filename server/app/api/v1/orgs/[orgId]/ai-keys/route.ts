import { handle, json } from '@/lib/http';
import { getStore } from '@/lib/store';
import { orgMember } from '@/lib/org-access';
import { AI_PROVIDER_IDS, AI_PROVIDERS } from '@/engine/models/ai';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

/** Configured AI providers for the organization. Keys are never returned, only the last 4 characters. */
export const GET = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org } = await orgMember(req, (await params).orgId);
  const keys = await getStore().listOrgAiKeys(org.id);
  return json({
    data: {
      defaultProvider: org.aiProvider,
      defaultModel: org.aiModel,
      providers: AI_PROVIDER_IDS.map((id) => {
        const k = keys.find((x) => x.provider === id);
        return { provider: id, label: AI_PROVIDERS[id].label, defaultModel: AI_PROVIDERS[id].defaultModel, configured: !!k, last4: k?.last4 ?? null, updatedAt: k?.updatedAt ?? null };
      })
    }
  });
});
