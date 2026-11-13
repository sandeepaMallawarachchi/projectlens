import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn();
const createTransport = vi.fn(() => ({ sendMail }));
vi.mock('nodemailer', () => ({ default: { createTransport }, createTransport }));

import { resetEnv } from './helpers';
import * as authConfig from '@/app/api/v1/auth/config/route';

async function freshEmail() {
  vi.resetModules();
  return import('@/lib/email');
}

beforeEach(() => {
  resetEnv();
  sendMail.mockReset();
  createTransport.mockClear();
});
afterEach(() => vi.resetModules());

describe('SMTP email (Gmail app password)', () => {
  it('is disabled until SMTP_USER and SMTP_PASS are set', async () => {
    const { emailEnabled, setEmailSender } = await freshEmail();
    setEmailSender(null);
    expect(emailEnabled()).toBe(false);
    process.env.SMTP_USER = 'yourapp@gmail.com';
    expect(emailEnabled()).toBe(false);
    process.env.SMTP_PASS = 'abcd efgh ijkl mnop';
    expect(emailEnabled()).toBe(true);
  });

  it('sends through smtp.gmail.com over TLS with the spaces removed from the app password', async () => {
    Object.assign(process.env, { SMTP_USER: 'yourapp@gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop' });
    const { sendEmail, setEmailSender } = await freshEmail();
    setEmailSender(null);
    sendMail.mockResolvedValue({ messageId: 'x' });
    await sendEmail({ to: 'dev@example.org', subject: 'Your code', text: '123456', html: '<b>123456</b>' });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: 'yourapp@gmail.com', pass: 'abcdefghijklmnop' } }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'ProjectLens <yourapp@gmail.com>', to: 'dev@example.org', subject: 'Your code' }));
  });

  it('uses STARTTLS on port 587 and EMAIL_FROM when set', async () => {
    Object.assign(process.env, { SMTP_USER: 'u@example.org', SMTP_PASS: 'secret-pass', SMTP_HOST: 'smtp.example.org', SMTP_PORT: '587', EMAIL_FROM: 'Team <u@example.org>' });
    const { sendEmail, setEmailSender } = await freshEmail();
    setEmailSender(null);
    sendMail.mockResolvedValue({});
    await sendEmail({ to: 'a@example.org', subject: 's', text: 't', html: 'h' });
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.example.org', port: 587, secure: false, requireTLS: true }));
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'Team <u@example.org>' }));
  });

  it('reports a clear error (without credentials) when Gmail rejects the login', async () => {
    Object.assign(process.env, { SMTP_USER: 'yourapp@gmail.com', SMTP_PASS: 'wrongpassword1234' });
    const { sendEmail, setEmailSender } = await freshEmail();
    setEmailSender(null);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    sendMail.mockRejectedValue(new Error('Invalid login: 535-5.7.8 Username and Password not accepted'));
    await expect(sendEmail({ to: 'a@example.org', subject: 's', text: 't', html: 'h' })).rejects.toMatchObject({ status: 502, code: 'email_failed' });
    expect(JSON.stringify(log.mock.calls)).not.toContain('wrongpassword1234');
    log.mockRestore();
  });

  it('turns on email sign-in in /auth/config', async () => {
    Object.assign(process.env, { SMTP_USER: 'yourapp@gmail.com', SMTP_PASS: 'abcdefghijklmnop' });
    const res = await authConfig.GET();
    expect(await res.json()).toEqual({ data: { github: true, email: true } });
  });
});
