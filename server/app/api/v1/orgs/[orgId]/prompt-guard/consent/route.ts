import { handle, json, readJson } from '@/lib/http';
import { orgMember } from '@/lib/org-access';
import { consentSchema, consentStatus, getPolicy, recordConsent } from '@/lib/prompt-guard';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

/** Accept or decline the organization's Prompt Guard policy (the caller's own consent). */
export const POST = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org, user } = await orgMember(req, (await params).orgId);
  const body = await readJson(req, consentSchema);
  const state = await recordConsent(org.id, user.id, body.consentVersion, body.accept);
  return json({ data: { consent: consentStatus(await getPolicy(org.id), state), acceptedAt: state.acceptedAt, declinedAt: state.declinedAt } });
});
