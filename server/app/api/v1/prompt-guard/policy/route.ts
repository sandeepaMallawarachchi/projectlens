import { authenticate } from '@/lib/auth';
import { handle, json, readJson } from '@/lib/http';
import { getPolicy, policyDto, promptPolicyUpdateSchema, updatePolicy } from '@/lib/prompt-guard';

export const dynamic = 'force-dynamic';

/** The organization's Prompt Guard policy (scope: read). */
export const GET = handle(async (req: Request) => {
  const p = await authenticate(req, 'read', { skipPromptGuard: true });
  return json({ data: policyDto(await getPolicy(p.orgId), p.scopes.includes('admin')) });
});

/** Update the policy from a PM tool (scope: admin). Partial: only provided fields change. */
export const PUT = handle(async (req: Request) => {
  const p = await authenticate(req, 'admin', { skipPromptGuard: true });
  const patch = await readJson(req, promptPolicyUpdateSchema);
  return json({ data: policyDto(await updatePolicy(p.orgId, patch, p.actor), true) });
});
