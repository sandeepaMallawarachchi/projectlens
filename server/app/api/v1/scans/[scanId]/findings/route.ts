import { authenticate } from '@/lib/auth';
import { HttpError, handle, json, notFound } from '@/lib/http';
import { getStore } from '@/lib/store';
import { findingDto } from '@/lib/dto';
import { intParam } from '@/lib/validation';
import { SEVERITY_RANK, type Severity } from '@/engine/models/types';
import { preflight, type Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

/**
 * Paginated findings. Filters: severity (minimum), category, status, file (substring),
 * includeTests=true to include test/fixture findings. Evidence is always redacted.
 */
export const GET = handle(async (req: Request, { params }: Params<'scanId'>) => {
  const principal = await authenticate(req, 'read');
  const scan = await getStore().getScan(principal.orgId, (await params).scanId);
  if (!scan) {
    throw notFound('Scan');
  }
  if (!scan.result) {
    throw new HttpError(409, 'scan_not_completed', `Scan is ${scan.status}`);
  }
  const url = new URL(req.url);
  const q = url.searchParams;
  const minSeverity = q.get('severity') as Severity | null;
  if (minSeverity && !(minSeverity in SEVERITY_RANK)) {
    throw new HttpError(400, 'invalid_request', 'severity must be critical, high, medium, low or info');
  }
  const category = q.get('category');
  const status = q.get('status');
  const file = q.get('file')?.toLowerCase();
  const includeTests = q.get('includeTests') === 'true';
  const filtered = scan.result.findings.filter(
    (f) =>
      (!minSeverity || SEVERITY_RANK[f.severity] >= SEVERITY_RANK[minSeverity]) &&
      (!category || f.category === category) &&
      (!status || f.status === status) &&
      (!file || f.location.file.toLowerCase().includes(file)) &&
      (includeTests || !f.tags?.includes('test-or-fixture'))
  );
  const limit = intParam(url, 'limit', 50, 500);
  const offset = Math.max(0, Number(q.get('offset')) || 0);
  return json({ data: filtered.slice(offset, offset + limit).map(findingDto), pagination: { total: filtered.length, limit, offset } });
});
