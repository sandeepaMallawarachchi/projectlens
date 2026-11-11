import { authenticate } from '@/lib/auth';
import { handle, json, readJson } from '@/lib/http';
import { getStore } from '@/lib/store';
import { resolveProject, updateProject } from '@/lib/projects';
import { projectDto } from '@/lib/dto';
import { updateProjectSchema } from '@/lib/validation';
import { preflight, type Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

/** Project overview: latest scan summary plus score trend. */
export const GET = handle(async (req: Request, { params }: Params<'projectId'>) => {
  const principal = await authenticate(req, 'read');
  const project = await resolveProject(principal.orgId, (await params).projectId);
  const history = await getStore().listScans(principal.orgId, project.id, { limit: 30, withResult: false });
  const latestCompleted = history.find((s) => s.status === 'completed') ?? null;
  return json({ data: { ...projectDto(project, history[0] ?? null, history), latestCompletedScanId: latestCompleted?.id ?? null } });
});

export const PATCH = handle(async (req: Request, { params }: Params<'projectId'>) => {
  const principal = await authenticate(req, 'scan');
  const project = await resolveProject(principal.orgId, (await params).projectId);
  const updated = await updateProject(project, await readJson(req, updateProjectSchema));
  return json({ data: projectDto(updated, null) });
});

/** Deletes the project, its scan history and AI insights. */
export const DELETE = handle(async (req: Request, { params }: Params<'projectId'>) => {
  const principal = await authenticate(req, 'admin');
  const project = await resolveProject(principal.orgId, (await params).projectId);
  await getStore().deleteProject(principal.orgId, project.id);
  return new Response(null, { status: 204 });
});
