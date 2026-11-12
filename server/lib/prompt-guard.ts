import { randomUUID } from 'node:crypto';
import { after } from 'next/server';
import { z } from 'zod';
import {
  AI_TOOLS,
  BUILTIN_DETECTORS,
  PROMPT_ACTIONS,
  PROMPT_MODES,
  defaultPromptPolicy,
  type AiTool,
  type PromptPolicy
} from '@/engine/models/promptGuard';
import { HttpError } from './http';
import { assertSafeOutboundUrl } from './git/urls';
import { sendWebhook } from './webhook';
import { userDto } from './accounts';
import { getStore, type PromptEventRecord, type PromptGuardMemberRecord } from './store';

// ── Validation ──────────────────────────────────────────────────────────────

const action = z.enum(PROMPT_ACTIONS);
const ruleAction = z.enum(['warn', 'redact', 'block']);

const customRule = z
  .object({
    id: z.string().trim().regex(/^[\w-]{1,40}$/).optional(),
    name: z.string().trim().min(1).max(80),
    type: z.enum(['term', 'regex']),
    pattern: z.string().min(1).max(300),
    action: ruleAction
  })
  .superRefine((r, ctx) => {
    if (r.type === 'regex') {
      try {
        const re = new RegExp(r.pattern, 'gi');
        if (re.test('')) {
          ctx.addIssue({ code: 'custom', path: ['pattern'], message: 'Pattern must not match an empty string' });
        }
      } catch (err) {
        ctx.addIssue({ code: 'custom', path: ['pattern'], message: `Invalid regular expression: ${err instanceof Error ? err.message : err}` });
      }
    }
  });

/** Partial update: only provided fields change. */
export const promptPolicyUpdateSchema = z.object({
  mode: z.enum(PROMPT_MODES).optional(),
  notice: z.string().trim().min(20).max(2000).optional(),
  builtin: z.object(Object.fromEntries(BUILTIN_DETECTORS.map((d) => [d.id, action.optional()])) as Record<string, z.ZodOptional<typeof action>>).optional(),
  customRules: z.array(customRule).max(100).optional(),
  allowlist: z.array(z.string().min(4).max(300)).max(200).optional(),
  webhookUrl: z.string().trim().url().max(500).nullable().optional()
});
export type PromptPolicyUpdate = z.infer<typeof promptPolicyUpdateSchema>;

export const consentSchema = z.object({ consentVersion: z.number().int().positive(), accept: z.boolean() });

export const heartbeatSchema = z.object({
  enabled: z.boolean(),
  tools: z.array(z.enum(AI_TOOLS)).max(AI_TOOLS.length),
  policyVersion: z.number().int().min(0).nullable().optional(),
  clientVersion: z.string().trim().max(40).regex(/^[\w.+-]*$/).optional()
});

const MAX_AGE_MS = 30 * 24 * 3600_000;
export const eventsSchema = z.object({
  events: z
    .array(
      z.object({
        id: z.string().regex(/^[\w-]{8,64}$/),
        tool: z.enum(AI_TOOLS),
        action: z.enum(['blocked', 'warned', 'detected']),
        ruleIds: z.array(z.string().regex(/^[\w.-]{1,80}$/)).min(1).max(20),
        categories: z.array(z.enum(['secret', 'pii', 'custom'])).max(3),
        // Folder name only: never a path.
        project: z.string().trim().max(100).regex(/^[^/\\]*$/, 'Project must be a folder name, not a path').nullable(),
        policyVersion: z.number().int().min(0),
        occurredAt: z
          .string()
          .datetime()
          .refine((t) => {
            const ms = Date.parse(t);
            return ms <= Date.now() + 5 * 60_000 && ms >= Date.now() - MAX_AGE_MS;
          }, 'occurredAt must be within the last 30 days')
      })
    )
    .min(1)
    .max(200)
});

// ── Policy ──────────────────────────────────────────────────────────────────

export async function getPolicy(orgId: string): Promise<PromptPolicy> {
  const stored = await getStore().getPromptPolicy(orgId);
  const base = defaultPromptPolicy();
  // Merge so detectors added in later versions get their defaults.
  return stored ? { ...base, ...stored, builtin: { ...base.builtin, ...stored.builtin } } : base;
}

export async function updatePolicy(orgId: string, patch: PromptPolicyUpdate, actor: string): Promise<PromptPolicy> {
  const current = await getPolicy(orgId);
  if (patch.webhookUrl) {
    try {
      assertSafeOutboundUrl(patch.webhookUrl, 'WEBHOOK_ALLOWED_HOSTS');
    } catch (err) {
      throw new HttpError(400, 'invalid_webhook_url', err instanceof Error ? err.message : 'Webhook URL is not allowed');
    }
  }
  const next: PromptPolicy = {
    ...current,
    ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
    ...(patch.notice !== undefined ? { notice: patch.notice } : {}),
    builtin: { ...current.builtin, ...Object.fromEntries(Object.entries(patch.builtin ?? {}).filter(([, v]) => v !== undefined)) },
    customRules: patch.customRules ? patch.customRules.map((r) => ({ ...r, id: r.id ?? randomUUID().slice(0, 8) })) : current.customRules,
    allowlist: patch.allowlist ?? current.allowlist,
    webhookUrl: patch.webhookUrl !== undefined ? patch.webhookUrl : current.webhookUrl,
    version: current.version + 1,
    updatedAt: new Date().toISOString(),
    updatedBy: actor
  };
  // Members must accept again when what they agreed to changes (stricter mode or new wording).
  if (next.notice !== current.notice || (next.mode !== current.mode && next.mode !== 'off')) {
    next.consentVersion = current.consentVersion + 1;
  }
  return getStore().savePromptPolicy(orgId, next);
}

/** Policy as returned to clients. The webhook URL is only visible to administrators. */
export function policyDto(p: PromptPolicy, admin: boolean) {
  return { ...p, webhookUrl: admin ? p.webhookUrl : p.webhookUrl ? '(configured)' : null, detectors: BUILTIN_DETECTORS };
}

// ── Members ─────────────────────────────────────────────────────────────────

function blankMember(orgId: string, userId: string): PromptGuardMemberRecord {
  return { orgId, userId, consentVersion: null, acceptedAt: null, declinedAt: null, enabled: false, tools: [], policyVersion: null, clientVersion: null, lastSeenAt: null };
}

export async function memberState(orgId: string, userId: string): Promise<PromptGuardMemberRecord> {
  return (await getStore().getPromptGuardMember(orgId, userId)) ?? blankMember(orgId, userId);
}

export function consentStatus(policy: PromptPolicy, m: PromptGuardMemberRecord): 'not_needed' | 'accepted' | 'declined' | 'pending' {
  if (policy.mode === 'off') {
    return 'not_needed';
  }
  if (m.consentVersion !== null && m.consentVersion >= policy.consentVersion) {
    return 'accepted';
  }
  if (m.declinedAt && policy.mode === 'optional') {
    return 'declined';
  }
  return 'pending';
}

export async function recordConsent(orgId: string, userId: string, consentVersion: number, accept: boolean): Promise<PromptGuardMemberRecord> {
  const policy = await getPolicy(orgId);
  if (consentVersion !== policy.consentVersion) {
    throw new HttpError(409, 'policy_changed', 'The policy changed since it was shown. Review it again.');
  }
  if (!accept && policy.mode === 'required') {
    throw new HttpError(400, 'consent_required', 'This organization requires Prompt Guard. Leave the organization if you do not agree.');
  }
  const cur = await memberState(orgId, userId);
  const now = new Date().toISOString();
  return getStore().upsertPromptGuardMember(
    accept ? { ...cur, consentVersion, acceptedAt: now, declinedAt: null } : { ...cur, consentVersion: null, acceptedAt: null, declinedAt: now, enabled: false }
  );
}

export async function recordHeartbeat(orgId: string, userId: string, hb: z.infer<typeof heartbeatSchema>): Promise<PromptGuardMemberRecord> {
  const cur = await memberState(orgId, userId);
  return getStore().upsertPromptGuardMember({
    ...cur,
    enabled: hb.enabled,
    tools: [...new Set(hb.tools)] as AiTool[],
    policyVersion: hb.policyVersion ?? null,
    clientVersion: hb.clientVersion ?? null,
    lastSeenAt: new Date().toISOString()
  });
}

/**
 * Throws 403 when the organization requires Prompt Guard and this user has not accepted the
 * current policy. Applied to organization data endpoints for user sessions.
 */
export async function assertPromptGuardConsent(orgId: string, userId: string): Promise<void> {
  const policy = await getStore().getPromptPolicy(orgId);
  if (!policy || policy.mode !== 'required') {
    return;
  }
  const status = consentStatus(policy, await memberState(orgId, userId));
  if (status !== 'accepted') {
    throw new HttpError(403, 'prompt_guard_consent_required', 'This organization requires Prompt Guard. Open ProjectLens in VS Code and review the policy to continue.');
  }
}

export async function membersReport(orgId: string) {
  const store = getStore();
  const [policy, members, states] = await Promise.all([getPolicy(orgId), store.listMembers(orgId), store.listPromptGuardMembers(orgId)]);
  const since = new Date(Date.now() - 30 * 24 * 3600_000).toISOString();
  const events = await store.listPromptEvents(orgId, { since, limit: 5000 });
  return Promise.all(
    members.map(async (m) => {
      const user = await store.getUser(m.userId);
      const s = states.find((x) => x.userId === m.userId) ?? blankMember(orgId, m.userId);
      const mine = events.filter((e) => e.userId === m.userId);
      return {
        user: user ? userDto(user) : { id: m.userId },
        role: m.role,
        consent: consentStatus(policy, s),
        acceptedAt: s.acceptedAt,
        enabled: s.enabled,
        tools: s.tools,
        policyVersion: s.policyVersion,
        upToDate: s.policyVersion === policy.version,
        clientVersion: s.clientVersion,
        lastSeenAt: s.lastSeenAt,
        last30Days: { blocked: mine.filter((e) => e.action === 'blocked').length, warned: mine.filter((e) => e.action === 'warned').length, detected: mine.filter((e) => e.action === 'detected').length }
      };
    })
  );
}

// ── Events ──────────────────────────────────────────────────────────────────

export async function ingestEvents(orgId: string, userId: string, actor: string, events: z.infer<typeof eventsSchema>['events']): Promise<{ accepted: number; duplicates: number }> {
  const receivedAt = new Date().toISOString();
  const records: PromptEventRecord[] = events.map((e) => ({ ...e, orgId, userId, receivedAt }));
  const accepted = await getStore().addPromptEvents(records);
  const policy = await getPolicy(orgId);
  const notify = records.filter((e) => e.action !== 'warned');
  if (policy.webhookUrl && notify.length && accepted > 0) {
    const url = policy.webhookUrl;
    const payload = { member: actor, events: notify.map(({ orgId: _o, userId: _u, receivedAt: _r, ...e }) => ({ ...e, userId })) };
    const send = () => sendWebhook(url, 'prompt.flagged', payload).then(() => undefined);
    try {
      after(send);
    } catch {
      void send(); // outside a request scope (tests)
    }
  }
  return { accepted, duplicates: records.length - accepted };
}

export function eventDto(e: PromptEventRecord) {
  const { orgId: _orgId, ...rest } = e;
  return rest;
}

export async function summary(orgId: string, days: number) {
  const since = new Date(Date.now() - days * 24 * 3600_000).toISOString();
  const store = getStore();
  const [events, policy, members] = await Promise.all([store.listPromptEvents(orgId, { since, limit: 10_000 }), getPolicy(orgId), membersReport(orgId)]);
  const count = (key: (e: PromptEventRecord) => string[]) => {
    const out: Record<string, number> = {};
    for (const e of events) {
      for (const k of key(e)) {
        out[k] = (out[k] ?? 0) + 1;
      }
    }
    return out;
  };
  return {
    days,
    since,
    policy: { version: policy.version, mode: policy.mode },
    totals: { events: events.length, blocked: events.filter((e) => e.action === 'blocked').length, warned: events.filter((e) => e.action === 'warned').length, detected: events.filter((e) => e.action === 'detected').length },
    byRule: count((e) => e.ruleIds),
    byTool: count((e) => [e.tool]),
    byCategory: count((e) => e.categories),
    members: {
      total: members.length,
      accepted: members.filter((m) => m.consent === 'accepted').length,
      pending: members.filter((m) => m.consent === 'pending').length,
      declined: members.filter((m) => m.consent === 'declined').length,
      protected: members.filter((m) => m.enabled && m.tools.length > 0).length
    }
  };
}

export function sinceParam(url: URL): string | undefined {
  const raw = url.searchParams.get('since');
  if (!raw) {
    return undefined;
  }
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) {
    throw new HttpError(400, 'invalid_since', '`since` must be an ISO 8601 date');
  }
  return new Date(ms).toISOString();
}

export function toolParam(url: URL): AiTool | undefined {
  const t = url.searchParams.get('tool');
  if (!t) {
    return undefined;
  }
  if (!(AI_TOOLS as readonly string[]).includes(t)) {
    throw new HttpError(400, 'invalid_tool', `tool must be one of ${AI_TOOLS.join(', ')}`);
  }
  return t as AiTool;
}
