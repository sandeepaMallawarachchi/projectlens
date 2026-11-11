import { authenticate } from '@/lib/auth';
import { handle } from '@/lib/http';
import { getStore } from '@/lib/store';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

export const DELETE = handle(async (req: Request, { params }: Params<'keyId'>) => {
  const principal = await authenticate(req, 'admin');
  await getStore().revokeApiKey(principal.orgId, (await params).keyId);
  return new Response(null, { status: 204 });
});
