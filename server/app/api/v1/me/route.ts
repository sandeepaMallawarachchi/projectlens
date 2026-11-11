import { authenticateUser } from '@/lib/auth';
import { handle, json } from '@/lib/http';
import { acceptPendingInvitations, meDto } from '@/lib/accounts';

export const dynamic = 'force-dynamic';

/** Current user and organizations. Also joins organizations the user has been invited to since signing in. */
export const GET = handle(async (req: Request) => {
  const { user } = await authenticateUser(req);
  await acceptPendingInvitations(user);
  return json({ data: await meDto(user) });
});
