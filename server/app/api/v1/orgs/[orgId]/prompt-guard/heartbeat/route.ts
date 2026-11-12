import { handle, json, readJson } from '@/lib/http';
import { orgMember } from '@/lib/org-access';
import { heartbeatSchema, recordHeartbeat } from '@/lib/prompt-guard';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

/** Reports which AI tools have the Prompt Guard hook installed on the caller's machine. */
export const POST = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org, user } = await orgMember(req, (await params).orgId);
  const body = await readJson(req, heartbeatSchema);
  const state = await recordHeartbeat(org.id, user.id, body);
  return json({ data: { enabled: state.enabled, tools: state.tools, lastSeenAt: state.lastSeenAt } });
});
