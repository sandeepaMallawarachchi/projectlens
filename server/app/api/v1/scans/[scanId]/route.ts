import { authenticate } from '@/lib/auth';
import { handle, json, notFound } from '@/lib/http';
import { getStore } from '@/lib/store';
import { scanDetailDto } from '@/lib/dto';
import { preflight, type Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';
export const OPTIONS = preflight;

/** Scan status and, when completed, overview, score explanations and module reasoning. */
export const GET = handle(async (req: Request, { params }: Params<'scanId'>) => {
  await authenticate(req, 'read');
  const scan = await getStore().getScan((await params).scanId);
  if (!scan) {
    throw notFound('Scan');
  }
  return json({ data: scanDetailDto(scan) });
});
