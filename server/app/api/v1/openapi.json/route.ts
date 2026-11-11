import { json } from '@/lib/http';
import { openApiSpec } from '@/lib/openapi';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  return json(openApiSpec(new URL(req.url).origin));
}
