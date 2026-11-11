import { handle, json, readJson } from '@/lib/http';
import { meDto, signInWithGitHub } from '@/lib/accounts';
import { githubSignInSchema } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/** Exchanges a GitHub OAuth token (VS Code GitHub sign-in) for a ProjectLens session. */
export const POST = handle(async (req: Request) => {
  const body = await readJson(req, githubSignInSchema);
  const session = await signInWithGitHub(body.accessToken, body.label ?? null);
  return json({ data: { token: session.token, expiresAt: session.expiresAt, ...(await meDto(session.user)) } });
});
