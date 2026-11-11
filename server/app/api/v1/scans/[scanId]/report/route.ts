import { authenticate } from '@/lib/auth';
import { HttpError, corsHeaders, handle, notFound } from '@/lib/http';
import { getStore } from '@/lib/store';
import { buildJsonReport, buildMarkdownReport } from '@/engine/core/report';
import { preflight, type Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

/** Full report: `?format=markdown` (default) or `?format=json`. Includes AI insights for the scan. */
export const GET = handle(async (req: Request, { params }: Params<'scanId'>) => {
  await authenticate(req, 'read');
  const store = getStore();
  const scan = await store.getScan((await params).scanId);
  if (!scan) {
    throw notFound('Scan');
  }
  if (!scan.result) {
    throw new HttpError(409, 'scan_not_completed', `Scan is ${scan.status}`);
  }
  const insights = await store.listInsights({ scanId: scan.id, limit: 50 });
  const format = new URL(req.url).searchParams.get('format') ?? 'markdown';
  const body = format === 'json' ? buildJsonReport(scan.result, insights) : buildMarkdownReport(scan.result, insights);
  return new Response(body, {
    headers: {
      'content-type': format === 'json' ? 'application/json; charset=utf-8' : 'text/markdown; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders()
    }
  });
});
