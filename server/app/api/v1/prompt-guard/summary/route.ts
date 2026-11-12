import { authenticate } from '@/lib/auth';
import { handle, json } from '@/lib/http';
import { summary } from '@/lib/prompt-guard';
import { intParam } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** Totals by rule, tool, category and member consent over `?days=` (scope: audit). */
export const GET = handle(async (req: Request) => {
  const p = await authenticate(req, 'audit', { skipPromptGuard: true });
  return json({ data: await summary(p.orgId, intParam(new URL(req.url), 'days', 30, 90)) });
});
