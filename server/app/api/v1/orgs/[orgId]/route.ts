import { handle, json, readJson } from '@/lib/http';
import { getStore } from '@/lib/store';
import { orgDto } from '@/lib/accounts';
import { orgMember } from '@/lib/org-access';
import { orgNameSchema } from '@/lib/validation';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org, membership } = await orgMember(req, (await params).orgId);
  return json({ data: orgDto(org, membership.role) });
});

export const PATCH = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org, membership } = await orgMember(req, (await params).orgId, 'admin');
  const { name } = await readJson(req, orgNameSchema);
  return json({ data: orgDto(await getStore().updateOrg(org.id, { name }), membership.role) });
});
