import { authenticate } from '@/lib/auth';
import { handle, json, readJson } from '@/lib/http';
import { getStore } from '@/lib/store';
import { createProject } from '@/lib/projects';
import { projectDto } from '@/lib/dto';
import { createProjectSchema } from '@/lib/validation';
import { preflight } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

/** Projects of the caller's organization with their latest scan overview. `?externalId=` filters by the caller's id. */
export const GET = handle(async (req: Request) => {
  const principal = await authenticate(req, 'read');
  const store = getStore();
  const externalId = new URL(req.url).searchParams.get('externalId');
  const projects = externalId ? [await store.findProjectByExternalId(principal.orgId, externalId)].filter((p) => p !== null) : await store.listProjects(principal.orgId);
  const items = await Promise.all(
    projects.map(async (p) => {
      const [latest] = await store.listScans(principal.orgId, p.id, { limit: 1, withResult: false });
      return projectDto(p, latest ?? null);
    })
  );
  return json({ data: items });
});

/** Register a project. Repository tokens are encrypted at rest and never returned. */
export const POST = handle(async (req: Request) => {
  const principal = await authenticate(req, 'scan');
  const project = await createProject(principal, await readJson(req, createProjectSchema));
  return json({ data: projectDto(project, null) }, 201);
});
