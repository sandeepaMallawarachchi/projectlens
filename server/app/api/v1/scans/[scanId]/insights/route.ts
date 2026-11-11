import { authenticate } from '@/lib/auth';
import { handle, json, notFound, readJson } from '@/lib/http';
import { getStore } from '@/lib/store';
import { runInsight } from '@/lib/ai-runner';
import { aiRequestSchema } from '@/lib/validation';
import { preflight, type Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export const OPTIONS = preflight;

async function load(orgId: string, scanId: string) {
  const store = getStore();
  const scan = await store.getScan(orgId, scanId);
  if (!scan) {
    throw notFound('Scan');
  }
  const project = await store.getProject(orgId, scan.projectId);
  if (!project) {
    throw notFound('Project');
  }
  return { scan, project };
}

export const GET = handle(async (req: Request, { params }: Params<'scanId'>) => {
  const principal = await authenticate(req, 'read');
  const { scan } = await load(principal.orgId, (await params).scanId);
  return json({ data: await getStore().listInsights(principal.orgId, { scanId: scan.id, limit: 50 }) });
});

/** Run an AI analysis on this scan using the server's provider keys. Synchronous (can take up to ~2 minutes). */
export const POST = handle(async (req: Request, { params }: Params<'scanId'>) => {
  const principal = await authenticate(req, 'ai');
  const { scan, project } = await load(principal.orgId, (await params).scanId);
  const insight = await runInsight(project, scan, await readJson(req, aiRequestSchema));
  return json({ data: insight }, 201);
});
