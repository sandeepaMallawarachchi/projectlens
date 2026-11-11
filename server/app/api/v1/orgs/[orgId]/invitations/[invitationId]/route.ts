import { handle } from '@/lib/http';
import { getStore } from '@/lib/store';
import { orgMember } from '@/lib/org-access';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

export const DELETE = handle(async (req: Request, { params }: Params<'orgId' | 'invitationId'>) => {
  const { orgId, invitationId } = await params;
  await orgMember(req, orgId, 'admin');
  await getStore().deleteInvitation(orgId, invitationId);
  return new Response(null, { status: 204 });
});
