import { HttpError, handle, json, notFound, readJson } from '@/lib/http';
import { getStore } from '@/lib/store';
import { orgMember, ownerCount } from '@/lib/org-access';
import { updateMemberSchema } from '@/lib/validation';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

/** Change a member's role (admins manage members; only owners grant or revoke owner). */
export const PATCH = handle(async (req: Request, { params }: Params<'orgId' | 'userId'>) => {
  const { orgId, userId } = await params;
  const { membership } = await orgMember(req, orgId, 'admin');
  const { role } = await readJson(req, updateMemberSchema);
  const store = getStore();
  const target = await store.getMembership(orgId, userId);
  if (!target) {
    throw notFound('Member');
  }
  if ((role === 'owner' || target.role === 'owner') && membership.role !== 'owner') {
    throw new HttpError(403, 'forbidden', 'Only owners can change owner roles');
  }
  if (target.role === 'owner' && role !== 'owner' && (await ownerCount(orgId)) <= 1) {
    throw new HttpError(409, 'last_owner', 'An organization needs at least one owner');
  }
  await store.updateMembership(orgId, userId, role);
  return json({ data: { userId, role } });
});

/** Remove a member, or leave the organization (userId = your own id). */
export const DELETE = handle(async (req: Request, { params }: Params<'orgId' | 'userId'>) => {
  const { orgId, userId } = await params;
  const { user, membership } = await orgMember(req, orgId);
  const store = getStore();
  const target = await store.getMembership(orgId, userId);
  if (!target) {
    throw notFound('Member');
  }
  const self = user.id === userId;
  if (!self) {
    if (membership.role === 'member' || (target.role !== 'member' && membership.role !== 'owner')) {
      throw new HttpError(403, 'forbidden', 'You cannot remove this member');
    }
  }
  if (target.role === 'owner' && (await ownerCount(orgId)) <= 1) {
    throw new HttpError(409, 'last_owner', 'Transfer ownership before the last owner leaves');
  }
  await store.removeMembership(orgId, userId);
  return new Response(null, { status: 204 });
});
