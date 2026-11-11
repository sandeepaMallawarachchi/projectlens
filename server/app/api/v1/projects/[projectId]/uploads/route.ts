import { authenticate } from '@/lib/auth';
import { handle, json, readJson } from '@/lib/http';
import { resolveProject } from '@/lib/projects';
import { scanDto } from '@/lib/dto';
import { storeUpload } from '@/lib/uploads';
import { uploadSchema } from '@/lib/validation';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

/**
 * Upload a scan result produced locally by the VS Code extension. No repository access needed.
 * Local file paths are removed and evidence is redacted again before storage.
 */
export const POST = handle(async (req: Request, { params }: Params<'projectId'>) => {
  const principal = await authenticate(req, 'scan');
  const project = await resolveProject(principal.orgId, (await params).projectId);
  const scan = await storeUpload(project, await readJson(req, uploadSchema), principal.actor);
  return json({ data: scanDto(scan) }, 201);
});
