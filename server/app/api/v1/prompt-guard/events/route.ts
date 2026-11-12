import { authenticate } from '@/lib/auth';
import { handle, json } from '@/lib/http';
import { getStore } from '@/lib/store';
import { eventDto, sinceParam, toolParam } from '@/lib/prompt-guard';
import { intParam } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** Flagged-prompt events, newest first (scope: audit). Filters: since, userId, tool, limit. */
export const GET = handle(async (req: Request) => {
  const p = await authenticate(req, 'audit', { skipPromptGuard: true });
  const url = new URL(req.url);
  const events = await getStore().listPromptEvents(p.orgId, {
    userId: url.searchParams.get('userId') ?? undefined,
    since: sinceParam(url),
    tool: toolParam(url),
    limit: intParam(url, 'limit', 100, 500)
  });
  return json({ data: events.map(eventDto) });
});
