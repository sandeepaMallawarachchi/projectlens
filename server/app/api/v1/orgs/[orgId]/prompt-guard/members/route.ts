import { handle, json } from '@/lib/http';
import { orgMember } from '@/lib/org-access';
import { membersReport } from '@/lib/prompt-guard';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

/** Consent and hook status of every member, with 30-day event counts (admin). */
export const GET = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org } = await orgMember(req, (await params).orgId, 'admin');
  return json({ data: await membersReport(org.id) });
});
