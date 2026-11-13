import { env } from './env';
import { hmac } from './crypto';
import { assertSafeOutboundUrl } from './git/urls';
import { orgWebhookSecret } from './webhook-secret';

/**
 * Sends a signed POST to the caller's callback URL. Header:
 *   X-ProjectLens-Signature: sha256=<hex HMAC-SHA256 of the raw body>
 * The key is the organization's webhook secret (created by an admin in the extension or via
 * POST /webhook-secret). Without one, the server-wide PROJECTLENS_WEBHOOK_SECRET is used if set
 * (single-tenant/self-hosted setups); otherwise the webhook is sent unsigned.
 * Failures are logged, never thrown (the scan result is stored regardless).
 */
export async function sendWebhook(url: string, event: string, payload: unknown, orgId: string): Promise<boolean> {
  try {
    assertSafeOutboundUrl(url, 'WEBHOOK_ALLOWED_HOSTS');
    const body = JSON.stringify({ event, sentAt: new Date().toISOString(), data: payload });
    const secret = (await orgWebhookSecret(orgId)) ?? env().webhookSecret;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'projectlens-api', 'x-projectlens-event': event, ...(secret ? { 'x-projectlens-signature': `sha256=${hmac(secret, body)}` } : {}) },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000)
    });
    return res.ok;
  } catch (err) {
    console.warn('[projectlens-api] webhook failed', url, err instanceof Error ? err.message : err);
    return false;
  }
}
