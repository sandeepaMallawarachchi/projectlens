import { handle, json } from '@/lib/http';
import { orgMember } from '@/lib/org-access';
import { deleteWebhookSecret, rotateWebhookSecret, webhookSecretStatus } from '@/lib/webhook-secret';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

/** Whether the organization has a webhook signing secret (the secret itself is never returned). */
export const GET = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org } = await orgMember(req, (await params).orgId, 'admin');
  return json({ data: webhookSecretStatus(org) });
});

/** Creates or rotates the secret. The response is the only time it is shown. */
export const POST = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org } = await orgMember(req, (await params).orgId, 'admin');
  return json({ data: await rotateWebhookSecret(org.id) }, 201);
});

export const DELETE = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org } = await orgMember(req, (await params).orgId, 'admin');
  await deleteWebhookSecret(org.id);
  return new Response(null, { status: 204 });
});
