import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from './crypto';
import { getStore, type OrgRecord } from './store';

/**
 * Each organization signs its webhooks with its own secret, so integrators can verify them and
 * no organization can forge another's webhooks. The secret is encrypted at rest and shown once.
 */

export function webhookSecretStatus(org: OrgRecord) {
  return {
    configured: !!org.webhookSecretEncrypted,
    last4: org.webhookSecretLast4 ?? null,
    createdAt: org.webhookSecretCreatedAt ?? null
  };
}

/** Creates or rotates the secret. Returns the plain secret (only time it is available). */
export async function rotateWebhookSecret(orgId: string): Promise<{ secret: string; last4: string; createdAt: string }> {
  const secret = `whsec_${randomBytes(32).toString('base64url')}`;
  const last4 = secret.slice(-4);
  const createdAt = new Date().toISOString();
  await getStore().updateOrg(orgId, { webhookSecretEncrypted: encryptSecret(secret), webhookSecretLast4: last4, webhookSecretCreatedAt: createdAt });
  return { secret, last4, createdAt };
}

export async function deleteWebhookSecret(orgId: string): Promise<void> {
  await getStore().updateOrg(orgId, { webhookSecretEncrypted: null, webhookSecretLast4: null, webhookSecretCreatedAt: null });
}

/** The organization's signing secret, or null when none is configured. */
export async function orgWebhookSecret(orgId: string): Promise<string | null> {
  const org = await getStore().getOrg(orgId);
  if (!org?.webhookSecretEncrypted) {
    return null;
  }
  try {
    return decryptSecret(org.webhookSecretEncrypted);
  } catch {
    return null; // encryption key changed: the admin must rotate the secret
  }
}
