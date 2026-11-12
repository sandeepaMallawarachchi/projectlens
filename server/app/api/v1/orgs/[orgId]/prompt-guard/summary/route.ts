import { handle, json } from '@/lib/http';
import { orgMember } from '@/lib/org-access';
import { summary } from '@/lib/prompt-guard';
import { intParam } from '@/lib/validation';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

/** Totals by rule, tool and category over `?days=` (default 30, admin). */
export const GET = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org } = await orgMember(req, (await params).orgId, 'admin');
  return json({ data: await summary(org.id, intParam(new URL(req.url), 'days', 30, 90)) });
});
