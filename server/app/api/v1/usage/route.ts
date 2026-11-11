import { authenticate } from '@/lib/auth';
import { handle, json } from '@/lib/http';
import { getStore } from '@/lib/store';
import { usage } from '@/lib/quotas';

export const dynamic = 'force-dynamic';

/** Usage and plan limits of the caller's organization (works with API keys too). */
export const GET = handle(async (req: Request) => {
  const principal = await authenticate(req, 'read');
  const org = await getStore().getOrg(principal.orgId);
  return json({ data: { organization: { id: principal.orgId, name: org?.name ?? '', plan: org?.plan ?? 'free' }, ...(await usage(principal.orgId)) } });
});
