import { env } from './env';
import { hmac } from './crypto';
import { assertSafeOutboundUrl } from './git/urls';

/**
 * Sends a signed POST to the caller's callback URL. Header:
 *   X-ProjectLens-Signature: sha256=<hex HMAC of the raw body with PROJECTLENS_WEBHOOK_SECRET>
 * Failures are logged, never thrown (the scan result is stored regardless).
 */
export async function sendWebhook(url: string, event: string, payload: unknown): Promise<boolean> {
  try {
    assertSafeOutboundUrl(url, 'WEBHOOK_ALLOWED_HOSTS');
    const body = JSON.stringify({ event, sentAt: new Date().toISOString(), data: payload });
    const secret = env().webhookSecret;
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
