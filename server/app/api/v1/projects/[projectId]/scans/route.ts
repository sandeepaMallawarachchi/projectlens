import { after } from 'next/server';
import { authenticate } from '@/lib/auth';
import { handle, json, readJson } from '@/lib/http';
import { getStore } from '@/lib/store';
import { resolveProject } from '@/lib/projects';
import { scanDto } from '@/lib/dto';
import { startScan } from '@/lib/scan-runner';
import { intParam, startScanSchema } from '@/lib/validation';
import { preflight, type Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';
/** Scans download and analyze a repository; allow up to 5 minutes. */
export const maxDuration = 300;
export const OPTIONS = preflight;

export const GET = handle(async (req: Request, { params }: Params<'projectId'>) => {
  await authenticate(req, 'read');
  const project = await resolveProject((await params).projectId);
  const limit = intParam(new URL(req.url), 'limit', 20, 100);
  const scans = await getStore().listScans(project.id, { limit, withResult: false });
  return json({ data: scans.map(scanDto) });
});

/**
 * Trigger a scan. Default: 202 + background processing (poll GET /scans/{id} or pass callbackUrl).
 * `wait: true` blocks until the scan finishes. Unchanged commits return the previous result (200, cached: true).
 */
export const POST = handle(async (req: Request, { params }: Params<'projectId'>) => {
  const principal = await authenticate(req, 'scan');
  const project = await resolveProject((await params).projectId);
  const body = await readJson(req, startScanSchema);
  const started = await startScan(project, { mode: body.mode, ref: body.ref, force: body.force, triggeredBy: principal.actor, callbackUrl: body.callbackUrl });
  if (started.cached || !started.run) {
    return json({ data: scanDto(started.scan), cached: true });
  }
  if (body.wait) {
    const finished = await started.run();
    return json({ data: scanDto(finished), cached: false }, finished.status === 'completed' ? 200 : 500);
  }
  after(() => started.run!().then(() => undefined));
  return json({ data: scanDto(started.scan), cached: false }, 202, { location: `/api/v1/scans/${started.scan.id}` });
});
