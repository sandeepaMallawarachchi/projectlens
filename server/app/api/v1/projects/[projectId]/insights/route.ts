import { authenticate } from '@/lib/auth';
import { handle, json } from '@/lib/http';
import { getStore } from '@/lib/store';
import { resolveProject } from '@/lib/projects';
import { intParam } from '@/lib/validation';
import { preflight, type Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

/** AI insights generated for this project, newest first. */
export const GET = handle(async (req: Request, { params }: Params<'projectId'>) => {
  await authenticate(req, 'read');
  const project = await resolveProject((await params).projectId);
  const insights = await getStore().listInsights({ projectId: project.id, limit: intParam(new URL(req.url), 'limit', 20, 100) });
  return json({ data: insights });
});
