import { handle, json, readJson } from '@/lib/http';
import { meDto, verifyEmailCode } from '@/lib/accounts';
import { emailVerifySchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

export const POST = handle(async (req: Request) => {
  const body = await readJson(req, emailVerifySchema);
  const session = await verifyEmailCode(body.email, body.code, body.label ?? null);
  return json({ data: { token: session.token, expiresAt: session.expiresAt, ...(await meDto(session.user)) } });
});
