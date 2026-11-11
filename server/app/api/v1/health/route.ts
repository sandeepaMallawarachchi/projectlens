import { json } from '@/lib/http';
import { env } from '@/lib/env';
import { AI_PROVIDER_IDS } from '@/engine/models/ai';

export const dynamic = 'force-dynamic';

/** Unauthenticated liveness check. Reveals configuration presence only, never values. */
export async function GET() {
  const e = env();
  return json({
    status: 'ok',
    version: '0.1.0',
    storage: e.storage,
    ai: { defaultProvider: e.ai.provider, configuredProviders: AI_PROVIDER_IDS.filter((id) => !!e.ai.keys[id]) }
  });
}
