import { authenticateUser } from './auth';
import { HttpError, notFound } from './http';
import { getStore, type MembershipRecord, type OrgRecord, type Role, type UserRecord } from './store';

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

export const atLeast = (role: Role, min: Role) => RANK[role] >= RANK[min];

/** Requires a signed-in user who is a member of `orgId` with at least `min` role. */
export async function orgMember(req: Request, orgId: string, min: Role = 'member'): Promise<{ user: UserRecord; membership: MembershipRecord; org: OrgRecord }> {
  const { user } = await authenticateUser(req);
  const store = getStore();
  const membership = await store.getMembership(orgId, user.id);
  const org = membership ? await store.getOrg(orgId) : null;
  if (!membership || !org) {
    throw notFound('Organization');
  }
  if (!atLeast(membership.role, min)) {
    throw new HttpError(403, 'forbidden', `This action requires the ${min} role`);
  }
  return { user, membership, org };
}

export async function ownerCount(orgId: string): Promise<number> {
  return (await getStore().listMembers(orgId)).filter((m) => m.role === 'owner').length;
}
