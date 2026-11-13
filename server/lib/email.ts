import type { Transporter } from 'nodemailer';
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

/** SMTP settings (e.g. Gmail with an app password). SMTP_HOST defaults to Gmail. */
function smtpConfig(): { host: string; port: number; user: string; pass: string } | null {
  const user = process.env.SMTP_USER?.trim();
  // Gmail shows app passwords in groups of four ("abcd efgh ijkl mnop"); spaces are not part of it.
  const pass = process.env.SMTP_PASS?.replace(/\s+/g, '');
  if (!user || !pass) {
    return null;
  }
  const port = Number(process.env.SMTP_PORT || 465);
  return { host: process.env.SMTP_HOST?.trim() || 'smtp.gmail.com', port: Number.isInteger(port) && port > 0 ? port : 465, user, pass };
}

let transporter: Transporter | null = null;

async function smtpTransport(cfg: NonNullable<ReturnType<typeof smtpConfig>>): Promise<Transporter> {
  if (!transporter) {
    const nodemailer = await import('nodemailer');
    transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      // 465 = TLS from the start; 587 = STARTTLS (required, never plain text).
      secure: cfg.port === 465,
      requireTLS: cfg.port !== 465,
      auth: { user: cfg.user, pass: cfg.pass },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000
    });
  }
  return transporter;
}

export function emailEnabled(): boolean {
  return !!override || !!process.env.RESEND_API_KEY || !!smtpConfig() || process.env.EMAIL_DEV_LOG === 'true';
}

/**
 * Sends via Resend (RESEND_API_KEY) or SMTP (SMTP_USER + SMTP_PASS, e.g. a Gmail app password),
 * from EMAIL_FROM. EMAIL_DEV_LOG=true prints instead (local development only).
 */
export async function sendEmail(msg: EmailMessage): Promise<void> {
  if (override) {
    return override(msg);
  }
  const smtp = process.env.RESEND_API_KEY ? null : smtpConfig();
  if (smtp) {
    try {
      const t = await smtpTransport(smtp);
      // Gmail rewrites a From address that is not the account (or a verified alias), so default to it.
      await t.sendMail({ from: process.env.EMAIL_FROM || `ProjectLens <${smtp.user}>`, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    } catch (err) {
      transporter = null; // reconnect next time (e.g. after a password change)
      console.error('[projectlens-api] SMTP send failed', err instanceof Error ? err.message : err);
      throw new HttpError(502, 'email_failed', 'Could not send the sign-in email. Try again later.');
    }
    return;
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
