import { handle, json } from '@/lib/http';
import { orgMember } from '@/lib/org-access';
import { usage } from '@/lib/quotas';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org } = await orgMember(req, (await params).orgId);
  return json({ data: { organization: { id: org.id, name: org.name, plan: org.plan }, ...(await usage(org.id)) } });
});
