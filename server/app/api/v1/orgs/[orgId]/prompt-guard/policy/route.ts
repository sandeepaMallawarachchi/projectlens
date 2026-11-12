import { handle, json, readJson } from '@/lib/http';
import { atLeast, orgMember } from '@/lib/org-access';
import { consentStatus, getPolicy, memberState, policyDto, promptPolicyUpdateSchema, updatePolicy } from '@/lib/prompt-guard';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

/** Policy plus the caller's own consent and hook status. Any member. */
export const GET = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org, user, membership } = await orgMember(req, (await params).orgId);
  const [policy, me] = await Promise.all([getPolicy(org.id), memberState(org.id, user.id)]);
  return json({
    data: {
      organization: { id: org.id, name: org.name },
      policy: policyDto(policy, atLeast(membership.role, 'admin')),
      me: { consent: consentStatus(policy, me), acceptedAt: me.acceptedAt, enabled: me.enabled, tools: me.tools, policyVersion: me.policyVersion, lastSeenAt: me.lastSeenAt }
    }
  });
});

/** Update the policy (admin). Partial: only provided fields change. */
export const PUT = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org, user } = await orgMember(req, (await params).orgId, 'admin');
  const patch = await readJson(req, promptPolicyUpdateSchema);
  const policy = await updatePolicy(org.id, patch, `user:${user.githubLogin ?? user.email ?? user.id}`);
  return json({ data: policyDto(policy, true) });
});
