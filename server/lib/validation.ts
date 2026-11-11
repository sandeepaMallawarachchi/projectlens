import { z } from 'zod';
import { AI_PROVIDER_IDS, AI_TASKS } from '@/engine/models/ai';
import { API_SCOPES } from './store/types';

const ref = z.string().trim().min(1).max(200).regex(/^[\w./@-]+$/, 'Invalid ref');
const httpsUrl = z.string().trim().url().max(500);

export const createProjectSchema = z.object({
  name: z.string().trim().min(1).max(120),
  provider: z.enum(['github', 'gitlab', 'none', 'local']),
  repository: z.string().trim().max(300).optional(),
  ref: ref.optional(),
  accessToken: z.string().trim().min(1).max(500).optional(),
  baseUrl: httpsUrl.optional(),
  externalId: z.string().trim().min(1).max(200).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  ref: ref.nullable().optional(),
  /** null removes the stored token. */
  accessToken: z.string().trim().min(1).max(500).nullable().optional(),
  externalId: z.string().trim().min(1).max(200).nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export const startScanSchema = z.object({
  mode: z.enum(['quick', 'full']).default('full'),
  ref: ref.optional(),
  force: z.boolean().default(false),
  wait: z.boolean().default(false),
  callbackUrl: httpsUrl.optional()
});

export const aiRequestSchema = z.object({
  task: z.enum(AI_TASKS),
  provider: z.enum(AI_PROVIDER_IDS).optional(),
  model: z.string().min(1).max(200).regex(/^[\w./:-]+$/).optional(),
  findingId: z.string().max(200).optional(),
  moduleId: z.string().max(200).optional(),
  file: z
    .string()
    .max(500)
    .refine((p) => !p.split(/[\\/]/).includes('..') && !p.startsWith('/'), 'File must be a repository-relative path')
    .optional()
});

export const createKeySchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(API_SCOPES)).min(1).default(['read'])
});

// ── Accounts & organizations ──────────────────────────────────────────────
const label = z.string().trim().max(100).optional();
export const githubSignInSchema = z.object({ accessToken: z.string().min(4).max(500), label });
export const emailStartSchema = z.object({ email: z.string().trim().email().max(254) });
export const emailVerifySchema = z.object({ email: z.string().trim().email().max(254), code: z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits'), label });
export const orgNameSchema = z.object({ name: z.string().trim().min(1).max(100) });
export const roleSchema = z.enum(['owner', 'admin', 'member']);
export const inviteSchema = z.object({ email: z.string().trim().email().max(254), role: roleSchema.default('member') });
export const updateMemberSchema = z.object({ role: roleSchema });
export const aiKeySchema = z.object({ apiKey: z.string().trim().min(8).max(500), validate: z.boolean().default(true) });
export const aiSettingsSchema = z.object({
  provider: z.enum(AI_PROVIDER_IDS).nullable(),
  model: z.string().trim().min(1).max(200).regex(/^[\w./:-]+$/).nullable().optional()
});

// ── Uploaded scan results (from the VS Code extension) ─────────────────────
const score = z.looseObject({ id: z.string(), label: z.string(), score: z.number().nullable(), grade: z.string(), verdict: z.string(), checks: z.array(z.unknown()), caps: z.array(z.string()), explanation: z.string() });
export const uploadSchema = z.object({
  commitSha: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
  branch: z.string().trim().max(200).optional(),
  result: z.looseObject({
    version: z.literal(1),
    mode: z.enum(['quick', 'full']),
    startedAt: z.string(),
    finishedAt: z.string(),
    projectName: z.string().max(300),
    roots: z.array(z.looseObject({ name: z.string(), uri: z.string() })).max(20),
    technology: z.looseObject({ languages: z.array(z.unknown()), technologies: z.array(z.unknown()), dependencies: z.array(z.unknown()), manifests: z.array(z.unknown()) }),
    findings: z
      .array(
        z.looseObject({
          id: z.string(),
          ruleId: z.string(),
          title: z.string(),
          category: z.string(),
          severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
          confidence: z.enum(['high', 'medium', 'low']),
          status: z.enum(['confirmed', 'needs-review']),
          evidence: z.string().max(2000),
          location: z.looseObject({ file: z.string().max(1000), uri: z.string().max(4000), line: z.number() })
        })
      )
      .max(3000),
    progress: z.looseObject({ modules: z.array(z.unknown()), placeholders: z.array(z.unknown()), limitations: z.array(z.string()) }),
    scores: z.object({ quality: score, security: score, implementation: score, readiness: score }),
    coverage: z.looseObject({ filesAnalyzed: z.number(), linesAnalyzed: z.number(), durationMs: z.number() }),
    warnings: z.array(z.string()).max(100),
    recommendedActions: z.array(z.unknown()).max(50)
  })
});

export function intParam(url: URL, name: string, fallback: number, max: number): number {
  const v = Number(url.searchParams.get(name));
  return Number.isInteger(v) && v > 0 ? Math.min(v, max) : fallback;
}
