import { json } from '@/lib/http';
import { env } from '@/lib/env';
import { emailEnabled } from '@/lib/email';

export const dynamic = 'force-dynamic';

/** Unauthenticated liveness check. Reveals configuration presence only, never values. */
export async function GET() {
  const e = env();
  return json({
    status: 'ok',
    version: '0.2.0',
    storage: e.storage,
    signIn: { github: true, email: emailEnabled() },
    ai: { mode: e.allowServerAiKeys ? 'organization-or-server-keys' : 'organization-keys' }
  });
}
