import { handle, json, readJson } from '@/lib/http';
import { startEmailSignIn } from '@/lib/accounts';
import { emailStartSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** Emails a 6-digit sign-in code. */
export const POST = handle(async (req: Request) => {
  const body = await readJson(req, emailStartSchema);
  return json({ data: await startEmailSignIn(body.email) });
});
