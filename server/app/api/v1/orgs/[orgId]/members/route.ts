import { handle, json } from '@/lib/http';
import { getStore } from '@/lib/store';
import { userDto } from '@/lib/accounts';
import { orgMember } from '@/lib/org-access';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

export const GET = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org } = await orgMember(req, (await params).orgId);
  const store = getStore();
  const members = await store.listMembers(org.id);
  const users = await Promise.all(members.map((m) => store.getUser(m.userId)));
  return json({ data: members.map((m, i) => ({ role: m.role, joinedAt: m.createdAt, user: users[i] ? userDto(users[i]!) : { id: m.userId } })) });
});
