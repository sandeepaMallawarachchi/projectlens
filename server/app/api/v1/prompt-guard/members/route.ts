import { authenticate } from '@/lib/auth';
import { handle, json } from '@/lib/http';
import { membersReport } from '@/lib/prompt-guard';

export const dynamic = 'force-dynamic';

/** Consent and hook status per member (scope: audit). */
export const GET = handle(async (req: Request) => {
  const p = await authenticate(req, 'audit', { skipPromptGuard: true });
  return json({ data: await membersReport(p.orgId) });
});
