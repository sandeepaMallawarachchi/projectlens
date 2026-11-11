import { authenticateUser } from '@/lib/auth';
import { handle, json, readJson } from '@/lib/http';
import { getStore } from '@/lib/store';
import { meDto, orgDto } from '@/lib/accounts';
import { orgNameSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request) => {
  const { user } = await authenticateUser(req);
  return json({ data: (await meDto(user)).organizations });
});

/** Creates an organization; the caller becomes its owner. */
export const POST = handle(async (req: Request) => {
  const { user } = await authenticateUser(req);
  const { name } = await readJson(req, orgNameSchema);
  const store = getStore();
  if ((await store.listMembershipsForUser(user.id)).length >= 20) {
    return json({ error: { code: 'limit', message: 'Organization limit reached' } }, 429);
  }
  const org = await store.createOrg({ name, plan: 'free', aiProvider: null, aiModel: null });
  await store.addMembership({ orgId: org.id, userId: user.id, role: 'owner' });
  return json({ data: orgDto(org, 'owner') }, 201);
});
