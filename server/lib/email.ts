import { HttpError } from './http';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

type Sender = (msg: EmailMessage) => Promise<void>;
let override: Sender | null = null;

/** Test hook. */
export function setEmailSender(sender: Sender | null): void {
  override = sender;
}

export function emailEnabled(): boolean {
  return !!override || !!process.env.RESEND_API_KEY || process.env.EMAIL_DEV_LOG === 'true';
}

/** Sends via Resend (RESEND_API_KEY, EMAIL_FROM). EMAIL_DEV_LOG=true prints instead (local development only). */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (override) {
    return override(msg);
  }
  if (process.env.RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.EMAIL_FROM ?? 'ProjectLens <onboarding@resend.dev>', to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) {
      console.error('[projectlens-api] email send failed', res.status, await res.text().catch(() => ''));
      throw new HttpError(502, 'email_failed', 'Could not send the sign-in email. Try again later.');
    }
    return;
  }
  if (process.env.EMAIL_DEV_LOG === 'true') {
    console.log(`[projectlens-api] email to ${msg.to}: ${msg.subject}\n${msg.text}`);
    return;
  }
  throw new HttpError(503, 'email_not_configured', 'Email sign-in is not configured on this server');
}
