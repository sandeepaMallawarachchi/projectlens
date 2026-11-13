import { authenticate } from '@/lib/auth';
import { handle, json, notFound } from '@/lib/http';
import { getStore } from '@/lib/store';
import { deleteWebhookSecret, rotateWebhookSecret, webhookSecretStatus } from '@/lib/webhook-secret';

export const dynamic = 'force-dynamic';

/** Webhook signing secret of the key's organization (scope: admin). The secret is never returned here. */
export const GET = handle(async (req: Request) => {
  const p = await authenticate(req, 'admin', { skipPromptGuard: true });
  const org = await getStore().getOrg(p.orgId);
  if (!org) {
    throw notFound('Organization');
  }
  return json({ data: webhookSecretStatus(org) });
});

/** Creates or rotates the secret (scope: admin). The response is the only time it is shown. */
export const POST = handle(async (req: Request) => {
  const p = await authenticate(req, 'admin', { skipPromptGuard: true });
  return json({ data: await rotateWebhookSecret(p.orgId) }, 201);
});

export const DELETE = handle(async (req: Request) => {
  const p = await authenticate(req, 'admin', { skipPromptGuard: true });
  await deleteWebhookSecret(p.orgId);
  return new Response(null, { status: 204 });
});
