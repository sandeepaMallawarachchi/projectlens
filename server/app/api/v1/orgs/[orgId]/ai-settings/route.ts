import { handle, json, readJson } from '@/lib/http';
import { getStore } from '@/lib/store';
import { orgDto } from '@/lib/accounts';
import { orgMember } from '@/lib/org-access';
import { aiSettingsSchema } from '@/lib/validation';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

/** Default provider and model for server-side AI insights. */
export const PUT = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org, membership } = await orgMember(req, (await params).orgId, 'admin');
  const body = await readJson(req, aiSettingsSchema);
  const updated = await getStore().updateOrg(org.id, { aiProvider: body.provider, aiModel: body.model ?? null });
  return json({ data: orgDto(updated, membership.role) });
});
