import { json } from '@/lib/http';
import { emailEnabled } from '@/lib/email';

export const dynamic = 'force-dynamic';

/** Which sign-in methods this server supports (no auth). */
export async function GET() {
  return json({ data: { github: true, email: emailEnabled() } });
}
