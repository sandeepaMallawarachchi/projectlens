import { HttpError, handle, json, readJson } from '@/lib/http';
import { getStore, type InvitationRecord } from '@/lib/store';
import { normalizeEmail } from '@/lib/accounts';
import { emailEnabled, sendEmail } from '@/lib/email';
import { orgMember } from '@/lib/org-access';
import { inviteSchema } from '@/lib/validation';
import type { Params } from '@/lib/route-utils';

export const dynamic = 'force-dynamic';

const INVITE_DAYS = 14;
const dto = (i: InvitationRecord) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.createdAt, expiresAt: i.expiresAt, acceptedAt: i.acceptedAt });

export const GET = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org } = await orgMember(req, (await params).orgId, 'admin');
  return json({ data: (await getStore().listInvitations(org.id)).map(dto) });
});

/**
 * Invites someone by email. They join automatically the next time they sign in with that
 * (verified) email - via GitHub or email code. An email is sent when email delivery is configured.
 */
export const POST = handle(async (req: Request, { params }: Params<'orgId'>) => {
  const { org, membership, user } = await orgMember(req, (await params).orgId, 'admin');
  const body = await readJson(req, inviteSchema);
  if (body.role === 'owner' && membership.role !== 'owner') {
    throw new HttpError(403, 'forbidden', 'Only owners can invite owners');
  }
  const store = getStore();
  const email = normalizeEmail(body.email);
  const existingUser = await store.findUserByEmail(email);
  if (existingUser && (await store.getMembership(org.id, existingUser.id))) {
    throw new HttpError(409, 'already_member', 'This person is already a member');
  }
  if ((await store.listInvitations(org.id)).filter((i) => !i.acceptedAt).length >= 100) {
    throw new HttpError(429, 'limit', 'Too many pending invitations');
  }
  const invitation = await store.createInvitation({
    orgId: org.id,
    email,
    role: body.role,
    invitedBy: user.id,
    expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 3600 * 1000).toISOString()
  });
  let emailed = false;
  if (emailEnabled()) {
    const inviter = user.name ?? user.githubLogin ?? user.email ?? 'A teammate';
    await sendEmail({
      to: email,
      subject: `${inviter} invited you to ${org.name} on ProjectLens`,
      text: `${inviter} invited you to join "${org.name}" on ProjectLens.\n\nInstall the "ProjectLens AI" VS Code extension, open ProjectLens → Cloud and sign in with GitHub or this email address (${email}). You will join the team automatically.`,
      html: `<p>${inviter} invited you to join <strong>${org.name}</strong> on ProjectLens.</p><p>Install the <em>ProjectLens AI</em> VS Code extension, open <strong>ProjectLens → Cloud</strong> and sign in with GitHub or this email address (${email}). You will join the team automatically.</p>`
    })
      .then(() => (emailed = true))
      .catch(() => undefined);
  }
  return json({ data: { ...dto(invitation), emailed } }, 201);
});
