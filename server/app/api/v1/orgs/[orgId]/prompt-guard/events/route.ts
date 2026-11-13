import { handle, json, readJson } from '@/lib/http';
import { getStore } from '@/lib/store';
import { atLeast, orgMember } from '@/lib/org-access';
import { beforeParam, eventsPage, eventsSchema, ingestEvents, sinceParam, toolParam } from '@/lib/prompt-guard';
import { intParam } from '@/lib/validation';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

/** Flagged-prompt events. Admins see everyone (optionally `?userId=`); members see only their own. */
export const GET = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org, user, membership } = await orgMember(req, (await params).orgId);
  const url = new URL(req.url);
  const limit = intParam(url, 'limit', 100, 500);
  const admin = atLeast(membership.role, 'admin');
  const requested = url.searchParams.get('userId');
  const userId = admin ? requested ?? undefined : user.id;
  const events = await getStore().listPromptEvents(org.id, { userId, since: sinceParam(url), before: beforeParam(url), tool: toolParam(url), limit });
  return json(eventsPage(events, limit));
});

/** Batch upload from the extension. Metadata only: the schema has no field for prompt text. */
export const POST = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org, user } = await orgMember(req, (await params).orgId);
  const body = await readJson(req, eventsSchema);
  const result = await ingestEvents(org.id, user.id, `user:${user.githubLogin ?? user.email ?? user.id}`, body.events);
  return json({ data: result }, 201);
});
