import { authenticateUser } from '@/lib/auth';
import { handle } from '@/lib/http';
import { getStore } from '@/lib/store';

export const dynamic = 'force-dynamic';

/** Revokes the current session. */
export const POST = handle(async (req: Request) => {
  const { session } = await authenticateUser(req);
  await getStore().revokeSession(session.id);
  return new Response(null, { status: 204 });
});
